// Lint import rules — the architecture plan's "enforced by the build, not by
// memory". Only dependency-direction rules live here (no style rules): they
// fail `pnpm lint` and show in the editor as soon as a wrong import is typed.
// src/module-boundaries.test.ts checks the same rules from the test suite.
//
// See docs/architecture/modules.md and docs/architecture/layers.md.
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

const API = './apps/api/src';
const MODULES = ['platform', 'invoicing', 'hq'];
const PRODUCTS = ['invoicing', 'hq'];
const PUBLIC_ENTRY = ['./public-api.ts', './modules.ts'];

const mod = (name) => `${API}/modules/${name}`;

/** Which way dependencies may point between modules. Applies to tests too. */
const directionZones = [
  {
    target: mod('platform'),
    from: PRODUCTS.map(mod),
    message: 'The platform never depends on a product. Publish an event instead.',
  },
  ...PRODUCTS.flatMap((product) =>
    PRODUCTS.filter((other) => other !== product).map((other) => ({
      target: mod(product),
      from: mod(other),
      message: `Products never import each other: ${product} must not import ${other}. Use its events or its contracts package.`,
    })),
  ),
  {
    target: `${API}/shared`,
    from: PRODUCTS.map(mod),
    message: 'Shared code never imports a product.',
  },
];

/** Outside a module, only its public-api.ts and modules.ts may be imported. */
const publicApiZones = MODULES.flatMap((module) => {
  const others = MODULES.filter((m) => m !== module).map(mod);
  return [...others, `${API}/shared`, `${API}/*.ts`].map((target) => ({
    target,
    from: mod(module),
    except: PUBLIC_ENTRY,
    message: `Import ${module} only through its public-api.ts or modules.ts.`,
  }));
});

/** Clean-architecture layers inside a feature (modules/<module>/<feature>/<layer>). */
const feature = (layer) => `${API}/modules/*/*/${layer}/**`;
const layerZones = [
  {
    target: feature('domain'),
    from: [
      feature('application'),
      feature('infrastructure'),
      feature('interface'),
      `${API}/modules/*/database/**`,
    ],
    message: 'domain is pure: no application, infrastructure, interface or database imports.',
  },
  {
    target: feature('interface'),
    from: [feature('infrastructure'), `${API}/modules/*/database/**`],
    message: 'interface reaches data only through the application layer.',
  },
  {
    target: feature('infrastructure'),
    from: [feature('application'), feature('interface')],
    message: 'infrastructure never depends on application or interface.',
  },
];

const restrictedPackages = (paths) => [
  'error',
  { paths: paths.map(([name, message]) => ({ name, message })) },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/generated/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.d.ts',
    ],
  },
  {
    // Rules from these plugins are not switched on here; they are registered
    // so existing `eslint-disable` comments naming them stay valid.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parser: tseslint.parser },
    plugins: {
      import: importPlugin,
      '@typescript-eslint': tseslint.plugin,
    },
    settings: {
      'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx', '.mts', '.cts'] },
      'import/resolver': {
        typescript: { project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'] },
      },
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        { zones: [...directionZones, ...publicApiZones, ...layerZones] },
      ],
    },
  },
  // Tests and their *.test-support.ts helpers may build fixtures from another
  // module's internals; the direction rules still apply to them.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.test-support.ts'],
    rules: {
      'import/no-restricted-paths': ['error', { zones: directionZones }],
    },
  },
  // domain stays free of frameworks and persistence.
  {
    files: [`${API.slice(2)}/modules/*/*/domain/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'domain is pure: no Nest.' },
            { group: ['**/database/**', '@prisma/*'], message: 'domain is pure: no database.' },
          ],
        },
      ],
    },
  },
  // The platform never depends on a product's contracts.
  {
    files: [`${API.slice(2)}/modules/platform/**/*.ts`, 'packages/platform-contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedPackages([
        ['@platform/invoicing-contracts', 'The platform never depends on a product.'],
        ['@platform/hq-contracts', 'The platform never depends on a product.'],
      ]),
    },
  },
  // The kernel sits at the bottom: it imports no contracts and no UI.
  {
    files: ['packages/kernel/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedPackages([
        ['@platform/platform-contracts', 'The kernel depends on nothing above it.'],
        ['@platform/invoicing-contracts', 'The kernel depends on nothing above it.'],
        ['@platform/hq-contracts', 'The kernel depends on nothing above it.'],
      ]),
    },
  },
);
