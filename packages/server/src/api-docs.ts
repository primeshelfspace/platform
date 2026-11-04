import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '@nestjs/common';
import type { Application, Request, Response } from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-dist';
import { apiServiceFor } from '@platform/platform-contracts';
import type { Env } from './config/env.js';

/**
 * The Swagger pages every API serves: /docs, over docs/api/openapi.json (every
 * endpoint), and /hq/docs, over docs/api/hq-openapi.json (the endpoints HQ
 * uses, with its guide) — both generated from the controllers
 * (`pnpm docs:api`). Plain
 * Express routes rather than a controller: the page and its assets are not
 * part of the API, so the request guard (which refuses any route without a
 * declared permission) never sees them.
 *
 * Every API serves the whole document, all three APIs' routes. In production
 * api.sugrpay.com passes each path on to the API that owns it, so "Try it out"
 * goes there; locally there is no front door, so each path is pointed at its
 * own API's port instead.
 */
const SWAGGER_ASSETS: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
  'favicon-32x32.png': 'image/png',
};

/** One Swagger page: where it is served, its document and how it reads. */
export interface DocsPage {
  /** Served at this path (and its init.js and openapi.json under it). */
  readonly prefix: string;
  /** The generated document, in docs/api/. */
  readonly file: string;
  readonly title: string;
  /** Groups in alphabetical order; otherwise in the document's own order. */
  readonly sortTags: boolean;
}

export const DOCS_PAGES: readonly DocsPage[] = [
  { prefix: '/docs', file: 'openapi.json', title: 'Sugrpay API', sortTags: true },
  // The HQ groups follow the stories, so they keep the document's order.
  { prefix: '/hq/docs', file: 'hq-openapi.json', title: 'HQ API', sortTags: false },
];

/** The page; the Swagger UI assets are shared, served under /docs. */
function pageHtml(page: DocsPage): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${page.title}</title>
    <link rel="icon" type="image/png" href="/docs/favicon-32x32.png" />
    <link rel="stylesheet" href="/docs/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/swagger-ui-bundle.js"></script>
    <script src="${page.prefix}/init.js"></script>
  </body>
</html>
`;
}

function initJs(page: DocsPage): string {
  return `window.ui = SwaggerUIBundle({
  url: '${page.prefix}/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  docExpansion: 'none',
  filter: true,
  persistAuthorization: true,
  displayRequestDuration: true,${page.sortTags ? "\n  tagsSorter: 'alpha'," : ''}
});
`;
}

/** A generated document in docs/api/, found by walking up from here (src or dist). */
function findDocument(name: string): string | null {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'docs', 'api', name);
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

/** The document with `servers` set for where this API runs. */
export function servedDocument(document: Record<string, unknown>, env: Env): object {
  const local = env.APP_ENV === 'local' || env.APP_ENV === 'ci';
  if (!local) {
    return {
      ...document,
      servers: [{ url: env.API_PUBLIC_URL, description: `${env.APP_ENV} (every API)` }],
    };
  }
  const ports = { platform: env.PLATFORM_API_PORT, sugrpay: env.SUGRPAY_API_PORT };
  const paths = document['paths'] as Record<string, Record<string, unknown>>;
  return {
    ...document,
    servers: [{ url: `http://localhost:${ports.platform}`, description: 'local platform API' }],
    paths: Object.fromEntries(
      Object.entries(paths).map(([p, item]) => {
        const service = apiServiceFor(p);
        return [
          p,
          service === 'platform'
            ? item
            : {
                ...item,
                servers: [
                  {
                    url: `http://localhost:${ports[service]}`,
                    description: `local ${service} API`,
                  },
                ],
              },
        ];
      }),
    ),
  };
}

export function mountApiDocs(http: Application, env: Env, logger?: Logger): void {
  if (!env.API_DOCS_ENABLED) return;
  const assets = getAbsoluteFSPath();

  for (const page of DOCS_PAGES) {
    const file = findDocument(page.file);
    if (!file) {
      logger?.warn(`api docs: docs/api/${page.file} not found, ${page.prefix} is off`);
      continue;
    }
    const document = JSON.stringify(
      servedDocument(JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>, env),
    );
    const html = pageHtml(page);
    const init = initJs(page);
    http.get([page.prefix, `${page.prefix}/`], (_request: Request, response: Response) => {
      response.type('html').send(html);
    });
    http.get(`${page.prefix}/init.js`, (_request: Request, response: Response) => {
      response.type('text/javascript').send(init);
    });
    http.get(`${page.prefix}/openapi.json`, (_request: Request, response: Response) => {
      response.type('application/json').send(document);
    });
    logger?.log(`api docs: ${page.prefix}`);
  }

  http.get('/docs/:asset', (request: Request, response: Response) => {
    const asset = String(request.params['asset']);
    const type = SWAGGER_ASSETS[asset];
    if (!type) {
      response.status(404).json({ statusCode: 404, message: 'not found', error: 'Not Found' });
      return;
    }
    response.setHeader('cache-control', 'public, max-age=86400');
    response.type(type).sendFile(path.join(assets, asset));
  });
}
