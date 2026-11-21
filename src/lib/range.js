// The 10-second range check: how much of a normal day's range has today already used?
export const RANGE_SYMBOLS = {
  // symbol: [yahoo ticker, stooq ticker, label]
  XAUUSD: ['GC=F', 'xauusd', 'Gold'],
  XAGUSD: ['SI=F', 'xagusd', 'Silver'],
  NQ: ['NQ=F', 'nq.f', 'Nasdaq 100 futures'],
  ES: ['ES=F', 'es.f', 'S&P 500 futures'],
  YM: ['YM=F', 'ym.f', 'Dow futures'],
  CL: ['CL=F', 'cl.f', 'Crude oil'],
  EURUSD: ['EURUSD=X', 'eurusd', 'Euro / US Dollar'],
  GBPUSD: ['GBPUSD=X', 'gbpusd', 'British Pound / US Dollar'],
  USDJPY: ['JPY=X', 'usdjpy', 'US Dollar / Japanese Yen'],
  BTCUSD: ['BTC-USD', 'btcusd', 'Bitcoin'],
};

/** Verdict from the share of the average range already used. */
export function verdictFor(pct) {
  if (pct == null) return { key: 'closed', label: 'Market closed' };
  if (pct < 0.6) return { key: 'trade', label: 'Value to trade' };
  if (pct < 0.85) return { key: 'caution', label: 'Room is thin, be selective' };
  return { key: 'stand', label: 'Stand aside' };
}

const r2 = (n) => (n == null || !Number.isFinite(n) ? null : +n.toFixed(n >= 100 ? 2 : 5));

/**
 * candles: completed daily candles, oldest first [{date, high, low}]
 * today: { high, low } for the session in progress, or null when the market is closed
 */
export function rangeCheck(symbol, candles, today, lookback = 10) {
  const last = candles.slice(-lookback);
  if (!last.length) throw new Error('No daily candles');
  const ranges = last.map((c) => c.high - c.low);
  const adr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const prev = candles.at(-1);
  const todayRange = today ? today.high - today.low : null;
  const pct = todayRange != null && adr > 0 ? todayRange / adr : null;
  const v = verdictFor(pct);
  const out = {
    symbol, adr: r2(adr), minRange: r2(Math.min(...ranges)), maxRange: r2(Math.max(...ranges)), days: last.length,
    ranges: last.map((c, i) => ({ date: c.date, range: r2(ranges[i]) })),
    pdh: r2(prev.high), pdl: r2(prev.low), todayHigh: r2(today?.high), todayLow: r2(today?.low), todayRange: r2(todayRange),
    pct: pct == null ? null : +(pct * 100).toFixed(1), left: todayRange == null ? null : r2(Math.max(0, adr - todayRange)),
    verdict: v.key, verdictLabel: v.label,
  };
  out.line = pct == null
    ? `${symbol} · ${lookback}-day avg range ${out.adr} · market closed · PDH ${out.pdh} / PDL ${out.pdl}`
    : `${symbol} · ${lookback}-day avg range ${out.adr} · today ${out.todayRange} (${out.pct}%) · ~${out.left} left · PDH ${out.pdh} / PDL ${out.pdl} → ${v.label}`;
  return out;
}

const dayIn = (ts, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));

/** Parse a Yahoo chart response into completed candles + today's session. */
export function fromYahoo(json, now = Date.now()) {
  const res = json?.chart?.result?.[0];
  if (!res) throw new Error(json?.chart?.error?.description || 'Empty response');
  const tz = res.meta?.exchangeTimezoneName;
  const q = res.indicators?.quote?.[0] || {};
  const rows = (res.timestamp || []).map((t, i) => ({ date: dayIn(t * 1000, tz), high: q.high?.[i], low: q.low?.[i] })).filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low));
  const todayKey = dayIn(now, tz);
  let today = null;
  if (rows.at(-1)?.date === todayKey) {
    const c = rows.pop();
    const hi = Math.max(c.high, res.meta?.regularMarketDayHigh ?? -Infinity), lo = Math.min(c.low, res.meta?.regularMarketDayLow ?? Infinity);
    today = { high: hi, low: lo };
  }
  return { candles: rows, today, price: res.meta?.regularMarketPrice ?? null };
}

/** Parse a Stooq daily CSV (Date,Open,High,Low,Close[,Volume]). */
export function fromStooq(csv, now = new Date()) {
  const lines = String(csv).trim().split(/\r?\n/);
  if (!/^date,/i.test(lines[0] || '')) throw new Error('Not a Stooq CSV');
  const rows = lines.slice(1).map((l) => { const [date, , high, low] = l.split(','); return { date, high: +high, low: +low }; }).filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low)).slice(-15);
  const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const today = rows.at(-1)?.date === key ? rows.pop() : null;
  return { candles: rows, today: today && { high: today.high, low: today.low }, price: null };
}

const cache = new Map(); // symbol -> { at, data }
const TTL = 5 * 60 * 1000;

export async function getRange(symbol, fetchImpl = fetch) {
  const map = RANGE_SYMBOLS[symbol];
  if (!map) throw Object.assign(new Error(`Unsupported symbol ${symbol}`), { status: 400 });
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; TradePursuit/1.0)', Accept: '*/*' };
  const reasons = [];
  const sources = [
    ['Yahoo Finance', async () => { const r = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(map[0])}?interval=1d&range=1mo`, { headers, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return fromYahoo(await r.json()); }],
    ['Stooq', async () => { const r = await fetchImpl(`https://stooq.com/q/d/l/?s=${map[1]}&i=d`, { headers, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return fromStooq(await r.text()); }],
  ];
  for (const [name, load] of sources) {
    try {
      const d = await load();
      if (d.candles.length < 5) throw new Error('too few candles');
      const data = { ...rangeCheck(symbol, d.candles, d.today), name: map[2], price: d.price, source: name, updatedAt: new Date().toISOString() };
      cache.set(symbol, { at: Date.now(), data });
      return data;
    } catch (e) { reasons.push(`${name}: ${e.message}`); }
  }
  console.error(`[range] ${symbol}: ${reasons.join('; ')}`);
  if (hit) return { ...hit.data, stale: true };
  throw Object.assign(new Error(`No price data for ${symbol} right now`), { status: 502, reason: reasons.join('; ') });
}

export const _resetRangeCache = () => cache.clear();
