/**
 * @platform/kernel — shared by every module and app: money and invoice
 * arithmetic, tenancy scope, design tokens, port interfaces, and generic
 * validation and reference data. Module-specific contracts live in
 * @platform/<module>-contracts.
 *
 * Nothing here imports a framework, a database client or an HTTP type.
 */

export * from './money/index.js';
export * from './domain/index.js';
export * from './ports/index.js';
export * from './schemas/index.js';
export * from './tokens/index.js';
export * from './tenancy.js';
