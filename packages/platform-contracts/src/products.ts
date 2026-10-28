import { z } from 'zod';
import { addressSchema, idSchema, PRODUCTS, PRODUCT_ROLES, type Product } from '@platform/kernel';

export {
  HQ_ROLES,
  PRODUCTS,
  PRODUCT_NAMES,
  PRODUCT_ROLES,
  isProduct,
  isProductRole,
  type HqRole,
  type Product,
} from '@platform/kernel';

export const productSchema = z.enum(PRODUCTS);

// --- Subscriptions ---------------------------------------------------------

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Switch a product on or off for the company. Billing is not wired yet, so
 * this is the manual toggle an owner uses. */
export const updateSubscriptionSchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES),
  plan: z.string().trim().min(1).max(60).optional(),
});
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

/** Select Your Products: the products to enable, at least one, no repeats. */
export const enableProductsSchema = z.object({
  products: z
    .array(productSchema, { required_error: 'select at least one product' })
    .min(1, 'select at least one product')
    .refine((list) => new Set(list).size === list.length, 'a product is listed twice'),
});
export type EnableProductsInput = z.infer<typeof enableProductsSchema>;

/** What each product is, on Select Your Products. */
export const PRODUCT_DESCRIPTIONS: Record<Product, string> = {
  INVOICING: 'Send invoices, take card, ACH and wallet payments, and sync with Zoho Books.',
  HQ: 'Run your stores and warehouses: inventory, purchasing and team, in one place.',
};

// --- Product roles ---------------------------------------------------------

/** Give a user a role in one product, or `null` to take the product away. The
 * role must be one of that product's roles — checked against PRODUCT_ROLES. */
export const updateProductRoleSchema = z.object({
  role: z.string().trim().min(1).max(60).nullable(),
});
export type UpdateProductRoleInput = z.infer<typeof updateProductRoleSchema>;

export function productRoleError(product: Product, role: string): string | null {
  return (PRODUCT_ROLES[product] as readonly string[]).includes(role)
    ? null
    : `${role} is not a ${product} role (expected one of ${PRODUCT_ROLES[product].join(', ')})`;
}

// --- Locations -------------------------------------------------------------

export const LOCATION_KINDS = ['STORE', 'WAREHOUSE'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const LOCATION_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export const createLocationSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  kind: z.enum(LOCATION_KINDS),
  /** Optional: a location may serve one brand, or the whole company. */
  brandId: idSchema.nullable().default(null),
  address: addressSchema.nullable().default(null),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(LOCATION_KINDS).optional(),
  brandId: idSchema.nullable().optional(),
  address: addressSchema.nullable().optional(),
  status: z.enum(LOCATION_STATUSES).optional(),
});
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const assignUserLocationsSchema = z.object({
  locationIds: z.array(idSchema).max(500),
});
export type AssignUserLocationsInput = z.infer<typeof assignUserLocationsSchema>;
