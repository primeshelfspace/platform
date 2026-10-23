/**
 * The API boundaries, enforced by the build rather than by memory.
 *
 *   1. No app imports another app's code: apps/platform, apps/sugrpay and
 *      apps/hq are separate programs with separate databases, and talk only
 *      over HTTP (public routes, or /internal between APIs).
 *   2. No app lists another app as a dependency.
 *   3. Shared packages (packages/*) never import an app.
 *
 * A failure here means a dependency was added in the wrong direction. Ask the
 * other API over HTTP, or move a genuinely shared building block into a
 * package — never import across apps.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const APPS = readdirSync(join(ROOT, 'apps')).filter((name) =>
  existsSync(join(ROOT, 'apps', name, 'package.json')),
);
const PACKAGES = readdirSync(join(ROOT, 'packages')).filter((name) =>
  existsSync(join(ROOT, 'packages', name, 'package.json')),
);

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name === 'generated') return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

/** 'apps/<name>' or 'packages/<name>' for a path inside the repository. */
function ownerOf(abs: string): string {
  const [top, name] = relative(ROOT, abs).split(sep);
  return `${top}/${name}`;
}

function badImports(root: string, allowed: (owner: string) => boolean): string[] {
  const specifier = /(?:from|import\(|vi\.mock\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  const bad: string[] = [];
  for (const file of sourceFiles(root)) {
    for (const match of readFileSync(file, 'utf8').matchAll(specifier)) {
      const target = resolve(dirname(file), match[1]!);
      if (!target.startsWith(ROOT + sep)) continue;
      if (!allowed(ownerOf(target))) {
        bad.push(`${relative(ROOT, file)} -> ${relative(ROOT, target)}`);
      }
    }
  }
  return bad;
}

describe('API boundaries', () => {
  it('finds the apps', () => {
    expect(APPS).toEqual(expect.arrayContaining(['platform', 'sugrpay', 'hq']));
  });

  it.each(APPS)('apps/%s imports no other app', (app) => {
    const self = `apps/${app}`;
    const bad = badImports(join(ROOT, 'apps', app), (owner) => owner === self);
    expect(bad).toEqual([]);
  });

  it.each(APPS)('apps/%s depends on no other app package', (app) => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'apps', app, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const appNames = APPS.map(
      (other) =>
        (
          JSON.parse(readFileSync(join(ROOT, 'apps', other, 'package.json'), 'utf8')) as {
            name: string;
          }
        ).name,
    );
    const bad = Object.keys(pkg.dependencies ?? {}).filter((dep) => appNames.includes(dep));
    expect(bad).toEqual([]);
  });

  it.each(PACKAGES)('packages/%s imports no app', (name) => {
    const bad = badImports(join(ROOT, 'packages', name, 'src'), (owner) =>
      owner.startsWith('packages/'),
    );
    expect(bad).toEqual([]);
  });
});
