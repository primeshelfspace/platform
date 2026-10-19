/**
 * Brand colour accessibility (NFR-USE-004, NFR-001 §11.1).
 *
 * A merchant can pick any brand colour. An arbitrary colour will not reliably
 * meet 4.5:1 against white, so the token layer computes an accessible
 * foreground for each brand colour and reports colours that cannot be made
 * compliant. This runs at admin time when the colour is chosen and at build
 * time for the seeded brands — it is a check, not a runtime hope.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export const WCAG_AA_NORMAL = 4.5;
export const WCAG_AA_LARGE = 3;

export function parseHex(hex: string): Rgb {
  const normalised = hex.trim().replace(/^#/, '');
  const expanded =
    normalised.length === 3 ? [...normalised].map((ch) => ch + ch).join('') : normalised;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`"${hex}" is not a 3- or 6-digit hex colour`);
  }
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(colour: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(typeof a === 'string' ? parseHex(a) : a);
  const lb = relativeLuminance(typeof b === 'string' ? parseHex(b) : b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/** Mixes two colours in sRGB space. `amount` 0 returns `from`, 1 returns `to`. */
export function mix(from: string | Rgb, to: string | Rgb, amount: number): Rgb {
  const a = typeof from === 'string' ? parseHex(from) : from;
  const b = typeof to === 'string' ? parseHex(to) : to;
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** Whichever of white or the given ink reads better on `background`. */
export function foregroundOn(background: string, ink = '#132119'): string {
  const onWhite = contrastRatio(background, '#FFFFFF');
  const onInk = contrastRatio(background, ink);
  return onWhite >= onInk ? '#FFFFFF' : ink;
}

/**
 * Darkens a colour until it clears `target` contrast against `against`.
 * Used to derive a readable text variant of a brand colour without changing
 * its hue — the fill stays the brand's colour, the text uses this.
 */
export function darkenUntilAccessible(
  colour: string,
  against = '#FFFFFF',
  target = WCAG_AA_NORMAL,
): { readonly hex: string; readonly ratio: number; readonly achieved: boolean } {
  const base = parseHex(colour);
  const black = { r: 0, g: 0, b: 0 };
  if (contrastRatio(base, against) >= target) {
    const ratio = contrastRatio(base, against);
    return { hex: toHex(base), ratio: Number(ratio.toFixed(2)), achieved: true };
  }

  // Contrast against a light surface increases monotonically as the colour is
  // mixed toward black, so binary search finds the least dark compliant
  // variant — keeping as much of the brand's colour as the requirement allows.
  //
  // The ratio is measured on the QUANTISED colour, because that 8-bit value is
  // what a browser actually paints. Measuring the continuous mix instead lands
  // a hair under target once rounded.
  const ratioAt = (t: number) => contrastRatio(parseHex(toHex(mix(base, black, t))), against);

  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (ratioAt(mid) >= target) high = mid;
    else low = mid;
  }

  // Rounding is not perfectly monotonic, so nudge darker until it truly clears.
  const stepSize = 1 / 255;
  while (high < 1 && ratioAt(high) < target) high = Math.min(1, high + stepSize);

  const hex = toHex(mix(base, black, high));
  const ratio = contrastRatio(hex, against);
  return { hex, ratio: Number(ratio.toFixed(2)), achieved: ratio >= target };
}

export interface BrandColourAssessment {
  readonly brandColour: string;
  /** Text/icon colour to use ON the brand colour (buttons, chips). */
  readonly onBrand: string;
  readonly onBrandRatio: number;
  /** Brand colour darkened until it is legible as text on the app surface. */
  readonly brandInk: string;
  readonly brandInkRatio: number;
  /** Contrast of the raw brand colour as text on the surface. */
  readonly rawOnSurfaceRatio: number;
  readonly compliant: boolean;
  readonly warnings: readonly string[];
}

/**
 * Full assessment of a merchant-chosen brand colour. `compliant` is false when
 * no accessible foreground can be derived — the admin UI blocks the save and
 * says why rather than shipping an unreadable payment page.
 */
export function assessBrandColour(
  brandColour: string,
  options: { readonly surface?: string; readonly ink?: string } = {},
): BrandColourAssessment {
  const surface = options.surface ?? '#FFFFFF';
  const ink = options.ink ?? '#132119';

  const onBrand = foregroundOn(brandColour, ink);
  const onBrandRatio = Number(contrastRatio(brandColour, onBrand).toFixed(2));
  const derived = darkenUntilAccessible(brandColour, surface, WCAG_AA_NORMAL);
  const rawOnSurfaceRatio = Number(contrastRatio(brandColour, surface).toFixed(2));

  const warnings: string[] = [];
  if (onBrandRatio < WCAG_AA_NORMAL) {
    warnings.push(
      `No foreground reaches ${WCAG_AA_NORMAL}:1 on this colour (best is ${onBrandRatio}:1). ` +
        `Text on brand-filled buttons will be hard to read.`,
    );
  }
  if (rawOnSurfaceRatio < WCAG_AA_NORMAL) {
    warnings.push(
      `The raw colour is only ${rawOnSurfaceRatio}:1 as text on ${surface}; ` +
        `a darkened variant (${derived.hex}, ${derived.ratio}:1) is used for text instead.`,
    );
  }
  if (!derived.achieved) {
    warnings.push('No darkened variant of this colour reaches AA contrast as text.');
  }

  return {
    brandColour: toHex(parseHex(brandColour)),
    onBrand,
    onBrandRatio,
    brandInk: derived.hex,
    brandInkRatio: derived.ratio,
    rawOnSurfaceRatio,
    compliant: onBrandRatio >= WCAG_AA_LARGE && derived.achieved,
    warnings,
  };
}
