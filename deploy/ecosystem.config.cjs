// pm2 process definitions for the backend on the staging EC2 host. Not used
// locally. The web apps have their own in primeshelfspace/sugrpay-frontend.
//
// api/worker get backoff protection because a transient DB outage should not
// turn into a restart storm — reload waits progressively longer between
// attempts instead of hammering the connection every few milliseconds.
//
// Both `start` scripts load the repository-root .env through
// scripts/with-env.mjs, which deliberately never takes NODE_ENV from the file
// — so it is set here instead.
const path = require('node:path');

// Repository root — this file lives in deploy/.
const ROOT = path.join(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'api',
      cwd: ROOT,
      script: '/usr/bin/pnpm',
      args: '--filter @platform/api start',
      env: { NODE_ENV: 'production' },
      exp_backoff_restart_delay: 2000,
      max_restarts: 20,
    },
    {
      name: 'worker',
      cwd: ROOT,
      script: '/usr/bin/pnpm',
      args: '--filter @platform/api start:worker',
      env: { NODE_ENV: 'production' },
      exp_backoff_restart_delay: 2000,
      max_restarts: 20,
    },
  ],
};
