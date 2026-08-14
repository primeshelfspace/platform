/**
 * The API's base URL, with the same local-dev fallback every call site in
 * this app needs. NEXT_PUBLIC_ vars are inlined at build time regardless of
 * which module they're read from, so importing this instead of repeating
 * `process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'` costs nothing.
 */
export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
