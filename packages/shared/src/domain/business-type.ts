/** FR-BRD onboarding: legal structure of the business behind a brand. */

export const BUSINESS_TYPES = [
  'SOLE_PROPRIETORSHIP',
  'LLC',
  'CORPORATION',
  'PARTNERSHIP',
  'NONPROFIT',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  SOLE_PROPRIETORSHIP: 'Sole Proprietorship',
  LLC: 'LLC',
  CORPORATION: 'Corporation',
  PARTNERSHIP: 'Partnership',
  NONPROFIT: 'Nonprofit',
};

/** Narrowing guard, so callers validating user input do not each rebuild a
 * Set of the same five values. */
export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === 'string' && (BUSINESS_TYPES as readonly string[]).includes(value);
}
