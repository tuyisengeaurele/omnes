import { z } from 'zod';

export const productFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  sku: z.string().trim().min(1, 'SKU is required'),
  barcode: z.string().trim(),
  category: z.string().trim().min(1, 'Category is required'),
  price: z.number().int().min(0, 'Price cannot be negative'),
  stockQuantity: z.number().int().min(0, 'Stock quantity cannot be negative'),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;
