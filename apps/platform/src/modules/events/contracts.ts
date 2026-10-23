/**
 * The platform's event contracts are published in @platform/platform-contracts,
 * so every product (and, later, any split-out service) depends on one shared
 * definition. Re-exported here for the platform's own code.
 */
export {
  PLATFORM_EVENTS,
  type AddressSnapshot,
  type BrandEventPayload,
  type BrandSnapshot,
  type LocationEventPayload,
  type LocationSnapshot,
  type PlatformEventTopic,
  type SubscriptionEventPayload,
  type SubscriptionSnapshot,
} from '@platform/platform-contracts';
