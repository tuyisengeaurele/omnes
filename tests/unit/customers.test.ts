// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createCustomer,
  listCustomers,
  setCustomerActive,
  updateCustomer,
} from '../../electron/main/services/core/customers';
import { prisma } from '../../electron/main/services/core/database';

function uniqueName(): string {
  return `Test Customer ${randomUUID()}`;
}

describe('customers', () => {
  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { name: { startsWith: 'Test Customer' } } });
    await prisma.$disconnect();
  });

  it('creates a customer with just a name', async () => {
    const name = uniqueName();
    const result = await createCustomer({ name, phone: null, email: null, notes: null });

    expect(result.success).toBe(true);
    expect(result.customer?.name).toBe(name);
    expect(result.customer?.phone).toBeNull();

    const customers = await listCustomers();
    expect(customers.some((customer) => customer.name === name)).toBe(true);
  });

  it('rejects a name shorter than the minimum length', async () => {
    const result = await createCustomer({ name: 'A', phone: null, email: null, notes: null });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Name must be at least 2 characters');
  });

  it('stores phone, email, and notes when provided', async () => {
    const name = uniqueName();
    const result = await createCustomer({
      name,
      phone: '0788000000',
      email: 'test@example.com',
      notes: 'Prefers mobile money',
    });

    expect(result.success).toBe(true);
    expect(result.customer?.phone).toBe('0788000000');
    expect(result.customer?.email).toBe('test@example.com');
    expect(result.customer?.notes).toBe('Prefers mobile money');
  });

  it('updates a customer', async () => {
    const created = await createCustomer({
      name: uniqueName(),
      phone: null,
      email: null,
      notes: null,
    });
    const id = created.customer?.id as string;

    const updated = await updateCustomer(id, { phone: '0788111111' });

    expect(updated.success).toBe(true);
    expect(updated.customer?.phone).toBe('0788111111');
  });

  it('deactivates and reactivates a customer without deleting it', async () => {
    const created = await createCustomer({
      name: uniqueName(),
      phone: null,
      email: null,
      notes: null,
    });
    const id = created.customer?.id as string;

    const deactivated = await setCustomerActive(id, false);
    expect(deactivated.success).toBe(true);
    expect(deactivated.customer?.isActive).toBe(false);

    const activeList = await listCustomers();
    expect(activeList.some((customer) => customer.id === id)).toBe(false);

    const fullList = await listCustomers(true);
    expect(fullList.some((customer) => customer.id === id)).toBe(true);

    const reactivated = await setCustomerActive(id, true);
    expect(reactivated.success).toBe(true);
    expect(reactivated.customer?.isActive).toBe(true);
  });
});
