/** Stocks the agent can trade. Both have StockTwits posts for 2020. */
export const TRADE_TICKERS = ["AAPL", "NVDA"];

/** Market benchmark. The agent can see its prices but it has no posts. */
export const BENCHMARK = "SPY";

/** Everything the agent can look at. */
export const DEFAULT_TICKERS = [...TRADE_TICKERS, BENCHMARK];

/** Main test: 60 trading days around the COVID crash (bottom on 2020-03-23). */
export const DEMO_WINDOW = { start: "2020-01-24", end: "2020-04-20" };

/**
 * Control test: 60 trading days after the AI model's training data ends,
 * so it cannot remember what happened. Prices only (posts end in 2020).
 * If the Leakage Gap is large in 2020 but near zero here, the gap is memory, not noise.
 */
export const CONTROL_WINDOW = { start: "2026-07-01", end: "2026-09-24" };

/** Trading days after a trade used to grade it. */
export const GRADE_HORIZON_DAYS = 5;

/** Every ticker in data/prices.csv, for pickers and prompts. */
export const TICKER_INFO: { ticker: string; name: string; kind: "stock" | "etf" }[] = [
  { ticker: "SPY", name: "SPDR S&P 500 ETF (US stock market)", kind: "etf" },
  { ticker: "QQQ", name: "Invesco QQQ (Nasdaq-100)", kind: "etf" },
  { ticker: "GLD", name: "SPDR Gold Shares", kind: "etf" },
  { ticker: "TLT", name: "iShares 20+ Year Treasury Bond ETF", kind: "etf" },
  { ticker: "AAPL", name: "Apple", kind: "stock" },
  { ticker: "MSFT", name: "Microsoft", kind: "stock" },
  { ticker: "NVDA", name: "NVIDIA", kind: "stock" },
  { ticker: "AMZN", name: "Amazon", kind: "stock" },
  { ticker: "GOOGL", name: "Alphabet", kind: "stock" },
  { ticker: "META", name: "Meta Platforms", kind: "stock" },
  { ticker: "TSLA", name: "Tesla", kind: "stock" },
  { ticker: "NFLX", name: "Netflix", kind: "stock" },
  { ticker: "AMD", name: "Advanced Micro Devices", kind: "stock" },
  { ticker: "INTC", name: "Intel", kind: "stock" },
  { ticker: "JPM", name: "JPMorgan Chase", kind: "stock" },
  { ticker: "XOM", name: "Exxon Mobil", kind: "stock" },
  { ticker: "CVX", name: "Chevron", kind: "stock" },
  { ticker: "JNJ", name: "Johnson & Johnson", kind: "stock" },
  { ticker: "PFE", name: "Pfizer", kind: "stock" },
  { ticker: "UNH", name: "UnitedHealth Group", kind: "stock" },
  { ticker: "WMT", name: "Walmart", kind: "stock" },
  { ticker: "COST", name: "Costco", kind: "stock" },
  { ticker: "HD", name: "Home Depot", kind: "stock" },
  { ticker: "KO", name: "Coca-Cola", kind: "stock" },
  { ticker: "DIS", name: "Walt Disney", kind: "stock" },
  { ticker: "BA", name: "Boeing", kind: "stock" },
];

export const tickerName = (t: string) => TICKER_INFO.find((x) => x.ticker === t)?.name ?? t;
