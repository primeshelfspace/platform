/**
 * Tailwind preset built from the design tokens.
 *
 * Both applications extend this, so the palette has exactly one definition. The
 * product palette resolves to literal values; anything brand-controlled
 * resolves to a CSS custom property, which is what allows one component set to
 * render in any brand's colours without recompilation (TSD-001 §3.4).
 */

import { palette, radii, shadows, spacing, typography } from './tokens.js';

export const tailwindPreset = {
  theme: {
    extend: {
      colors: {
        canvas: palette.canvas,
        surface: palette.surface,
        'surface-muted': palette.surfaceMuted,
        'surface-sunken': palette.surfaceSunken,
        border: palette.border,
        'border-strong': palette.borderStrong,
        ink: palette.ink,
        'ink-strong': palette.inkStrong,
        'ink-muted': palette.inkMuted,
        'ink-subtle': palette.inkSubtle,
        'ink-inverse': palette.inkInverse,
        success: palette.success,
        'success-surface': palette.successSurface,
        warning: palette.warning,
        'warning-surface': palette.warningSurface,
        danger: palette.danger,
        'danger-surface': palette.dangerSurface,
        info: palette.info,
        'info-surface': palette.infoSurface,
        accent: palette.accent,
        'accent-surface': palette.accentSurface,

        // Brand-controlled. Resolved at runtime from the active brand's theme,
        // with the foreground computed for contrast rather than assumed.
        brand: 'var(--brand)',
        'brand-foreground': 'var(--brand-foreground)',
        'brand-ink': 'var(--brand-ink)',
      },
      spacing: spacing as Record<string, string>,
      borderRadius: radii as Record<string, string>,
      boxShadow: shadows as Record<string, string>,
      fontFamily: {
        sans: typography.fontSans.split(',').map((f) => f.trim()),
        mono: typography.fontMono.split(',').map((f) => f.trim()),
      },
      fontSize: typography.size as Record<string, string>,
    },
  },
} as const;

export default tailwindPreset;
