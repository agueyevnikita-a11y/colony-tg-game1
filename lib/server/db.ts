import postgres from 'postgres';

let client: postgres.Sql | undefined;

function database() {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not configured');
    client = postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return client;
}

// Route modules are imported during a production build. Open the database only
// when a request actually uses it, so compiling never needs runtime secrets.
export const sql = new Proxy(function (...args: unknown[]) {
  return Reflect.apply(database(), undefined, args);
} as unknown as postgres.Sql, {
  get(_target, property) {
    const connection = database();
    const value = Reflect.get(connection, property);
    return typeof value === 'function' ? value.bind(connection) : value;
  },
});

export type Transaction = postgres.TransactionSql;
export type JsonValue = postgres.JSONValue;
