/**
 * Catalog routes: public reads (list, search, menu) and RBAC-protected
 * writes (merchant, category, product). Write routes authenticate against
 * the 'customer' audience for now, since that is the only login flow that
 * exists yet (see docs/build-plan.md phase 2) - a merchant owner or staff
 * user logs in through the same phone+OTP flow a customer does, and their
 * real roles (MERCHANT_OWNER, OPS, SUPER_ADMIN) come along on the token
 * regardless of which audience issued it. RBAC and ownership checks below
 * are what actually gate the write, not the audience claim.
 */

import { Router } from 'express';
import {
  createCategorySchema,
  createMerchantSchema,
  createProductSchema,
  listMerchantsQuerySchema,
  searchCatalogQuerySchema,
  updateCategorySchema,
  updateMerchantSchema,
  updateProductSchema,
} from '@omnes/contracts';
import {
  findUserById,
  getMerchantIdForOwner,
  linkMerchantOwner,
  requireAuth,
  type TokenService,
} from '../identity/index.js';
import { requireRole } from '../../platform/rbac.js';
import { badRequest, notFound, unauthorized } from '../../platform/errors.js';
import { omitUndefined } from '../../platform/objectUtils.js';
import type { CatalogService } from './service.js';
import { assertMerchantAccess } from './ownership.js';

function serializeProduct(p: {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  priceMinor: bigint;
  currency: string;
  imageKey: string | null;
  isAvailable: boolean;
  stockCount: number | null;
}) {
  return {
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    description: p.description,
    price: { amountMinor: p.priceMinor.toString(), currency: p.currency },
    imageKey: p.imageKey,
    isAvailable: p.isAvailable,
    stockCount: p.stockCount,
  };
}

