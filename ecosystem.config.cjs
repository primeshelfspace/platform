// pm2 process definitions for the staging EC2 host. Not used locally.
//
// api/worker get backoff protection because a transient DB outage should not
// turn into a restart storm — reload waits progressively longer between
// attempts instead of hammering the connection every few milliseconds.
const fs = require('node:fs');
const path = require('node:path');

// The build slot scripts/deploy.sh last switched this app to. Re-read on every
// `pm2 startOrReload --update-env`, which is how a deploy goes live. Falls back
// to .next for a box that has never run deploy.sh.
function nextDistDir(app) {
  try {
    return (
      fs.readFileSync(path.join(__dirname, 'apps', app, '.next-slot'), 'utf8').trim() || '.next'
    );
  } catch {
    return '.next';
  }
}

module.exports = {
  apps: [
    {
      name: 'api',
      cwd: '.',
      script: '/usr/bin/pnpm',
      args: '--filter @sugrpay/api start',
      exp_backoff_restart_delay: 2000,
      max_restarts: 20,
    },
    {
      name: 'worker',
      cwd: '.',
      script: '/usr/bin/pnpm',
      args: '--filter @sugrpay/api start:worker',
      exp_backoff_restart_delay: 2000,
      max_restarts: 20,
    },
    {
      // admin/payment's own "start" scripts (with-env.mjs -> next start) are
      // what actually load the repo-root .env; pm2 just invokes them as-is.
      name: 'admin',
      cwd: '.',
      script: '/usr/bin/pnpm',
      args: '--filter @sugrpay/admin start',
      env: { NEXT_DIST_DIR: nextDistDir('admin') },
    },
    {
      name: 'payment',
      cwd: '.',
      script: '/usr/bin/pnpm',
      args: '--filter @sugrpay/payment start',
      env: { NEXT_DIST_DIR: nextDistDir('payment') },
    },
  ],
};
