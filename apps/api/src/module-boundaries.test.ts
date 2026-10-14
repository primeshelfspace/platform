/**
 * Module boundaries, enforced by the build rather than by memory.
 *
 *   1. The platform never imports a product.
 *   2. Products never import each other.
 *   3. Anything outside a module reaches it only through its public-api.ts
 *      (building blocks) or modules.ts (Nest modules, for wiring).
 *   4. Shared layers (adapters, infra, config, common, health) never import a
 *      product.
 *
 * A failure here means a dependency was added in the wrong direction. Fix the
 * dependency — add what is needed to the target's public-api.ts, or use an
 * event — rather than relaxing the rule.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = __dirname;
const PLATFORM = 'platform';
const PRODUCTS = ['invoicing', 'hq'];
const MODULES = [PLATFORM, ...PRODUCTS];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

/** Who owns a file: the module name for src/modules/<name>/..., 'shared' for
 * src/shared/..., or the file name itself for root files such as
 * app.module.ts. */
function ownerOf(abs: string): string {
  const [top, second] = relative(SRC, abs).split(sep);
  return top === 'modules' && second ? second : top!;
}

interface Edge {
  readonly from: string;
  readonly to: string;
  readonly fromOwner: string;
  readonly toOwner: string;
}

function crossModuleEdges(): Edge[] {
  const edges: Edge[] = [];
  const specifier = /(?:from|import\(|vi\.mock\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(specifier)) {
      const target = resolve(dirname(file), match[1]!);
      if (!target.startsWith(SRC + sep)) continue;
      const fromOwner = ownerOf(file);
      const toOwner = ownerOf(target);
      if (fromOwner === toOwner || !MODULES.includes(toOwner)) continue;
      edges.push({
        from: relative(SRC, file),
        to: relative(SRC, target).replace(/\.js$/, '.ts'),
        fromOwner,
        toOwner,
      });
    }
  }
  return edges;
}

const describeEdge = (e: Edge) => `${e.from} -> ${e.to}`;
const isPublicApi = (e: Edge) =>
  e.to === join('modules', e.toOwner, 'public-api.ts') ||
  e.to === join('modules', e.toOwner, 'modules.ts');
/** Tests and their *.test-support.ts helpers may build fixtures from another
 * module's internals (a real platform brand for an invoicing test, say). The
 * direction rules still apply to them; only the public-api rule is relaxed. */
const isTestCode = (e: Edge) => /\.test(-support)?\.ts$/.test(e.from);

describe('module boundaries', () => {
  const edges = crossModuleEdges();

  it('finds cross-module imports (sanity check)', () => {
    expect(edges.length).toBeGreaterThan(0);
  });

  it('the platform never imports a product', () => {
    const violations = edges.filter(
      (e) => e.fromOwner === PLATFORM && PRODUCTS.includes(e.toOwner),
    );
    expect(violations.map(describeEdge)).toEqual([]);
  });

  it('products never import each other', () => {
    const violations = edges.filter(
      (e) => PRODUCTS.includes(e.fromOwner) && PRODUCTS.includes(e.toOwner),
    );
    expect(violations.map(describeEdge)).toEqual([]);
  });

  it('shared layers never import a product', () => {
    const violations = edges.filter(
      (e) => e.fromOwner === 'shared' && PRODUCTS.includes(e.toOwner),
    );
    expect(violations.map(describeEdge)).toEqual([]);
  });

  // Clean-architecture layers inside a feature (docs/architecture/layers.md).
  // Test files are exempt: a test may wire whatever it needs.
  describe('feature layers', () => {
    const LAYERS = ['domain', 'application', 'infrastructure', 'interface'] as const;
    type Layer = (typeof LAYERS)[number];
    const layerOf = (rel: string): Layer | null => {
      const parts = rel.split(sep);
      // modules/<module>/<feature>/<layer>/...
      return parts[0] === 'modules' && LAYERS.includes(parts[3] as Layer)
        ? (parts[3] as Layer)
        : null;
    };
    const imports = sourceFiles(SRC)
      .filter((f) => !/\.test(-support)?\.ts$/.test(f))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8');
        return [...text.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((m) => {
          const spec = m[1]!;
          const target = spec.startsWith('.') ? relative(SRC, resolve(dirname(file), spec)) : spec;
          return { from: relative(SRC, file), spec, target };
        });
      });

    const forbidden = (layer: Layer, test: (target: string, spec: string) => boolean) =>
      imports
        .filter((i) => layerOf(i.from) === layer && test(i.target, i.spec))
        .map((i) => `${i.from} -> ${i.spec}`);

    it('domain is pure: no Nest, no database, no other layer', () => {
      expect(
        forbidden(
          'domain',
          (target, spec) =>
            spec.startsWith('@nestjs/') ||
            target.split(sep).includes('database') ||
            ['application', 'infrastructure', 'interface'].includes(layerOf(target) ?? ''),
        ),
      ).toEqual([]);
    });

    it('interface never reaches the database or infrastructure directly', () => {
      expect(
        forbidden(
          'interface',
          (target) =>
            target.split(sep).includes('database') || layerOf(target) === 'infrastructure',
        ),
      ).toEqual([]);
    });

    it('infrastructure never depends on application or interface', () => {
      expect(
        forbidden('infrastructure', (target) =>
          ['application', 'interface'].includes(layerOf(target) ?? ''),
        ),
      ).toEqual([]);
    });
  });

  it('modules are reached only through their public-api.ts or modules.ts', () => {
    const violations = edges.filter((e) => !isPublicApi(e) && !isTestCode(e));
    expect(violations.map(describeEdge)).toEqual([]);
  });
});
