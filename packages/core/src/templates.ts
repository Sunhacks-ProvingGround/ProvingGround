/** Starter code shown on the website. Every template follows the documented input and output format. */

export const MODEL_FORMAT_DOC = `Write two functions in plain JavaScript.

function train(data)
  Called once with the first 80% of the training period. The last 20% (at least
  40 trading days) is held out: after training, decide() is scored on both parts
  so you can see accuracy, F1 and whether the model overfit.
  Return what your model learned:
    return { state: {...}, metrics: { name: number, ... } }   // or just the state
  The state must be plain JSON. Metrics are optional and shown after training.

function decide(state, history, portfolio)
  Called after every close, in training (to score the model) and in tests.
  Return target weights for the next open, as fractions of the portfolio:
    return { AAPL: 0.4, MSFT: 0.3 }                          // rest stays in cash
    return { weights: { AAPL: 0.4 }, reason: "why" }         // with a reason
    return null                                              // keep current holdings
  Weights are 0 to 1 and add up to at most 1 (no shorting, no leverage).
  Trades smaller than 1% of the portfolio are skipped; each trade costs 0.1%.

data and history have the same shape, oldest first:
  data.tickers          ["AAPL", "MSFT"]
  data.dates[i]         "2019-03-04"
  data.close.AAPL[i]    adjusted close (also open, high, low, volume)
history holds the last 252 trading days up to and including today. Nothing
after today exists: the database refuses it.

portfolio = { cash, equity, weights: { AAPL: 0.4, ... }, day: "2021-06-01" }

Helpers: pg.mean, pg.std, pg.sum, pg.last(a, n), pg.returns(prices),
pg.change(prices, n, i), pg.sma(prices, n, i), pg.clip(x, lo, hi),
pg.ridge(X, y, lambda) -> weights, pg.predict(weights, x), and log(...) to print.
Limits: no network, files or imports; train() has 60 s, decide() has 2 s.`;

