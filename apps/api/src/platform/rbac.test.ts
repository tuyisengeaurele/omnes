import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireRole } from './rbac.js';
import type { Actor } from './actor.js';

function fakeRequest(actor?: Actor): Request {
  return { actor } as Request;
}

describe('requireRole', () => {
  it('calls next with no argument when the actor has one of the allowed roles', () => {
    const req = fakeRequest({ userId: 'u1', audience: 'merchant', roles: ['MERCHANT_OWNER'] });
    const next = vi.fn();

    requireRole('MERCHANT_OWNER', 'OPS')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next with a 403 error when the actor has no matching role', () => {
    const req = fakeRequest({ userId: 'u1', audience: 'customer', roles: ['CUSTOMER'] });
    const next = vi.fn();

    requireRole('MERCHANT_OWNER', 'OPS')(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0];
    expect(err).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('calls next with a 401 error when there is no actor at all', () => {
    const req = fakeRequest(undefined);
    const next = vi.fn();

    requireRole('OPS')(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0];
    expect(err).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('allows an actor holding one of several roles', () => {
    const req = fakeRequest({
      userId: 'u1',
      audience: 'customer',
      roles: ['CUSTOMER', 'MERCHANT_OWNER'],
    });
    const next = vi.fn();

    requireRole('MERCHANT_OWNER')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});
