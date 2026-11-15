# ProvingGround

A fair exam for AI trading agents. We replay the market one day at a time, the database
refuses to show the agent anything after the simulated day, and we run the same agent on a
disguised market to measure the **Leakage Gap**: how much of its score came from remembering
what happened instead of skill.

## Setup

Needs Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env        # then fill in DATABASE_URL (TigerData) and GEMINI_API_KEY
pnpm db:migrate             # tables, the "no future data" rule, the append-only run log
pnpm db:load                # loads data/prices.csv and data/posts.csv into the database
pnpm db:check               # proves the agent cannot see past the simulated day
```

## Run a backtest

```bash
pnpm backtest                                        # buy-and-hold, 2020 COVID window
pnpm backtest --strategy sma_crossover               # 10/30-day moving-average crossover
pnpm backtest --window control                       # 2026 window, after the AI's training data
pnpm backtest --start 2020-02-01 --end 2020-03-31    # any dates
pnpm backtest --no-save                              # dry run, nothing written
pnpm runs:verify                                     # list every run and check the run log
```

Each run is registered in the run log before it starts and sealed with a hash of its
results when it finishes. `runs:verify` recomputes every hash, so an edited or deleted
run shows up.

## How a simulated day works

1. At the day's open, fill the orders decided after the previous close (0.1% fee).
2. At the close, value the portfolio.
3. After the close, the strategy decides, seeing only data up to that day.

Strategies return target weights (for example `{AAPL: 0.5, NVDA: 0.3}` with the rest in
cash), or `null` to hold. Trades smaller than 1% of the portfolio are skipped.

## Layout

```
db/schema.sql      Tables, row-level security rule, append-only run log
data/              prices.csv (SPY, AAPL, NVDA, 1995-2026) and posts.csv (StockTwits, 2020)
packages/core      Database access, MarketView (the agent's only view of the market),
                   replay engine, strategies, run log, scripts
apps/api           Backend (coming next)
apps/web           UI (coming next)
```

## How "no future data" works

The agent's queries run inside `asOf(simDate, ...)`, which switches the connection to the
`agent_reader` role and sets `app.sim_date` for that transaction. A row-level security policy
on `prices` hides every row dated after `app.sim_date`, so even `SELECT * FROM prices`
returns nothing from the future. `pnpm db:check` demonstrates this.
