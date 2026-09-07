/**
 * Which of the three frontend surfaces a session belongs to.
 *
 * Lives in platform rather than in the identity module because both
 * platform code (cookie naming, the auth middleware) and the identity
 * module (token issuance) need it, and the module boundary rule only allows
 * dependencies to flow from a module toward platform, never the other way.
 * See docs/build-plan.md section 1.2.
 */

export type Audience = 'customer' | 'merchant' | 'admin';

export const AUDIENCE_SUFFIX: Record<Audience, string> = {
  customer: 'cust',
  merchant: 'mer',
  admin: 'adm',
};
