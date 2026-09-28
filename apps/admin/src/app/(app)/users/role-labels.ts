import type { Role } from '@fenwick/shared';

/** Display copy for the fixed Role enum — the matrix itself (@fenwick/shared)
 * only knows the enum values, not how to present them to a person. */
export const ROLE_LABELS: Record<Role, string> = {
  MERCHANT_OWNER: 'Owner',
  MERCHANT_ADMIN: 'Admin',
  BRAND_ADMIN: 'Brand Admin',
  FINANCE_USER: 'Finance User',
  SALES_USER: 'Sales User',
  READ_ONLY: 'Read Only',
};
