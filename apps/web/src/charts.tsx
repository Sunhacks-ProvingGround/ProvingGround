import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ComposedChart, Scatter, ReferenceLine,
} from "recharts";
import type { Trade } from "./api";
import { shortDate, usd, pct } from "./format";

export interface LineSeries {
  key: string;
  label: string;
  color: string; // a CSS var, e.g. "var(--s1)"
  dashed?: boolean;
  width?: number;
  points: { day: string; value: number }[];
}

const tickDate = (d: string) => shortDate(d);
const monthYear = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
/** Short dates for spans under ~13 months, month and year beyond that. */
const tickFor = (days: string[]) => (days.length > 1 && Date.parse(days.at(-1)!) - Date.parse(days[0]) > 400 * 86400000 ? monthYear : tickDate);
const tickMoney = (v: number) =>
  Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(Number.isInteger(v / 1000) ? 0 : 1)}k` : `$${v}`;

/** Several value-over-time lines on one axis, with a shared crosshair tooltip and a legend. */
export function EquityChart({ series, height = 320, baseline }: { series: LineSeries[]; height?: number; baseline?: number }) {
  const days = [...new Set(series.flatMap((s) => s.points.map((p) => p.day)))].sort();
  const data = days.map((day) => {
    const row: Record<string, number | string> = { day };
    for (const s of series) {
      const p = s.points.find((x) => x.day === day);
      if (p) row[s.key] = p.value;
    }
    return row;
  });
  return (
    <div>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 28, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis dataKey="day" tickFormatter={tickFor(days)} minTickGap={40} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
            <YAxis tickFormatter={tickMoney} width={52} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            {baseline != null && <ReferenceLine y={baseline} stroke="var(--ink-3)" strokeDasharray="2 3" />}
            <Tooltip
              cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }}
              content={({ active, label, payload }) =>
                active && payload?.length ? (
                  <div className="tooltip">
                    <div className="t">{shortDate(String(label))}</div>
                    {series.map((s) => {
                      const v = payload.find((p) => p.dataKey === s.key)?.value as number | undefined;
                      return v == null ? null : (
                        <div className="r" key={s.key}>
                          <span><i style={{ display: "inline-block", width: 10, height: 3, background: s.color, marginRight: 6, verticalAlign: "middle" }} />{s.label}</span>
                          <b>{usd(v)}</b>
                        </div>
                      );
                    })}
                  </div>
                ) : null
              }
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={s.width ?? 2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: s.color }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}><i className={s.dashed ? "dash" : ""} style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const gradeColor = { good: "var(--good)", bad: "var(--bad)", neutral: "var(--neutral)", ungraded: "var(--neutral)" } as const;

/** Triangle up for a buy, down for a sell, colored by grade, with a surface ring. */
function TradeMark(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  const t: Trade = payload.trade;
  const s = 7;
  const d = t.side === "buy"
    ? `M ${cx} ${cy - s} L ${cx + s} ${cy + s * 0.75} L ${cx - s} ${cy + s * 0.75} Z`
    : `M ${cx} ${cy + s} L ${cx + s} ${cy - s * 0.75} L ${cx - s} ${cy - s * 0.75} Z`;
  return <path d={d} fill={gradeColor[t.grade]} stroke="var(--surface)" strokeWidth={2} />;
}

/** One stock's closing price with every trade marked on the day it filled. */
export function PriceWithTrades({ ticker, prices, trades, height = 240 }: {
  ticker: string; prices: { day: string; close: number }[]; trades: Trade[]; height?: number;
}) {
  const mine = trades.filter((t) => t.ticker === ticker);
  const data = prices.map((p) => {
    const t = mine.find((x) => x.filledOn === p.day);
    return { day: p.day, close: p.close, mark: t ? t.price : undefined, trade: t };
  });
  // Several trades in one stock on one day are rare; show each on its own row of data.
  const extra = mine.filter((t, i) => mine.findIndex((x) => x.filledOn === t.filledOn) !== i);
  for (const t of extra) data.push({ day: t.filledOn, close: undefined as unknown as number, mark: t.price, trade: t });
  data.sort((a, b) => a.day.localeCompare(b.day));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 28, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickFormatter={tickFor(prices.map((p) => p.day))} minTickGap={40} tickLine={false} axisLine={{ stroke: "var(--line)" }} allowDuplicatedCategory={false} />
          <YAxis width={52} tickLine={false} axisLine={false} domain={["auto", "auto"]} tickFormatter={(v) => v.toFixed(v < 20 ? 1 : 0)} />
          <Tooltip
            cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const row: any = payload[0].payload;
              const t: Trade | undefined = row.trade;
              return (
                <div className="tooltip" style={{ maxWidth: 280 }}>
                  <div className="t">{shortDate(String(label))}</div>
                  {row.close != null && <div className="r"><span>{ticker} close</span><b>{row.close.toFixed(2)}</b></div>}
                  {t && (
                    <>
                      <div className="r"><span>{t.side === "buy" ? "Bought" : "Sold"} at</span><b>{t.price.toFixed(2)}</b></div>
                      <div className="r"><span>Grade</span><b>{t.grade} {t.edgeDollars != null ? usd(t.edgeDollars, true) : ""}</b></div>
                      {t.fwdReturn != null && <div className="r"><span>Next 5 days</span><b>{pct(t.fwdReturn)}</b></div>}
                    </>
                  )}
                </div>
              );
            }}
          />
          <Line type="linear" dataKey="close" stroke="var(--s1)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          <Scatter dataKey="mark" shape={<TradeMark />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TradeLegend() {
  return (
    <div className="legend">
      <span><svg width="14" height="12" aria-hidden><path d="M7 1 L13 11 L1 11 Z" fill="var(--ink-2)" /></svg>Buy</span>
      <span><svg width="14" height="12" aria-hidden><path d="M7 11 L13 1 L1 1 Z" fill="var(--ink-2)" /></svg>Sell</span>
      <span><i style={{ background: "var(--good)", height: 10, width: 10, borderRadius: 5 }} />Good trade</span>
      <span><i style={{ background: "var(--bad)", height: 10, width: 10, borderRadius: 5 }} />Bad trade</span>
      <span><i style={{ background: "var(--neutral)", height: 10, width: 10, borderRadius: 5 }} />About even</span>
    </div>
  );
}

export function GradePill({ grade }: { grade: Trade["grade"] }) {
  const label = { good: "✓ Good", bad: "✗ Bad", neutral: "– Even", ungraded: "? Ungraded" }[grade];
  return <span className={`pill ${grade}`}>{label}</span>;
}
