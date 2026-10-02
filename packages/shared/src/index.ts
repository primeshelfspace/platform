/**
 * @sugrpay/shared — the workspace package the admin app, the payment app and
 * the API all depend on (TSD-001 §3.3): design tokens, the money module,
 * shared types, validation schemas and the port interfaces.
 *
 * Shared code, separate deployments. Nothing here imports a framework, a
 * database client or an HTTP type.
 */

export * from './money/index.js';
export * from './domain/index.js';
export * from './ports/index.js';
export * from './schemas/index.js';
export * from './tokens/index.js';
export * from './tenancy.js';
