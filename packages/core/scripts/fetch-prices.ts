// Downloads daily prices from Yahoo Finance into data/prices.csv.
// Run once, then commit the CSV so nobody depends on Yahoo during the demo.
// Usage: pnpm db:fetch
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { repoRoot, DEFAULT_TICKERS, DATA_START, DATA_END } from "../src/index.js";

const toUnix = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);
const period1 = toUnix(DATA_START);
const period2 = toUnix(DATA_END) + 86400;

const lines = ["ticker,day,open,high,low,close,volume"];

for (const ticker of DEFAULT_TICKERS) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${ticker}: Yahoo returned ${res.status}`);
  const json: any = await res.json();
  const r = json.chart?.result?.[0];
  if (!r) throw new Error(`${ticker}: no data in response`);

  const q = r.indicators.quote[0];
  const offset = r.meta?.gmtoffset ?? 0;
  let count = 0;
  r.timestamp.forEach((ts: number, i: number) => {
    const vals = [q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i]];
    if (vals.some((v) => v == null)) return; // skip holidays/gaps Yahoo sometimes includes
    const day = new Date((ts + offset) * 1000).toISOString().slice(0, 10);
    lines.push([ticker, day, ...vals.slice(0, 4).map((v: number) => v.toFixed(4)), vals[4]].join(","));
    count++;
  });
  console.log(`${ticker}: ${count} days`);
}

await mkdir(resolve(repoRoot, "data"), { recursive: true });
const out = resolve(repoRoot, "data/prices.csv");
await writeFile(out, lines.join("\n") + "\n");
console.log(`Wrote ${lines.length - 1} rows to ${out}`);
