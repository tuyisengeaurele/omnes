import { z } from 'zod';
import { CustomerType, SaleStatus } from '@prisma/client';

export const createCustomerSchema = z.object({
  code: z.string().min(1),
  type: z.nativeEnum(CustomerType),
  name: z.string().min(1),
  companyName: z.string().optional(),
  tinNumber: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  address: z.string().min(1),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const saleItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  totalPrice: z.number().positive(),
});

export const createSaleSchema = z.object({
  customerId: z.string().min(1),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // subtotal, vatAmount, totalAmount are computed server-side and must not be trusted from the client
  subtotal: z.number().min(0).optional(),
  vatAmount: z.number().min(0).optional(),
  totalAmount: z.number().positive().optional(),
  notes: z.string().optional(),
  items: z.array(saleItemSchema).min(1),
});

export const updateSaleSchema = createSaleSchema.partial();

export const updateSaleStatusSchema = z.object({
  status: z.nativeEnum(SaleStatus),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const addSalePaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.string().min(1),
  reference: z.string().optional(),
  notes: z.string().optional(),
});
