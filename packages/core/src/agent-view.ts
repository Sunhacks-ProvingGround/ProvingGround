import { db } from "./db.js";
import { MarketView } from "./market-view.js";

/**
 * What the AI agent sees. Two versions with the same shape:
 *  - NormalView: real tickers, real dates, real prices and posts.
 *  - BlindView:  the same market in disguise, so the model can't recognise
 *                the period from memory (tickers renamed, prices rescaled,
 *                dates replaced by day numbers, posts redacted).
 * Both read through MarketView, so the database still hides the future.
 */
export interface AgentBar {
  date: string; // "2020-02-21" or "Day 19"
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface AgentPost {
  date: string;
  text: string;
  sentiment: string | null;
}

export interface AgentView {
  mode: "normal" | "blind";
  /** Today's date as the agent sees it. */
  today(): string;
  /** Names the agent uses for the stocks it may hold, in order. */
  tradeable(): string[];
  /** Name the agent uses for the market benchmark. */
  benchmark(): string;
  /** One-line description of each name, shown in the prompt. */
  describe(): Record<string, string>;
  getPrices(name: string, days: number): Promise<AgentBar[]>;
  getPosts(name: string, days: number, limit: number): Promise<AgentPost[]>;
  /** Converts the agent's weights (by display name) back to real tickers. */
  toRealTargets(targets: Record<string, number>): Record<string, number>;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export class NormalView implements AgentView {
  readonly mode = "normal" as const;
  constructor(
    private market: MarketView,
    private trade: string[],
    private bench: string,
    private names: Record<string, string> = { AAPL: "Apple Inc.", NVDA: "NVIDIA Corporation", SPY: "SPDR S&P 500 ETF (the US stock market)" },
  ) {}
  today() {
    const d = new Date(`${this.market.simDate}T12:00:00Z`);
    return `${d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}, ${this.market.simDate}`;
  }
  tradeable() { return this.trade; }
  benchmark() { return this.bench; }
  describe() {
    return Object.fromEntries([...this.trade, this.bench].map((t) => [t, this.names[t] ?? t]));
  }
  async getPrices(name: string, days: number) {
    const bars = await this.market.getPrices(name, days);
    return bars.map((b) => ({ date: b.day, open: round(b.open), high: round(b.high), low: round(b.low), close: round(b.close) }));
  }
  async getPosts(name: string, days: number, limit: number) {
    const posts = await this.market.getPosts(name, days, limit);
    return posts.map((p) => ({ date: p.day, text: p.text, sentiment: p.sentiment }));
  }
  toRealTargets(targets: Record<string, number>) { return targets; }
}

/**
 * Shared, per-run state for blind mode: the alias for each ticker, the
 * rescaling factor (from the close on the run's first day, which is known
 * on day one), and the trading calendar used to turn dates into day numbers.
 */
export class Disguise {
  readonly alias: Record<string, string> = {};
  readonly real: Record<string, string> = {};
  private scale: Record<string, number> = {};
  private dayIndex = new Map<string, number>();
  private calendar: string[] = [];

  private constructor(private start: string) {}

  static async create(start: string, trade: string[], bench: string): Promise<Disguise> {
    const d = new Disguise(start);
    trade.forEach((t, i) => {
      const a = `STOCK_${String.fromCharCode(65 + i)}`;
      d.alias[t] = a;
      d.real[a] = t;
    });
    d.alias[bench] = "INDEX";
    d.real.INDEX = bench;

    // Scale every series so it closes at 100 on the first test day.
    const day0 = new MarketView(start, [...trade, bench]);
    const closes = await day0.latestCloses();
    for (const t of [...trade, bench]) {
      if (!closes[t]) throw new Error(`No close for ${t} on or before ${start}`);
      d.scale[t] = 100 / closes[t];
    }
    // Trading calendar (dates only) so dates can become "Day N". Never shown to the agent.
    const { rows } = await db().query(
      `SELECT to_char(day,'YYYY-MM-DD') AS day FROM prices WHERE ticker = $1 ORDER BY day`,
      [bench],
    );
    d.calendar = rows.map((r) => r.day);
    const zero = d.calendar.findIndex((x) => x >= start);
    d.calendar.forEach((day, i) => d.dayIndex.set(day, i - zero));
    return d;
  }

