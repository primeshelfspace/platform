import type { Config } from 'tailwindcss';
import { tailwindPreset } from '@fenwick/shared/tokens';

export default {
  // @fenwick/ui ships source .tsx (not just compiled dist) specifically so its
  // Tailwind classes — e.g. the toast's `sm:right-0`/`sm:items-end` and its
  // success/warning/info variants — get generated here even when nothing in
  // this app's own source happens to use those same class strings already.
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  presets: [tailwindPreset as unknown as Config],
} satisfies Config;
