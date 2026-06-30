import { z } from 'zod';
import { POStatus } from '@prisma/client';

export const createSupplierSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  contactPerson: z.string().optional(),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  address: z.string().min(1),
  tinNumber: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const purchaseItemSchema = z.object({
  materialId: z.string().min(1),
  quantity: z.number().positive('Quantity must be greater than zero'),
  unitPrice: z.number().positive('Unit price must be greater than zero'),
  // totalPrice is computed server-side and must not be trusted from the client
  totalPrice: z.number().positive().optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().min(1),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // totalAmount is computed server-side and must not be trusted from the client
  totalAmount: z.number().positive().optional(),
  notes: z.string().optional(),
  items: z.array(purchaseItemSchema).min(1),
});

export const updatePurchaseOrderSchema = createPurchaseOrderSchema.partial();

export const updatePOStatusSchema = z.object({
  status: z.nativeEnum(POStatus),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const addSupplierPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.string().min(1),
  reference: z.string().optional(),
  notes: z.string().optional(),
});
