#!/usr/bin/env node
/**
 * Every app and package may import only the libraries its own package.json
 * declares. With a single, hoisted node_modules (see .npmrc) nothing else
 * stops an undeclared import from working by accident — and for the payment
 * app every dependency is a PCI scope question.
 *
 *   node scripts/check-deps.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { ROOT } from './lib/env.mjs';
import { fail, ok } from './lib/proc.mjs';

const WORKSPACES = ['apps', 'packages'].flatMap((group) =>
  fs
    .readdirSync(path.join(ROOT, group), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, group, d.name, 'package.json')))
    .map((d) => `${group}/${d.name}`),
);
const SOURCE = /\.(ts|tsx|mts|js|mjs|jsx)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'generated', 'coverage']);
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('.next')) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : SOURCE.test(e.name) ? [p] : [];
  });
}

/** "@scope/name/sub" -> "@scope/name", "name/sub" -> "name" */
function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const problems = [];
for (const ws of WORKSPACES) {
  const dir = path.join(ROOT, ws);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const declared = new Set([
    pkg.name,
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  const files = walk(dir).filter((f) => !f.includes(`${path.sep}node_modules${path.sep}`));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const specs = [
      ...text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g),
      ...text.matchAll(/(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
    ].map((m) => m[1]);
    for (const spec of specs) {
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) continue;
      if (BUILTINS.has(spec) || BUILTINS.has(packageName(spec))) continue;
      const name = packageName(spec);
      // Next.js pulls in its own runtime types/modules under these names.
      if (name === 'next' && declared.has('next')) continue;
      // A type-only package (import type { Response } from 'express') is
      // covered by its @types/ declaration.
      const typesName = `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;
      if (!declared.has(name) && !declared.has(typesName)) {
        problems.push(
          `${path.relative(ROOT, file)}: imports "${name}", not declared in ${ws}/package.json`,
        );
      }
    }
  }
}

if (problems.length) {
  for (const p of [...new Set(problems)]) fail(p);
  process.exit(1);
}
ok(`every import is declared (${WORKSPACES.join(', ')})`);
