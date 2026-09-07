/**
 * The authenticated caller of a request, once the identity module's auth
 * middleware has verified a session. Lives in platform, alongside the
 * Express Request augmentation, because RBAC (platform/rbac.ts) needs to
 * read it without importing anything from the identity module.
 */

import type { Audience } from './audience.js';

export interface Actor {
  userId: string;
  audience: Audience;
  roles: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- this is the documented way to augment Express's Request type.
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}
