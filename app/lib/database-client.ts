export type DatabaseRow = Record<string, unknown>;
type Query = (text: string, values?: unknown[]) => Promise<DatabaseRow[]>;
export type DatabaseClient = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<DatabaseRow[]>;
  query: Query;
};

export function databaseProvider(connectionString: string): "neon" | "postgres" {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Gebruik een geldige PostgreSQL-verbindingsstring.");
  }
  return /\.(neon\.tech|neon\.build)$/i.test(url.hostname) ? "neon" : "postgres";
}

export function createSqlTag(query: Query): DatabaseClient {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!Array.isArray(strings.raw) || strings.length !== values.length + 1) {
      throw new Error("Gebruik SQL als tagged template of via sql.query met parameters.");
    }
    const text = strings.reduce((text, part, index) => `${text}${index ? `$${index}` : ""}${part}`, "");
    return query(text, values);
  };
  return Object.assign(sql, { query });
}

export function postgresConnectionOptions(connectionString: string, ca?: string) {
  const url = new URL(connectionString);
  databaseProvider(connectionString);
  // Keep TLS options explicit: URL sslmode options override pg's ssl object.
  for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return {
    connectionString: url.toString(),
    ssl: local ? false as const : { rejectUnauthorized: true, ...(ca ? { ca: ca.replace(/\\n/g, "\n") } : {}) },
    max: 3,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    query_timeout: 15_000,
    maxLifetimeSeconds: 300,
    allowExitOnIdle: true,
  };
}

export async function createDatabaseClient(connectionString: string): Promise<DatabaseClient> {
  if (databaseProvider(connectionString) === "neon") {
    const { neon } = await import("@neondatabase/serverless");
    const client = neon<false, false>(connectionString, { fullResults: false, arrayMode: false });
    return createSqlTag(async (text, values) => client.query(text, values) as Promise<DatabaseRow[]>);
  }
  const { Pool } = await import("pg");
  const pool = new Pool(postgresConnectionOptions(connectionString, process.env.DATABASE_CA_CERT));
  // pg discards broken idle clients. The next query opens a new connection and
  // reports any continuing failure through the existing availability handling.
  pool.on("error", () => {});
  return createSqlTag(async (text, values) => (await pool.query(text, values)).rows as DatabaseRow[]);
}
