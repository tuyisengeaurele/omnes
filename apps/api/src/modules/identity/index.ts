/**
 * Identity module: users, credentials, OTP, sessions, roles, driver and
 * merchant profiles, verification.
 *
 * This file is the module's only public surface. Other modules import from
 * here, never from a sibling file in this directory. Enforced by the
 * boundaries/element-types rule in the root eslint config.
 */

export { requireAuth } from './authMiddleware.js';
export { createIdentityRouter } from './routes.js';
export { createAuthService, type AuthService } from './auth.service.js';
export { createOtpService, type OtpService } from './otp.service.js';
export { createTokenService, type TokenService } from './token.service.js';
export { prismaOtpStore } from './otp.store.js';
export { prismaRefreshTokenStore } from './token.store.js';
export {
  findUserByPhone,
  findUserById,
  getRolesForUser,
  type UserRecord,
} from './repository.js';
