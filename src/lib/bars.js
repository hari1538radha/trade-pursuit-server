// Hourly futures candles for the Daily levels page (gold, silver, Nasdaq).
// The browser turns these into sessions, standard-deviation levels, the opening move and
// the market state, so every number on the page can be traced back to these candles.
const MAP = {
  XAUUSD: { yahoo: 'GC=F', stooq: 'xauusd', name: 'Gold', spotName: 'XAUUSD spot' },
  XAGUSD: { yahoo: 'SI=F', stooq: 'xagusd', name: 'Silver', spotName: 'XAGUSD spot' },
  NAS100: { yahoo: 'NQ=F', stooq: null, name: 'Nasdaq 100', spotName: null },
};
export const BAR_SYMBOLS = Object.keys(MAP);
const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; TradePursuit/1.0)', Accept: '*/*' };
const cache = new Map();
const TTL = 5 * 60 * 1000;

/** Yahoo chart JSON -> [[t, o, h, l, c], ...] (t = bar start, ms) */
export function barsFromYahoo(json) {
  const res = json?.chart?.result?.[0];
  if (!res) throw new Error(json?.chart?.error?.description || 'Empty response');
  const q = res.indicators?.quote?.[0] || {};
  const out = [];
  (res.timestamp || []).forEach((t, i) => {
    const row = [t * 1000, q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if (row.slice(1).every(Number.isFinite)) out.push(row.map((v, k) => (k ? +v.toFixed(3) : v)));
  });
  return { bars: out, last: res.meta?.regularMarketPrice ?? out.at(-1)?.[4] ?? null };
}

/** Stooq quote CSV (Symbol,Date,Time,Open,High,Low,Close) -> last price */
export function lastFromStooq(csv) {
  const v = +(String(csv).trim().split(/\r?\n/)[1] || '').split(',')[6];
  return Number.isFinite(v) && v > 0 ? v : null;
}

export async function getBars(symbol, fetchImpl = fetch) {
  const m = MAP[symbol];
  if (!m) throw Object.assign(new Error(`Unsupported symbol ${symbol}`), { status: 400 });
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  try {
    const [chart, spotCsv] = await Promise.all([
      fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(m.yahoo)}?interval=1h&range=6mo`, { headers, signal: AbortSignal.timeout(10000) })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Yahoo HTTP ${r.status}`)))),
      m.stooq ? fetchImpl(`https://stooq.com/q/l/?s=${m.stooq}&f=sd2t2ohlc&h&e=csv`, { headers, signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.text() : '')).catch(() => '') : '',
    ]);
    const { bars, last } = barsFromYahoo(chart);
    if (bars.length < 200) throw new Error('too few hourly candles');
    const spot = m.stooq ? lastFromStooq(spotCsv) : null;
    // Futures trade at a premium to spot: report it so the page can shift levels onto spot / CFD prices
    const basis = spot && last ? +(last - spot).toFixed(3) : 0;
    const data = {
      symbol, name: m.name, bars, futures: last, spot, basis,
      source: spot ? `${m.yahoo} futures (Yahoo), shifted to ${m.spotName} (Stooq)` : `${m.yahoo} futures (Yahoo)`,
      updatedAt: new Date().toISOString(),
    };
    cache.set(symbol, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (hit) return { ...hit.data, stale: true };
    throw Object.assign(new Error(`No price data for ${symbol} right now`), { status: 502, reason: e.message });
  }
}

export const _resetBarsCache = () => cache.clear();
