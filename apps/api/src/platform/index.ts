/**
 * Cross-cutting concerns shared by every module: auth middleware, RBAC,
 * rate limiting, CSRF, error handling, request logging, config loading.
 * Modules depend on platform; platform never depends on a module.
 */

export {};
