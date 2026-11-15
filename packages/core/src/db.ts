import pg from "pg";
import { requireEnv } from "./env.js";

let pool: pg.Pool | undefined;

/** Shared connection pool for the app. This connection sees all data. */
export function db(): pg.Pool {
  if (!pool) {
    const url = withoutSslParams(requireEnv("DATABASE_URL"));
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      // Remote databases (TigerData): always encrypted, with certificate checks.
      ssl: local ? undefined : true,
      max: 10,
    });
  }
  return pool;
}

/**
 * Drops SSL settings like ?sslmode=require from the URL. The code sets SSL
 * itself (above); leaving them in makes the pg driver print a long warning
 * and could override the certificate check.
 */
function withoutSslParams(url: string): string {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  for (const key of ["sslmode", "ssl", "uselibpqcompat"]) params.delete(key);
  const rest = params.toString();
  return url.slice(0, q) + (rest ? `?${rest}` : "");
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * Run `fn` with the database's "no future data" rule switched on.
 *
 * Inside one transaction, we switch to the agent_reader role and set
 * app.sim_date. Row-level security then hides every price dated after
 * `simDate`, no matter what query `fn` runs. Both settings end with the
 * transaction, so the pooled connection is clean afterwards.
 */
export async function asOf<T>(simDate: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(simDate)) throw new Error(`Bad sim date: ${simDate}`);
  const client = await db().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE agent_reader");
    await client.query("SELECT set_config('app.sim_date', $1, true)", [simDate]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
