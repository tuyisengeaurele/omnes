/**
 * Catalog module: merchants, categories, products, modifiers, availability,
 * opening hours.
 *
 * This file is the module's only public surface. Other modules import from
 * here, never from a sibling file in this directory. Enforced by the
 * boundaries/element-types rule in the root eslint config.
 */

export { createCatalogService, type CatalogService } from './service.js';
export { createCatalogRouter } from './routes.js';
export {
  findProductById,
  findMerchantById,
  type ProductRow,
  type MerchantRow,
} from './repository.js';
