#!/usr/bin/env node
/**
 * One-time switch of an existing, certbot-managed nginx site from the single
 * API (127.0.0.1:4000) to the split APIs: the site's `location / { ... }` that
 * proxies to :4000 is replaced by routing by path — Sugrpay's paths to :4002,
 * everything else to :4001, /internal/ refused — the same rule as
 * apiServiceFor (packages/platform-contracts/src/api-routing.ts). Everything
 * certbot added (listeners, certificates) is left as it is.
 *
 *   sudo node deploy/production/route-front-door.mjs /etc/nginx/sites-enabled/api-sugrpay.conf
 *   sudo nginx -t && sudo systemctl reload nginx
 *
 * Keeps a copy of the original one folder up (nginx loads every file in
 * sites-enabled, so never beside it): ../<name>.before-split. Safe to run
 * twice: a file with no :4000 proxy is left unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('usage: route-front-door.mjs <nginx site file>');
  process.exit(1);
}
const text = fs.readFileSync(file, 'utf8');

// The location block that proxies to the old single API, with its directives.
const block = /( *)location \/ \{\n(\s*)proxy_pass http:\/\/127\.0\.0\.1:4000;\n([\s\S]*?)\n\1\}/g;
let changed = 0;
const routed = text.replace(block, (_whole, indent, inner, rest) => {
  changed++;
  const directives = `${inner}${rest
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .join(`\n${inner}`)}`;
  const location = (match, upstream) =>
    `${indent}location ${match} {\n${inner}proxy_pass http://${upstream};\n${directives}\n${indent}}`;
  return [
    `${indent}# The APIs call each other on /internal; never from the internet.`,
    `${indent}location /internal/ { return 404; }`,
    `${indent}# Sugrpay's paths (apiServiceFor); everything else is the platform's.`,
    location(
      '~ ^/(dashboard|public|webhooks/zoho|integrations/zoho|health/queues)(/|$)',
      '127.0.0.1:4002',
    ),
    location(
      '~ ^/brands/[^/]+/(checks|customers|invoices|payments|settings|integrations/zoho)(/|$)',
      '127.0.0.1:4002',
    ),
    location('/', '127.0.0.1:4001'),
  ].join('\n');
});

if (!changed) {
  console.log(`${file}: no :4000 proxy found — left as it is`);
  process.exit(0);
}
const backup = path.join(path.dirname(file), '..', `${path.basename(file)}.before-split`);
fs.writeFileSync(backup, text);
fs.writeFileSync(file, routed);
console.log(`${file}: ${changed} location(s) now route by path (original kept as ${backup})`);
