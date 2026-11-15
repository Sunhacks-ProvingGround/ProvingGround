-- ProvingGround schema. Safe to run more than once.

-- ---------- Market data ----------
CREATE TABLE IF NOT EXISTS prices (
  ticker  text    NOT NULL,
  day     date    NOT NULL,
  open    double precision NOT NULL,
  high    double precision NOT NULL,
  low     double precision NOT NULL,
  close   double precision NOT NULL,
  volume  bigint  NOT NULL,
  PRIMARY KEY (ticker, day)
);

-- On TigerData, turn prices into a hypertable. Skipped on plain Postgres.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable('prices', 'day', if_not_exists => true, migrate_data => true);
  END IF;
END $$;

-- ---------- The "no future data" rule ----------
-- The agent's queries run as agent_reader with app.sim_date set for that transaction.
-- Row-level security hides every row dated after the simulated day, even for queries
-- with no date filter at all. If app.sim_date is unset, the agent sees nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_reader') THEN
    CREATE ROLE agent_reader NOLOGIN;
  END IF;
END $$;

GRANT agent_reader TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO agent_reader;
GRANT SELECT ON prices TO agent_reader;

ALTER TABLE prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS no_future ON prices;
CREATE POLICY no_future ON prices FOR SELECT TO agent_reader
  USING (day <= NULLIF(current_setting('app.sim_date', true), '')::date);
-- The table owner (the app itself, for loading data and grading after a run)
-- is not subject to these policies, so it still sees everything.

-- ---------- Runs ----------
CREATE TABLE IF NOT EXISTS runs (
  id          uuid PRIMARY KEY,
  seq         bigserial UNIQUE,            -- order in the run log
  created_at  timestamptz NOT NULL DEFAULT now(),
  agent       text NOT NULL,               -- 'buy_and_hold' | 'sma_crossover' | 'llm'
  mode        text NOT NULL,               -- 'normal' | 'blind'
  config      jsonb NOT NULL,              -- tickers, dates, fee, model, prompt version
  prev_hash   text NOT NULL,               -- hash of the previous run in the log
  hash        text NOT NULL,               -- sha256(prev_hash + config), set before the run starts
  status      text NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  summary     jsonb,                       -- final return, Leakage Gap inputs, etc.
  result_hash text,                        -- sha256 of the final results
  finished_at timestamptz
);

-- The run log is append-only: runs cannot be deleted, and their identity cannot change.
CREATE OR REPLACE FUNCTION protect_run_log() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'runs are append-only and cannot be deleted';
  END IF;
  IF NEW.id <> OLD.id OR NEW.seq <> OLD.seq OR NEW.config <> OLD.config
     OR NEW.prev_hash <> OLD.prev_hash OR NEW.hash <> OLD.hash
     OR NEW.created_at <> OLD.created_at OR NEW.agent <> OLD.agent OR NEW.mode <> OLD.mode THEN
    RAISE EXCEPTION 'a registered run cannot be changed';
  END IF;
  IF OLD.result_hash IS NOT NULL AND NEW.result_hash IS DISTINCT FROM OLD.result_hash THEN
    RAISE EXCEPTION 'a finished run''s results cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS runs_append_only ON runs;
CREATE TRIGGER runs_append_only BEFORE UPDATE OR DELETE ON runs
  FOR EACH ROW EXECUTE FUNCTION protect_run_log();

-- Portfolio value at the end of each simulated day.
CREATE TABLE IF NOT EXISTS run_days (
  run_id    uuid NOT NULL REFERENCES runs(id),
  day       date NOT NULL,
  cash      double precision NOT NULL,
  equity    double precision NOT NULL,
  positions jsonb NOT NULL,
  PRIMARY KEY (run_id, day)
);

-- Every trade, with its grade once the run is finished.
CREATE TABLE IF NOT EXISTS trades (
  id           bigserial PRIMARY KEY,
  run_id       uuid NOT NULL REFERENCES runs(id),
  decided_on   date NOT NULL,              -- the simulated day the agent decided
  filled_on    date NOT NULL,              -- next trading day's open
  ticker       text NOT NULL,              -- always the real ticker, even in blind mode
  side         text NOT NULL,              -- 'buy' | 'sell'
  qty          double precision NOT NULL,
  price        double precision NOT NULL,
  fee          double precision NOT NULL,
  reason       text,                       -- what the agent said at the time
  fwd_return   double precision,           -- grading: price move over the next 5 days
  edge_vs_cash double precision,           -- grading: how much better than holding cash
  grade        text,                       -- 'good' | 'bad' | 'neutral'
  explanation  text                        -- one-line review written after the run
);
CREATE INDEX IF NOT EXISTS trades_run_idx ON trades(run_id);
