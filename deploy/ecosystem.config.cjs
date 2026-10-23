// pm2 process definitions for the backend on the EC2 host. Not used locally.
// The web app has its own repository (primeshelfspace/sugrpay-frontend).
//
// Three APIs, each its own program and port, plus Sugrpay's background
// worker. nginx puts each API on its own address (deploy/nginx/api.conf):
//   platform-api  :4001   platform-api.sugrpay.com
//   sugrpay-api   :4002   sugrpay-api.sugrpay.com
//   hq-api        :4003   hq-api.sugrpay.com (skeleton until HQ is built)
// and api.sugrpay.com still accepts every path, passing each to its owner.
//
// Backoff protection: a transient database outage must not turn into a
// restart storm. The `start` scripts load the repository-root .env through
// scripts/with-env.mjs, which never takes NODE_ENV from the file — so it is
// set here.
const path = require('node:path');

// Repository root — this file lives in deploy/.
const ROOT = path.join(__dirname, '..');

const program = (name, args) => ({
  name,
  cwd: ROOT,
  script: '/usr/bin/pnpm',
  args,
  env: { NODE_ENV: 'production' },
  exp_backoff_restart_delay: 2000,
  max_restarts: 20,
});

module.exports = {
  apps: [
    program('platform-api', '--filter @platform/platform-api start'),
    program('sugrpay-api', '--filter @platform/sugrpay-api start'),
    program('sugrpay-worker', '--filter @platform/sugrpay-api start:worker'),
    program('hq-api', '--filter @platform/hq-api start'),
  ],
};
