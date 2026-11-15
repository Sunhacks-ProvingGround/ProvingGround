/** The demo universe: six large stocks plus the S&P 500 ETF as a benchmark. */
export const DEFAULT_TICKERS = ["AAPL", "MSFT", "AMZN", "TSLA", "JPM", "XOM", "SPY"];

/**
 * Data range stored in the database. It starts early so strategies have
 * history to look back on, and ends late so trades near the end of a test
 * can still be graded on the days that follow.
 */
export const DATA_START = "2019-09-01";
export const DATA_END = "2020-07-31";

/** Default test window: the COVID crash and rebound. */
export const DEFAULT_TEST_START = "2020-01-02";
export const DEFAULT_TEST_END = "2020-04-30";
