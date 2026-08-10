/** US ZIP code: five digits, optionally extended with a hyphen and four more
 * (ZIP+4) — e.g. `12345` or `12345-6789`. Every other country's postal code
 * is out of scope; `addressSchema` only applies this when `country` is US. */
const US_ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

export function isValidUsZip(value: string): boolean {
  return US_ZIP_PATTERN.test(value.trim());
}
