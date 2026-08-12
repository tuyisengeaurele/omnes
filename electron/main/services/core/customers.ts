import { prisma } from './database';
import type { Customer, CustomerInput, CustomerResult } from '@shared/ipc';

const MIN_NAME_LENGTH = 2;

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateInput(input: Partial<CustomerInput>): void {
  if (input.name !== undefined && input.name.trim().length < MIN_NAME_LENGTH) {
    throw new Error(`Name must be at least ${MIN_NAME_LENGTH} characters`);
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function listCustomers(includeInactive = false): Promise<Customer[]> {
  const rows = await prisma.customer.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: { name: 'asc' },
  });
  return rows.map(toCustomer);
}

export async function createCustomer(input: CustomerInput): Promise<CustomerResult> {
  try {
    validateInput(input);
    const row = await prisma.customer.create({
      data: {
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });
    return { success: true, message: 'Customer added', customer: toCustomer(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), customer: null };
  }
}

export async function updateCustomer(
  id: string,
  input: Partial<CustomerInput>,
): Promise<CustomerResult> {
  try {
    validateInput(input);
    const row = await prisma.customer.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.phone !== undefined && { phone: input.phone?.trim() || null }),
        ...(input.email !== undefined && { email: input.email?.trim() || null }),
        ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
      },
    });
    return { success: true, message: 'Customer updated', customer: toCustomer(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), customer: null };
  }
}

export async function setCustomerActive(id: string, isActive: boolean): Promise<CustomerResult> {
  try {
    const row = await prisma.customer.update({ where: { id }, data: { isActive } });
    return {
      success: true,
      message: isActive ? 'Customer reactivated' : 'Customer deactivated',
      customer: toCustomer(row),
    };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), customer: null };
  }
}