  /** "Day 0" is the first test day; earlier history has negative numbers. */
  label(date: string): string {
    let i = this.dayIndex.get(date);
    if (i === undefined) {
      // Weekend or holiday (posts): use the most recent trading day before it.
      const prev = [...this.calendar].reverse().find((d) => d <= date);
      i = prev ? this.dayIndex.get(prev)! : 0;
    }
    return `Day ${i}`;
  }

  rescale(ticker: string, price: number): number {
    return round(price * this.scale[ticker]);
  }

  /** Removes what would let the model recognise the company or the period. */
  redact(text: string): string {
    let s = text;
    // Names can be glued to hashtags or suffixes (#AppleInc, $NVDA's), so match prefixes too.
    const companyWords: Record<string, RegExp> = {
      AAPL: /[#$]?\b(AAPL|Apple\w*|iPhones?|iPads?|Macs?|MacBooks?|AirPods|iOS|Tim\s?Cook|Cupertino|App\s?Store)\b/gi,
      NVDA: /[#$]?\b(NVDA|NVIDIA\w*|Jensen|Huang|GeForce|RTX|GTX|CUDA|Mellanox)\b/gi,
      SPY: /[#$]?\b(SPY|S&P\s?500|S&P)/gi,
    };
    for (const [t, re] of Object.entries(companyWords)) {
      if (this.alias[t]) s = s.replace(re, this.alias[t]);
    }
    // Other tickers ($TSLA, $AMD...): hide them too.
    s = s.replace(/\$[A-Z]{1,5}\b/g, (m) => (Object.values(this.alias).includes(m.slice(1)) ? m : "$OTHER"));
    // Prices, years, dates.
    s = s.replace(/\$\s?\d[\d,]*(\.\d+)?\s?[kKmMbB]?/g, "[price]");
    s = s.replace(/(?<!\d)(19|20)\d{2}/g, "[year]"); // also catches years glued to times, e.g. "20206:26"
    s = s.replace(/\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?\s+\d{1,2}(st|nd|rd|th)?\b/gi, "[date]");
    s = s.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, "[date]");
    // The event itself.
    s = s.replace(/\w*(covid|coron[ao]|virus)\w*(-?19)?/gi, "[event]"); // misspellings and joined words: Coronovirus, iVirus
    s = s.replace(/🦠|😷|🍏|🍎/g, "");
    s = s.replace(/\b(pandemic|epidemic|outbreak|wuhan|quarantine[sd]?|lockdowns?|social distancing|wfh|work from home|stay at home|cdc|hubei|ventilators?|masks?|infections?|infected|vaccines?)\b/gi, "[event]");
    s = s.replace(/\bWHO\b/g, "[event]");
    s = s.replace(/\b(china|chinese|bay area|silicon valley|california|new york|nyc|italy|europe)\b/gi, "[region]");
    s = s.replace(/\b(trump|powell|mnuchin|biden|pelosi)\b/gi, "[official]");
    return s;
  }
}

export class BlindView implements AgentView {
  readonly mode = "blind" as const;
  constructor(
    private market: MarketView,
    private trade: string[],
    private bench: string,
    private disguise: Disguise,
  ) {}
  today() { return this.disguise.label(this.market.simDate); }
  tradeable() { return this.trade.map((t) => this.disguise.alias[t]); }
  benchmark() { return this.disguise.alias[this.bench]; }
  describe() {
    return {
      ...Object.fromEntries(this.tradeable().map((a) => [a, "a large US-listed company"])),
      [this.benchmark()]: "a broad US stock market index fund (watch only, not tradeable)",
    };
  }
  private realName(name: string): string {
    const t = this.disguise.real[name];
    if (!t) throw new Error(`Unknown name "${name}". Use one of: ${[...this.tradeable(), this.benchmark()].join(", ")}`);
    return t;
  }
  async getPrices(name: string, days: number) {
    const t = this.realName(name);
    const bars = await this.market.getPrices(t, days);
    const r = (p: number) => this.disguise.rescale(t, p);
    return bars.map((b) => ({ date: this.disguise.label(b.day), open: r(b.open), high: r(b.high), low: r(b.low), close: r(b.close) }));
  }
  async getPosts(name: string, days: number, limit: number) {
    const t = this.realName(name);
    const posts = await this.market.getPosts(t, days, limit);
    return posts.map((p) => ({ date: this.disguise.label(p.day), text: this.disguise.redact(p.text), sentiment: p.sentiment }));
  }
  toRealTargets(targets: Record<string, number>) {
    return Object.fromEntries(Object.entries(targets).map(([a, w]) => [this.disguise.real[a] ?? a, w]));
  }
}
