import pg from "pg";
import { requireEnv } from "./env.js";

let pool: pg.Pool | undefined;

/** Shared connection pool for the app. This connection sees all data. */
export function db(): pg.Pool {
  if (!pool) {
    const url = requireEnv("DATABASE_URL");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      ssl: local ? undefined : true, // encrypted, with certificate checks
      max: 10,
    });
  }
  return pool;
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
