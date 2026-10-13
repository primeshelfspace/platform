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

/** First path segment under src/ — 'platform', 'invoicing', 'adapters', or
 * the file name itself for root files such as app.module.ts. */
const ownerOf = (abs: string) => relative(SRC, abs).split(sep)[0]!;

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
  e.to === join(e.toOwner, 'public-api.ts') || e.to === join(e.toOwner, 'modules.ts');

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
      (e) => !MODULES.includes(e.fromOwner) && e.fromOwner.includes('.') === false &&
        PRODUCTS.includes(e.toOwner),
    );
    expect(violations.map(describeEdge)).toEqual([]);
  });

  it('modules are reached only through their public-api.ts or modules.ts', () => {
    const violations = edges.filter((e) => !isPublicApi(e));
    expect(violations.map(describeEdge)).toEqual([]);
  });
});
