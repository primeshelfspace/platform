/**
 * NANP (North American Numbering Plan) validation and E.164 normalization for
 * US business phone numbers. Company Details (FR-ONB) is scoped to US
 * companies, so this — not the general `phoneSchema` shared with Brand and
 * Customer, which allows any country's punctuation — is what its phone field
 * validates against.
 */

/** Area code and exchange code first digits can't be 0 or 1 under NANP —
 * that's what actually distinguishes a real US number from ten random
 * digits. */
const NANP_PATTERN = /^[2-9]\d{2}[2-9]\d{6}$/;

/**
 * Accepts the common US formats — `(212) 555-1234`, `212-555-1234`,
 * `2125551234`, `+1 212 555 1234` — and normalizes any of them to E.164
 * (`+12125551234`). Returns null for anything else: letters, a non-US
 * country code, or the wrong number of digits.
 */
export function normalizeUsPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Punctuation beyond digits, whitespace, parens/dashes and a single
  // leading + must be rejected here — letters would otherwise just be
  // silently stripped by the digit extraction below.
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, '');
  let national: string;
  if (trimmed.startsWith('+')) {
    // Only +1 (US/Canada) is in scope — any other country code is rejected.
    if (digits.length !== 11 || !digits.startsWith('1')) return null;
    national = digits.slice(1);
  } else if (digits.length === 11) {
    if (!digits.startsWith('1')) return null;
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  } else {
    return null;
  }

  if (!NANP_PATTERN.test(national)) return null;
  return `+1${national}`;
}

export function isValidUsPhone(input: string): boolean {
  return normalizeUsPhone(input) !== null;
}
