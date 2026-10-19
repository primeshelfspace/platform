import { PRODUCT_NAMES, type Product } from '@platform/platform-contracts';

/**
 * Where each web app lives. NEXT_PUBLIC_ values are inlined at build time, so
 * each must be read by its literal name.
 */
export const ACCOUNTS_URL = process.env['NEXT_PUBLIC_ACCOUNTS_URL'] ?? 'http://localhost:3002';

const PRODUCT_URLS: Record<Product, string> = {
  INVOICING: process.env['NEXT_PUBLIC_INVOICING_URL'] ?? 'http://localhost:3000',
  HQ: process.env['NEXT_PUBLIC_HQ_URL'] ?? '',
};

export interface ProductInfo {
  readonly product: Product;
  readonly name: string;
  readonly description: string;
  /** Empty when the product has no web app yet. */
  readonly url: string;
}

const DESCRIPTIONS: Record<Product, string> = {
  INVOICING: 'Send invoices and get paid.',
  HQ: 'Products, stock, suppliers and stores.',
};

export function productInfo(product: Product): ProductInfo {
  return {
    product,
    name: PRODUCT_NAMES[product],
    description: DESCRIPTIONS[product],
    url: PRODUCT_URLS[product],
  };
}

/** Origins a sign-in may send the user back to. */
export const APP_ORIGINS: readonly string[] = [ACCOUNTS_URL, ...Object.values(PRODUCT_URLS)].filter(
  Boolean,
);
