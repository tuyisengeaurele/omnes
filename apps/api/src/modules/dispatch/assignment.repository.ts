/**
 * Assignment persistence: the one active driver-order pairing an accepted
 * offer produces. Order.id is unique on this table, so a second assignment
 * for the same order is a database-level impossibility, not just an
 * application-level convention.
 */

import { getDb } from '../../platform/db.js';

export interface AssignmentRecord {
  id: string;
  orderId: string;
  driverId: string;
  assignedAt: Date;
  completedAt: Date | null;
}

export async function createAssignment(
  orderId: string,
  driverId: string
): Promise<AssignmentRecord> {
  return getDb().assignment.create({ data: { orderId, driverId } });
}

export async function findAssignmentById(id: string): Promise<AssignmentRecord | null> {
  return getDb().assignment.findUnique({ where: { id } });
}

/** A driver has at most one of these at a time - see availability.repository.ts's eligibility filter. */
export async function findActiveAssignmentForDriver(
  driverId: string
): Promise<AssignmentRecord | null> {
  return getDb().assignment.findFirst({ where: { driverId, completedAt: null } });
}

export async function completeAssignment(id: string): Promise<void> {
  await getDb().assignment.update({ where: { id }, data: { completedAt: new Date() } });
}
