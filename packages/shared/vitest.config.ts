import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/money/**', 'src/domain/**'],
      // Barrels re-export and nothing else; countries/regions/brand-defaults
      // are static reference data with no branches to exercise. NFR-TST-001
      // targets "the calculation and state machine modules" specifically —
      // none of these are that, so a threshold breach here would just be
      // padding, not a signal.
      exclude: [
        'src/money/index.ts',
        'src/domain/index.ts',
        'src/domain/countries.ts',
        'src/domain/regions.ts',
        'src/domain/brand-defaults.ts',
      ],
      // NFR-TST-001: 90% on the calculation and state machine modules.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
