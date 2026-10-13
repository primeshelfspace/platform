import { ApiError } from './api';
import type { CustomerAddress } from './api';

/**
 * Form-field plumbing shared by every server action in this app.
 *
 * These were four separate copies of `emptyToNull`, three of
 * `describeApiError` and two of `addressFromForm`, all byte-identical. Pure
 * functions duplicating harmlessly is still duplication that has to be found
 * and changed in lockstep — `addressFromForm` in particular encodes the field
 * naming convention shared by the customer and company forms, and a copy that
 * drifted would silently stop reading half an address.
 */

/** Treats a blank or whitespace-only field as absent. An empty string is what
 * an untouched input submits; every schema here models "not provided" as null. */
export function emptyToNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Reads a six-field address group written as `${prefix}Line1`, `${prefix}City`
 * and so on. Null unless at least one field was actually filled in — an
 * address object of all-nulls is not meaningfully different from no address,
 * and the schemas already treat "no address" as null rather than an empty
 * shell.
 */
export function addressFromForm(formData: FormData, prefix: string): CustomerAddress | null {
  const address: CustomerAddress = {
    line1: emptyToNull(formData.get(`${prefix}Line1`)),
    line2: emptyToNull(formData.get(`${prefix}Line2`)),
    city: emptyToNull(formData.get(`${prefix}City`)),
    region: emptyToNull(formData.get(`${prefix}Region`)),
    postalCode: emptyToNull(formData.get(`${prefix}PostalCode`)),
    country: emptyToNull(formData.get(`${prefix}Country`)),
  };
  return Object.values(address).some((v) => v !== null) ? address : null;
}

/**
 * Turns an API rejection into something worth showing a person. A Zod failure
 * upstream arrives as a list of field issues; surfacing those beats the bare
 * status line, since they name the field that actually needs fixing.
 */
export function describeApiError(error: ApiError): string {
  const body = error.body as {
    issues?: Array<{ path: string; message: string }>;
    message?: string;
  } | null;
  if (body?.issues?.length) {
    return body.issues
      .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
      .join(' · ');
  }
  // body.message before error.message: of the three copies this replaces, only
  // the invoice one carried this fallback, and it is the better behaviour —
  // Nest puts the useful sentence there, while error.message degrades to the
  // bare status line when the body could not be parsed.
  return body?.message ?? error.message;
}

/**
 * The catch-block every action shares: an ApiError becomes its described form,
 * anything else becomes its message, and a non-Error becomes the supplied
 * fallback. Keeps each action's failure path to one line.
 */
export function describeActionError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return describeApiError(error);
  return error instanceof Error ? error.message : fallback;
}
