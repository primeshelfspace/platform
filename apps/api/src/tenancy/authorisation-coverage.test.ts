/**
 * NFR-SEC-012: every route on every controller, checked against the rules
 * the AuthorisationGuard relies on. Pure metadata — no database, no app
 * bootstrap — so it runs everywhere and fails the build on a bad
 * declaration rather than letting it ship.
 *
 *   1. Every handler is either @Public() or carries @RequirePermission.
 *      (The guard fails closed at runtime too; this catches it earlier.)
 *   2. A brand check that reads params.<key> must sit on a route whose path
 *      actually has :<key>. Otherwise the brand resolves to null and the
 *      check is skipped — a brand-scoped role could then act on any brand.
 *   3. A route nested under :brandId must check that brand. brandFrom 'none'
 *      (or 'query'/'body') there would ignore the brand in its own URL.
 *   4. The resource/action pair is one the matrix knows.
 */
import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ACTIONS, RESOURCES } from '@sugrpay/shared';
import { describe, expect, it } from 'vitest';
import { PERMISSION_KEY, PUBLIC_KEY, type PermissionRequirement } from './authorisation.js';

const SRC = join(__dirname, '..');

interface RouteInfo {
  readonly id: string;
  readonly path: string;
  readonly isPublic: boolean;
  readonly requirement: PermissionRequirement | undefined;
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

function joinPath(...parts: (string | string[] | undefined)[]): string {
  const flat = parts.flatMap((p) => (Array.isArray(p) ? p[0] : p) ?? '');
  return `/${flat
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;
}

async function collectRoutes(): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];
  for (const file of controllerFiles(SRC)) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const controller = exported as abstract new (...args: never[]) => unknown;
      const basePath = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
      // Only classes decorated with @Controller carry a base path (possibly '/').
      if (basePath === undefined) continue;

      const classPublic = Reflect.getMetadata(PUBLIC_KEY, controller) === true;
      const classRequirement = Reflect.getMetadata(PERMISSION_KEY, controller) as
        PermissionRequirement | undefined;

      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue; // a private helper, not a route

        const path = joinPath(basePath, Reflect.getMetadata(PATH_METADATA, handler));
        routes.push({
          id: `${RequestMethod[method]} ${path}  (${relative(SRC, file)} → ${name})`,
          path,
          isPublic: Reflect.getMetadata(PUBLIC_KEY, handler) === true || classPublic,
          requirement:
            (Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionRequirement | undefined) ??
            classRequirement,
        });
      }
    }
  }
  return routes;
}

describe('authorisation coverage (every route × the guard’s rules)', async () => {
  const routes = await collectRoutes();

  it('finds the application’s routes', () => {
    // Guards against the walker silently matching nothing.
    expect(routes.length).toBeGreaterThan(50);
  });

  it('declares @Public or @RequirePermission on every route', () => {
    const undeclared = routes.filter((r) => !r.isPublic && !r.requirement).map((r) => r.id);
    expect(undeclared).toEqual([]);
  });

  it('only checks params.<key> on routes that have that path parameter', () => {
    const broken = routes
      .filter((r) => r.requirement && (r.requirement.brandFrom ?? 'params') === 'params')
      .filter((r) => !r.path.split('/').includes(`:${r.requirement!.brandKey ?? 'brandId'}`))
      .map((r) => r.id);
    expect(broken).toEqual([]);
  });

  it('checks the brand on every route nested under :brandId', () => {
    const unchecked = routes
      .filter((r) => r.requirement && r.path.split('/').includes(':brandId'))
      .filter((r) => (r.requirement!.brandFrom ?? 'params') !== 'params')
      .map((r) => r.id);
    expect(unchecked).toEqual([]);
  });

  it('uses only resources and actions the matrix defines', () => {
    const unknown = routes
      .filter((r) => r.requirement)
      .filter(
        (r) =>
          !(RESOURCES as readonly string[]).includes(r.requirement!.resource) ||
          !(ACTIONS as readonly string[]).includes(r.requirement!.action),
      )
      .map((r) => r.id);
    expect(unknown).toEqual([]);
  });
});
