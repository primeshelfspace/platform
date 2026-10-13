/**
 * The platform's public API — together with ./modules.ts, the ONLY files
 * products (invoicing, hq) and the shared adapters may import from
 * `platform/`. Anything not exported from those two files is internal to the
 * platform and can change without notice.
 *
 * This file holds building blocks only (decorators, services, types). Nest
 * modules live in ./modules.ts: keeping them apart means importing a
 * decorator never drags in the whole platform module graph, which would
 * create load-order cycles (an adapter importing @Public() while the platform
 * is still importing that adapter's module).
 *
 * Enforced by src/module-boundaries.test.ts.
 *
 * Today these are in-process classes and functions. If the platform is ever
 * split into its own service, this file is what gets replaced by an HTTP
 * client with the same interface — so keep it small and deliberate.
 */

// Authorisation: decorators every product controller uses, and the global guard
export {
  AuthorisationGuard,
  CurrentScope,
  Public,
  RequirePermission,
} from './tenancy/authorisation.js';

// Background work that needs a tenant scope without a signed-in user
export { SystemScopeResolver } from './tenancy/system-scope.js';

// Audit log (append-only, shared by every product)
export { AuditLogService, type AuditEntry } from './audit/audit-log.service.js';

// Brands (the platform owns them; products keep a copy fed by the events below)
export { BrandsService } from './brands/brands.service.js';

// Events the platform publishes, and their payloads
export {
  PLATFORM_EVENTS,
  type BrandEventPayload,
  type BrandSnapshot,
  type PlatformEventTopic,
} from './events/contracts.js';

// Integration connections (records and credentials are platform-owned)
export {
  IntegrationConnectionService,
  type LiveZohoConnection,
  type ZohoConnectionConfig,
  type ZohoConnectionStatus,
} from './integrations/integration-connection.service.js';
export { StripeAccountService } from './integrations/stripe-account.service.js';
export { signOAuthState, verifyOAuthState } from './integrations/oauth-state.js';
