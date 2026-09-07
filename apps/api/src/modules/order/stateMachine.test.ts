import { describe, expect, it } from 'vitest';
import { ORDER_TRANSITIONS, canTransition, isTerminal } from './stateMachine.js';
import type { OrderStatus } from '../../generated/prisma/index.js';

const ALL_STATUSES = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];

describe('canTransition', () => {
  it('allows every edge declared in ORDER_TRANSITIONS', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ORDER_TRANSITIONS[from]) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it('rejects every pair not declared in ORDER_TRANSITIONS', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const declared = ORDER_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(declared);
      }
    }
  });

  it('rejects a no-op transition to the same status', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('rejects skipping ahead in the happy path', () => {
    expect(canTransition('PAID', 'ACCEPTED')).toBe(false);
    expect(canTransition('MERCHANT_PENDING', 'PREPARING')).toBe(false);
    expect(canTransition('ACCEPTED', 'DELIVERED')).toBe(false);
  });

  it('rejects moving backward in the happy path', () => {
    expect(canTransition('DELIVERED', 'PICKED_UP')).toBe(false);
    expect(canTransition('PREPARING', 'ACCEPTED')).toBe(false);
    expect(canTransition('PAID', 'PENDING_PAYMENT')).toBe(false);
  });

  it('rejects resurrecting a cancelled or rejected order into the happy path', () => {
    expect(canTransition('CANCELLED', 'ACCEPTED')).toBe(false);
    expect(canTransition('REJECTED', 'ACCEPTED')).toBe(false);
  });

  it('allows a merchant to accept or reject a pending order, or for it to be cancelled first', () => {
    expect(canTransition('MERCHANT_PENDING', 'ACCEPTED')).toBe(true);
    expect(canTransition('MERCHANT_PENDING', 'REJECTED')).toBe(true);
    expect(canTransition('MERCHANT_PENDING', 'CANCELLED')).toBe(true);
  });

  it('does not allow cancelling once preparation has started', () => {
    expect(canTransition('PREPARING', 'CANCELLED')).toBe(false);
    expect(canTransition('READY_FOR_PICKUP', 'CANCELLED')).toBe(false);
    expect(canTransition('ASSIGNED', 'CANCELLED')).toBe(false);
  });

  it('allows a refund from any of the three states that could have taken payment', () => {
    expect(canTransition('DELIVERED', 'REFUNDED')).toBe(true);
    expect(canTransition('REJECTED', 'REFUNDED')).toBe(true);
    expect(canTransition('CANCELLED', 'REFUNDED')).toBe(true);
  });
});

describe('isTerminal', () => {
  it('is true only for REFUNDED, which has no outgoing edges', () => {
    expect(isTerminal('REFUNDED')).toBe(true);
  });

  it('is false for every non-terminal status, including DELIVERED, REJECTED and CANCELLED', () => {
    for (const status of ALL_STATUSES) {
      if (status === 'REFUNDED') continue;
      expect(isTerminal(status)).toBe(false);
    }
  });
});