export function createCatalogRouter(catalog: CatalogService, tokenService: TokenService): Router {
  const router = Router();
  const requireCustomerAuth = requireAuth('customer', tokenService);

  // --- Public reads ---

  router.get('/merchants', async (req, res) => {
    const query = listMerchantsQuerySchema.parse(req.query);
    const page = await catalog.listMerchants({
      cityId: query.cityId,
      ...(query.vertical ? { vertical: query.vertical } : {}),
      ...(query.latitude !== undefined ? { latitude: query.latitude } : {}),
      ...(query.longitude !== undefined ? { longitude: query.longitude } : {}),
      ...(query.radiusM !== undefined ? { radiusM: query.radiusM } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
    });
    res.status(200).json(page);
  });

  router.get('/merchants/:id', async (req, res) => {
    const result = await catalog.getMerchantMenu(req.params.id);
    if (!result) throw notFound('MERCHANT_NOT_FOUND', 'No merchant matches this id.');

    res.status(200).json({
      merchant: result.merchant,
      categories: result.categories.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        products: c.products.map(serializeProduct),
      })),
    });
  });

  router.get('/search', async (req, res) => {
    const query = searchCatalogQuerySchema.parse(req.query);
    const result = await catalog.searchCatalog({
      cityId: query.cityId,
      query: query.q,
      limit: query.limit,
    });
    res.status(200).json({
      merchants: result.merchants,
      products: result.products.map((p) => ({
        ...serializeProduct(p),
        merchantId: p.merchantId,
        merchantName: p.merchantName,
      })),
    });
  });

  // --- Merchant CRUD ---

  router.post(
    '/merchants',
    requireCustomerAuth,
    requireRole('OPS', 'SUPER_ADMIN'),
    async (req, res) => {
      const input = createMerchantSchema.parse(req.body);
      const { ownerUserId, ...merchantInput } = input;

      // Validated before the merchant is created, not after: catalog and
      // identity writes are not in one transaction, so ordering this way
      // keeps the common failure modes (bad user id, a user who already
      // owns a merchant) from ever creating an orphaned merchant row. It
      // does not close a true concurrent-request race - that would need a
      // single transaction spanning both modules, which is more machinery
      // than an ops-only provisioning endpoint needs at MVP scale.
      const owner = await findUserById(ownerUserId);
      if (!owner) throw badRequest('OWNER_NOT_FOUND', 'No user matches ownerUserId.');
      const existingMerchant = await getMerchantIdForOwner(ownerUserId);
      if (existingMerchant) {
        throw badRequest('OWNER_ALREADY_HAS_MERCHANT', 'This user already owns a merchant.');
      }

      const merchant = await catalog.createMerchant(merchantInput);
      await linkMerchantOwner(ownerUserId, merchant.id);
      res.status(201).json({ merchant });
    }
  );

  router.patch('/merchants/:id', requireCustomerAuth, async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const merchantId = req.params.id as string;

    await assertMerchantAccess(actor, merchantId);
    const input = updateMerchantSchema.parse(req.body);
    const merchant = await catalog.updateMerchant(merchantId, omitUndefined(input));
    res.status(200).json({ merchant });
  });

  // --- Category CRUD ---

  router.post('/merchants/:id/categories', requireCustomerAuth, async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const merchantId = req.params.id as string;

    await assertMerchantAccess(actor, merchantId);
    const input = createCategorySchema.parse(req.body);
    const category = await catalog.createCategory(merchantId, input);
    res.status(201).json({ category });
  });

  router.patch('/categories/:id', requireCustomerAuth, async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const categoryId = req.params.id as string;

    const merchantId = await catalog.findCategoryOwner(categoryId);
    if (!merchantId) throw notFound('CATEGORY_NOT_FOUND', 'No category matches this id.');

    await assertMerchantAccess(actor, merchantId);
    const input = updateCategorySchema.parse(req.body);
    const category = await catalog.updateCategory(categoryId, omitUndefined(input));
    res.status(200).json({ category });
  });

  router.delete('/categories/:id', requireCustomerAuth, async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const categoryId = req.params.id as string;

    const merchantId = await catalog.findCategoryOwner(categoryId);
    if (!merchantId) throw notFound('CATEGORY_NOT_FOUND', 'No category matches this id.');

    await assertMerchantAccess(actor, merchantId);
    await catalog.deleteCategory(categoryId);
    res.status(204).send();
  });

  // --- Product CRUD ---

  router.post('/merchants/:id/products', requireCustomerAuth, async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const merchantId = req.params.id as string;

    await assertMerchantAccess(actor, merchantId);
    const input = createProductSchema.parse(req.body);
    if (input.categoryId) {
      const categoryOwner = await catalog.findCategoryOwner(input.categoryId);
      if (categoryOwner !== merchantId) {
        throw badRequest(
          'CATEGORY_NOT_IN_MERCHANT',
          'That category does not belong to this merchant.'
        );
      }
    }

    const product = await catalog.createProduct(merchantId, {
      ...omitUndefined(input),
      priceMinor: BigInt(input.priceMinor),
    });
    res.status(201).json({ product: serializeProduct(product) });
  });

  router.patch('/products/:id', requireCustomerAuth, async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const productId = req.params.id as string;

    const merchantId = await catalog.findProductOwner(productId);
    if (!merchantId) throw notFound('PRODUCT_NOT_FOUND', 'No product matches this id.');

    await assertMerchantAccess(actor, merchantId);
    const input = updateProductSchema.parse(req.body);

    if (input.categoryId) {
      const categoryOwner = await catalog.findCategoryOwner(input.categoryId);
      if (categoryOwner !== merchantId) {
        throw badRequest(
          'CATEGORY_NOT_IN_MERCHANT',
          'That category does not belong to this merchant.'
        );
      }
    }

    const { priceMinor, ...rest } = input;
    const product = await catalog.updateProduct(productId, {
      ...omitUndefined(rest),
      ...(priceMinor !== undefined ? { priceMinor: BigInt(priceMinor) } : {}),
    });
    res.status(200).json({ product: serializeProduct(product) });
  });

  router.delete('/products/:id', requireCustomerAuth, async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const productId = req.params.id as string;

    const merchantId = await catalog.findProductOwner(productId);
    if (!merchantId) throw notFound('PRODUCT_NOT_FOUND', 'No product matches this id.');

    await assertMerchantAccess(actor, merchantId);
    await catalog.deleteProduct(productId);
    res.status(204).send();
  });

  return router;
}
