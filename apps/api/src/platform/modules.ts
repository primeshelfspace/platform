/**
 * The platform's Nest modules, for wiring only: the composition root imports
 * PlatformModule, and a product module imports IntegrationsModule to have the
 * platform's integration services injected. See ./public-api.ts for why these
 * are kept apart from the building blocks.
 */
export { PlatformModule } from './platform.module.js';
export { IntegrationsModule } from './integrations/integrations.module.js';
