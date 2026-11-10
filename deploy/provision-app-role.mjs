import postgres from 'postgres';

const ROLE = 'colony_app';
const OWNER = 'colony';
const MARKER = 'COLONY runtime role managed by deploy/provision-app-role.mjs';
const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;

async function main() {
  const password = process.env.APP_DB_PASSWORD || '';
  const databaseUrl = process.env.DATABASE_URL || '';
  if (!/^[a-f0-9]{64,256}$/i.test(password)) {
    throw new Error('APP_DB_PASSWORD must contain 64–256 random hexadecimal characters.');
  }
  let url;
  try { url = new URL(databaseUrl); }
  catch { throw new Error('DATABASE_URL must be the database-owner PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.username) !== OWNER) {
    throw new Error('Provisioning must connect as the colony database owner.');
  }

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 1, onnotice() {} });
  try {
    await sql.begin(async tx => {
      const [connection] = await tx`SELECT current_user AS owner, current_database() AS database`;
      if (connection.owner !== OWNER) throw new Error('Unexpected database owner.');
      const [existing] = await tx`
        SELECT r.oid, shobj_description(r.oid, 'pg_authid') AS marker
        FROM pg_roles r WHERE r.rolname=${ROLE}
      `;
      if (existing && existing.marker !== MARKER) {
        throw new Error('An unmanaged colony_app role already exists; review it before provisioning.');
      }
      if (existing) {
        const memberships = await tx`SELECT 1 FROM pg_auth_members WHERE member=${existing.oid} LIMIT 1`;
        if (memberships.length) throw new Error('The runtime role has unexpected role memberships.');
      }
      // Password literals are necessary for CREATE/ALTER ROLE; strict hex validation
      // above excludes SQL syntax. Never print this statement or raw driver errors.
      await tx.unsafe(`${existing ? 'ALTER' : 'CREATE'} ROLE ${ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
      if (!existing) await tx.unsafe(`COMMENT ON ROLE ${ROLE} IS '${MARKER}'`);
      await tx.unsafe(`GRANT CONNECT ON DATABASE ${quoteIdentifier(connection.database)} TO ${ROLE}`);
      await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
      await tx.unsafe(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
      await tx.unsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`);
      await tx.unsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${ROLE}`);
      const [privileges] = await tx`
        SELECT has_schema_privilege(${ROLE}, 'public', 'CREATE') AS schema_create,
               r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls
        FROM pg_roles r WHERE r.rolname=${ROLE}
      `;
      if (Object.values(privileges).some(Boolean)) {
        throw new Error('Runtime privileges are too broad; review schema PUBLIC grants before provisioning.');
      }
    });
  } finally { await sql.end({ timeout: 3 }); }

  const appUrl = new URL(databaseUrl);
  appUrl.username = ROLE;
  appUrl.password = password;
  const appSql = postgres(appUrl.toString(), { max: 1, connect_timeout: 10, idle_timeout: 1, onnotice() {} });
  try {
    const [identity] = await appSql`SELECT current_user AS role`;
    if (identity.role !== ROLE) throw new Error('Runtime role authentication failed.');
  } finally { await appSql.end({ timeout: 3 }); }
  console.log('Runtime role colony_app provisioned and authentication verified; database owner retained for migrations.');
}

main().catch(error => {
  // PostgreSQL errors may contain the executed SQL/password. Only expose local
  // validation messages; SQLSTATE alone is enough for the server-side failure.
  const localMessages = new Set([
    'APP_DB_PASSWORD must contain 64–256 random hexadecimal characters.',
    'DATABASE_URL must be the database-owner PostgreSQL URL.',
    'Provisioning must connect as the colony database owner.',
    'Unexpected database owner.',
    'An unmanaged colony_app role already exists; review it before provisioning.',
    'The runtime role has unexpected role memberships.',
    'Runtime privileges are too broad; review schema PUBLIC grants before provisioning.',
    'Runtime role authentication failed.',
  ]);
  const code = /^[A-Z0-9]{5}$/.test(error?.code || '') ? ` (SQLSTATE ${error.code})` : '';
  console.error(localMessages.has(error?.message) ? error.message : `Runtime role provisioning failed${code}; inspect database connectivity and owner permissions without logging credentials.`);
  process.exitCode = 1;
});
