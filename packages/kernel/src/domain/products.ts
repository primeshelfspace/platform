import { ROLES } from './roles.js';

/**
 * The products a company can subscribe to. The platform is not a product: it
 * is always on. A company sees a product only while it holds an active
 * subscription to it, and a user works in a product only through a role
 * granted for that product.
 */
export const PRODUCTS = ['INVOICING', 'HQ'] as const;
export type Product = (typeof PRODUCTS)[number];

/** How each product is named to people. */
export const PRODUCT_NAMES: Record<Product, string> = {
  INVOICING: 'Sugrpay',
  HQ: 'HQ',
};

/** HQ's own roles (architecture plan: Executive, Manager, Associate). */
export const HQ_ROLES = ['EXECUTIVE', 'MANAGER', 'ASSOCIATE'] as const;
export type HqRole = (typeof HQ_ROLES)[number];

/**
 * The roles each product recognises. Invoicing uses the original six-role
 * matrix (roles.ts); HQ has its own three. A user holds at most one role per
 * product, independently of the others — a bookkeeper can be FINANCE_USER in
 * invoicing and hold no HQ role at all.
 */
export const PRODUCT_ROLES = {
  INVOICING: ROLES,
  HQ: HQ_ROLES,
} as const satisfies Record<Product, readonly string[]>;

export function isProduct(value: unknown): value is Product {
  return typeof value === 'string' && (PRODUCTS as readonly string[]).includes(value);
}

export function isProductRole(product: Product, role: unknown): boolean {
  return typeof role === 'string' && (PRODUCT_ROLES[product] as readonly string[]).includes(role);
}

/** How each product's roles are named to people. */
export const PRODUCT_ROLE_NAMES: { readonly [P in Product]: Record<string, string> } = {
  INVOICING: {
    MERCHANT_OWNER: 'Owner',
    MERCHANT_ADMIN: 'Admin',
    BRAND_ADMIN: 'Brand Admin',
    FINANCE_USER: 'Finance User',
    SALES_USER: 'Sales User',
    READ_ONLY: 'Read Only',
  },
  HQ: { EXECUTIVE: 'Executive', MANAGER: 'Manager', ASSOCIATE: 'Associate' },
};

/**
 * The roles a Company Admin can give a user in a product (Role Management —
 * Role List): the product's fixed roles, the same for every company, without
 * the Company Admin's own company-level access (Sugrpay's MERCHANT_OWNER).
 */
export function assignableProductRoles(product: Product): readonly string[] {
  return PRODUCT_ROLES[product].filter((role) => role !== 'MERCHANT_OWNER');
}
