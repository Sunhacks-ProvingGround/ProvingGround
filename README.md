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
pnpm db:fetch               # downloads 2019-09 to 2020-07 prices into data/prices.csv (commit it)
pnpm db:load                # loads data/prices.csv into the database
pnpm db:check               # proves the agent cannot see past the simulated day
```

## Layout

```
db/schema.sql      Tables, row-level security rule, append-only run log
packages/core      Database access, MarketView (the agent's only view of the market), scripts
apps/api           Backend (coming next)
apps/web           UI (coming next)
```

## How "no future data" works

The agent's queries run inside `asOf(simDate, ...)`, which switches the connection to the
`agent_reader` role and sets `app.sim_date` for that transaction. A row-level security policy
on `prices` hides every row dated after `app.sim_date`, so even `SELECT * FROM prices`
returns nothing from the future. `pnpm db:check` demonstrates this.
