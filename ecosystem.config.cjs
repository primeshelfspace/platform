// pm2 process definitions for the staging EC2 host. Not used locally.
//
// api/worker get backoff protection because a transient DB outage should not
// turn into a restart storm — reload waits progressively longer between
// attempts instead of hammering the connection every few milliseconds.
module.exports = {
  apps: [
    {
      name: 'api',
      cwd: '.',
      script: '/usr/bin/pnpm',
      args: '--filter @fenwick/api start',
      exp_backoff_restart_delay: 2000,
      max_restarts: 20,
    },
    {
      name: 'worker',
      cwd: '.',
      script: '/usr/bin/pnpm',
      args: '--filter @fenwick/api start:worker',
      exp_backoff_restart_delay: 2000,
      max_restarts: 20,
    },
    {
      // admin/payment's own "start" scripts (with-env.mjs -> next start) are
      // what actually load the repo-root .env; pm2 just invokes them as-is.
      name: 'admin',
      cwd: '.',
      script: '/usr/bin/pnpm',
      args: '--filter @fenwick/admin start',
    },
    {
      name: 'payment',
      cwd: '.',
      script: '/usr/bin/pnpm',
      args: '--filter @fenwick/payment start',
    },
  ],
};
