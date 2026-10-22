// Prints the SQL that creates one module's database and logins, built from
// that module's two URLs in the repository's .env. Used by setup-separate-rds.sh.
// Usage: node deploy/production/setup-separate-rds-sql.mjs PLATFORM
// The first line is "-- host <rds host>" so the caller knows where to run it.
import { loadRootEnv } from '../../scripts/lib/env.mjs';

loadRootEnv();
const module = process.argv[2];
const app = new URL(process.env[`${module}_DATABASE_URL`]);
const owner = new URL(process.env[`${module}_DIRECT_DATABASE_URL`]);
const db = app.pathname.slice(1);

const ident = (s) => `"${s.replace(/"/g, '""')}"`;
const literal = (s) => `'${s.replace(/'/g, "''")}'`;

const ownerRole = decodeURIComponent(owner.username);
const appRole = decodeURIComponent(app.username);
const roles = [
  [ownerRole, decodeURIComponent(owner.password)],
  [appRole, decodeURIComponent(app.password)],
];

const out = [`-- host ${app.hostname}`];
for (const [role, password] of roles) {
  const verb = `CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(role)}) THEN 'ALTER' ELSE 'CREATE' END`;
  // No NOSUPERUSER: it is the default, and RDS refuses any mention of the
  // SUPERUSER attribute from its (non-superuser) master login.
  const rest = `' ROLE ${ident(role).replace(/'/g, "''")} LOGIN PASSWORD ${literal(password).replace(/'/g, "''")} NOCREATEROLE'`;
  out.push(`SELECT ${verb} || ${rest} \\gexec`);
}
out.push(`ALTER ROLE ${ident(ownerRole)} CREATEDB;`);
// An RDS master is not a true superuser: it must be a member of a role to
// make that role a database's owner.
out.push(`GRANT ${ident(ownerRole)} TO CURRENT_USER;`);
out.push(
  `SELECT 'CREATE DATABASE ${ident(db)} OWNER ${ident(ownerRole)}' ` +
    `WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${literal(db)}) \\gexec`,
);
out.push(`REVOKE ALL ON DATABASE ${ident(db)} FROM PUBLIC;`);
out.push(
  `GRANT CONNECT, TEMPORARY ON DATABASE ${ident(db)} TO ${ident(ownerRole)}, ${ident(appRole)};`,
);
console.log(out.join('\n'));