export const CODE_TEMPLATES: { id: string; name: string; description: string; code: string }[] = [
  {
    id: "momentum",
    name: "Momentum (trained lookback)",
    description: "Holds the stocks that went up most recently. Training picks the lookback that worked best on the training period.",
    code: `// Momentum: hold the top stocks by recent return, if that return is positive.
// train() tries a few lookbacks and keeps the one with the best Sharpe ratio.

const TOP = 2; // how many stocks to hold at once

function pickWeights(close, tickers, i, lookback) {
  const scored = tickers
    .map((t) => ({ t, r: pg.change(close[t], lookback, i) }))
    .filter((x) => x.r > 0)
    .sort((a, b) => b.r - a.r)
    .slice(0, TOP);
  const w = {};
  for (const x of scored) w[x.t] = 1 / TOP;
  return w;
}

function train(data) {
  let best = { lookback: 20, sharpe: -Infinity };
  for (const lookback of [10, 20, 40, 60, 120]) {
    const daily = [];
    for (let i = lookback; i < data.dates.length - 1; i++) {
      const w = pickWeights(data.close, data.tickers, i, lookback);
      daily.push(pg.sum(data.tickers.map((t) => (w[t] || 0) * (data.close[t][i + 1] / data.close[t][i] - 1))));
    }
    const sharpe = pg.std(daily) > 0 ? (pg.mean(daily) / pg.std(daily)) * Math.sqrt(252) : 0;
    log("lookback", lookback, "sharpe", sharpe.toFixed(2));
    if (sharpe > best.sharpe) best = { lookback, sharpe };
  }
  return { state: { lookback: best.lookback }, metrics: { chosenLookback: best.lookback, trainSharpe: best.sharpe } };
}

function decide(state, history) {
  const i = history.dates.length - 1;
  const weights = pickWeights(history.close, history.tickers, i, state.lookback);
  const names = Object.keys(weights);
  return { weights, reason: names.length ? "Strongest " + state.lookback + "-day momentum: " + names.join(", ") : "No stock has positive momentum" };
}
`,
  },
  {
    id: "regression",
    name: "Ridge regression on recent returns",
    description: "Learns how the next 5 days' return relates to recent returns, volatility and trend, then holds the stocks it predicts will rise.",
    code: `// Predict each stock's next 5-day return from simple features, with ridge regression.
// Hold the stocks with a positive prediction, sized by how strong it is.

const H = 5; // prediction horizon in trading days

function features(close, i) {
  return [
    pg.change(close, 1, i),
    pg.change(close, 5, i),
    pg.change(close, 20, i),
    pg.std(pg.returns(close.slice(i - 20, i + 1))),
    close[i] / pg.sma(close, 50, i) - 1,
  ];
}

function train(data) {
  const X = [], y = [];
  for (const t of data.tickers) {
    const c = data.close[t];
    for (let i = 50; i < c.length - H; i++) {
      X.push(features(c, i));
      y.push(c[i + H] / c[i] - 1);
    }
  }
  if (X.length < 50) throw new Error("Need a longer training period (at least ~60 trading days).");
  const w = pg.ridge(X, y, 0.01);
  const pred = X.map((x) => pg.predict(w, x));
  const hits = pred.filter((p, k) => Math.sign(p) === Math.sign(y[k])).length;
  const my = pg.mean(y);
  const ssTot = pg.sum(y.map((v) => (v - my) ** 2));
  const ssRes = pg.sum(y.map((v, k) => (v - pred[k]) ** 2));
  return {
    state: { w },
    metrics: { samples: X.length, directionAccuracy: hits / X.length, r2: 1 - ssRes / ssTot },
  };
}

function decide(state, history) {
  const i = history.dates.length - 1;
  if (i < 50) return null;
  const preds = history.tickers.map((t) => ({ t, p: pg.predict(state.w, features(history.close[t], i)) }));
  const pos = preds.filter((x) => x.p > 0.002);
  const total = pg.sum(pos.map((x) => x.p));
  const weights = {};
  for (const x of pos) weights[x.t] = pg.clip(x.p / total, 0, 0.6);
  return { weights, reason: preds.map((x) => x.t + " " + (x.p * 100).toFixed(2) + "%").join(", ") + " predicted over 5 days" };
}
`,
  },
  {
    id: "mean-reversion",
    name: "Mean reversion (trained threshold)",
    description: "Buys stocks after an unusually sharp 5-day drop and sells when they recover. Training picks how sharp a drop counts.",
    code: `// Buy a stock after an unusually large 5-day drop (in standard deviations); sell when it recovers.

function zscore(close, i) {
  const r5 = pg.change(close, 5, i);
  const vol = pg.std(pg.returns(close.slice(i - 60, i + 1))) * Math.sqrt(5);
  return vol > 0 ? r5 / vol : 0;
}

function weightsFor(close, tickers, i, k) {
  const picks = tickers.filter((t) => zscore(close[t], i) < -k);
  const w = {};
  for (const t of picks) w[t] = 1 / tickers.length;
  return w;
}

function train(data) {
  let best = { k: 1.5, score: -Infinity };
  for (const k of [1, 1.5, 2, 2.5]) {
    const daily = [];
    for (let i = 61; i < data.dates.length - 1; i++) {
      const w = weightsFor(data.close, data.tickers, i, k);
      daily.push(pg.sum(data.tickers.map((t) => (w[t] || 0) * (data.close[t][i + 1] / data.close[t][i] - 1))));
    }
    const score = pg.mean(daily) / (pg.std(daily) || 1);
    if (score > best.score) best = { k, score };
  }
  return { state: { k: best.k }, metrics: { threshold: best.k } };
}

function decide(state, history) {
  const i = history.dates.length - 1;
  if (i < 61) return null;
  const weights = weightsFor(history.close, history.tickers, i, state.k);
  const names = Object.keys(weights);
  return { weights, reason: names.length ? "Oversold (below -" + state.k + " sd): " + names.join(", ") : "Nothing oversold" };
}
`,
  },
];

export const PROMPT_EXAMPLE = `I'm a cautious trend follower. Hold the stocks that have been rising steadily over the last few weeks and are above their 20-day average. Cut a position quickly if it falls more than 5% from where I bought it, or if the whole market (SPY) is falling sharply. Never put more than 40% in one stock, and keep at least 20% in cash.`;
