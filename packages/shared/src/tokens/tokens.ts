/**
 * Design tokens.
 *
 * Carried forward from the prototype's visual system, but extracted from the
 * hex literals that are currently inlined throughout its component tree
 * (TSD-001 §3.4). Brand colour reaches components as a CSS custom property,
 * which is what lets one component set render in any brand's colours without
 * recompilation.
 */

import { assessBrandColour } from './contrast.js';

/** Product palette — fixed, not brand-controlled. */
export const palette = {
  // Surfaces, neutral gray — clean white cards on a barely-off-white page.
  canvas: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceMuted: '#F5F5F6',
  surfaceSunken: '#EEEEF0',

  // Lines.
  border: '#E2E2E6',
  borderStrong: '#C6C6CC',

  // Ink.
  ink: '#1A1A1F',
  inkStrong: '#0A0A0C',
  inkMuted: '#6B7280',
  inkSubtle: '#8C919B',
  inkInverse: '#FFFFFF',

  // Status. Also used for invoice state chips.
  success: '#1F8B5C',
  successSurface: '#E6F4ED',
  warning: '#C97A2B',
  warningSurface: '#FBF0DF',
  danger: '#C0473D',
  dangerSurface: '#F9E7E5',
  info: '#3A6FA8',
  infoSurface: '#E7EEF6',
  accent: '#2D6A6A',
  accentSurface: '#E1E7E2',
} as const;

export type PaletteToken = keyof typeof palette;

/** Default brand colours offered in the brand editor's swatch picker. */
export const BRAND_COLOUR_PRESETS = [
  '#EF4444',
  '#16A34A',
  '#3B82F6',
  '#0EA5E9',
  '#8B5CF6',
  '#F97316',
] as const;

export const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
} as const;

export const radii = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

export const typography = {
  fontSans:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  size: {
    xs: '12px',
    sm: '13px',
    base: '14px',
    md: '16px',
    lg: '18px',
    xl: '22px',
    '2xl': '28px',
  },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;

export const shadows = {
  sm: '0 1px 2px rgba(10, 10, 12, 0.06)',
  md: '0 2px 8px rgba(10, 10, 12, 0.08)',
  lg: '0 8px 24px rgba(10, 10, 12, 0.12)',
} as const;

/** Invoice status → palette tokens, so every surface renders a status alike. */
export const statusTone = {
  DRAFT: { fg: 'inkMuted', bg: 'surfaceSunken' },
  SENT: { fg: 'info', bg: 'infoSurface' },
  VIEWED: { fg: 'accent', bg: 'accentSurface' },
  PENDING_PAYMENT: { fg: 'warning', bg: 'warningSurface' },
  PARTIALLY_PAID: { fg: 'warning', bg: 'warningSurface' },
  PAID: { fg: 'success', bg: 'successSurface' },
  CANCELLED: { fg: 'inkSubtle', bg: 'surfaceSunken' },
  OVERDUE: { fg: 'danger', bg: 'dangerSurface' },
} as const satisfies Record<string, { fg: PaletteToken; bg: PaletteToken }>;

/**
 * The CSS custom properties a brand-themed surface needs. Injected into the
 * document for the admin app's active brand and for the public payment page,
 * with the accessible foreground computed rather than assumed.
 */
export function brandThemeVariables(brandColour: string): Record<string, string> {
  const assessment = assessBrandColour(brandColour, {
    surface: palette.surface,
    ink: palette.ink,
  });
  return {
    '--brand': assessment.brandColour,
    '--brand-foreground': assessment.onBrand,
    '--brand-ink': assessment.brandInk,
  };
}

/** The same, serialised for a `style` attribute or a `<style>` block. */
export function brandThemeCss(brandColour: string, selector = ':root'): string {
  const vars = brandThemeVariables(brandColour);
  const body = Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

/** Product-level custom properties, emitted once per app. */
export function baseThemeVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(palette)) {
    vars[`--color-${kebab(name)}`] = value;
  }
  for (const [name, value] of Object.entries(spacing)) {
    vars[`--space-${name}`] = value;
  }
  for (const [name, value] of Object.entries(radii)) {
    vars[`--radius-${name}`] = value;
  }
  for (const [name, value] of Object.entries(shadows)) {
    vars[`--shadow-${name}`] = value;
  }
  vars['--font-sans'] = typography.fontSans;
  vars['--font-mono'] = typography.fontMono;
  return vars;
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
