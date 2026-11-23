// Gold and silver candles for the Goldbach page.
// Candles: COMEX futures from Yahoo (GC=F, SI=F). Spot: Stooq quote (XAUUSD / XAGUSD).
// The futures candles are shifted by the futures-spot basis so levels line up with spot/CFD prices.
const MAP = { XAUUSD: { yahoo: 'GC=F', stooq: 'xauusd', name: 'Gold' }, XAGUSD: { yahoo: 'SI=F', stooq: 'xagusd', name: 'Silver' } };
const INTERVALS = { '15m': '5d', '1h': '1mo', '4h': '3mo', '1d': '1y' };
const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; TradePursuit/1.0)', Accept: '*/*' };
const cache = new Map();

/** Yahoo chart JSON -> [{ t, o, h, l, c }] (4h is built from 1h) */
export function candlesFromYahoo(json, group = 1) {
  const res = json?.chart?.result?.[0];
  if (!res) throw new Error(json?.chart?.error?.description || 'Empty response');
  const q = res.indicators?.quote?.[0] || {};
  const rows = (res.timestamp || []).map((t, i) => ({ t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i] }))
    .filter((r) => [r.o, r.h, r.l, r.c].every(Number.isFinite));
  if (group <= 1) return { candles: rows, last: res.meta?.regularMarketPrice ?? rows.at(-1)?.c };
  const out = [];
  for (let i = 0; i < rows.length; i += group) {
    const g = rows.slice(i, i + group);
    out.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g.at(-1).c });
  }
  return { candles: out, last: res.meta?.regularMarketPrice ?? out.at(-1)?.c };
}

/** Stooq quote CSV (Symbol,Date,Time,Open,High,Low,Close) -> close */
export function spotFromStooq(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  const v = +(lines[1] || '').split(',')[6];
  return Number.isFinite(v) && v > 0 ? v : null;
}

export async function getGoldbachData(symbol, interval = '1h', fetchImpl = fetch) {
  const m = MAP[symbol];
  if (!m) throw Object.assign(new Error(`Unsupported symbol ${symbol}`), { status: 400 });
  if (!INTERVALS[interval]) throw Object.assign(new Error('interval must be 15m, 1h, 4h or 1d'), { status: 400 });
  const key = `${symbol}|${interval}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.data;
  const yInt = interval === '4h' ? '1h' : interval;
  const [chart, daily, spotCsv] = await Promise.all([
    fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(m.yahoo)}?interval=${yInt}&range=${INTERVALS[interval]}`, { headers, signal: AbortSignal.timeout(9000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Yahoo HTTP ${r.status}`)))),
    fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(m.yahoo)}?interval=1d&range=1mo`, { headers, signal: AbortSignal.timeout(9000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetchImpl(`https://stooq.com/q/l/?s=${m.stooq}&f=sd2t2ohlc&h&e=csv`, { headers, signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.text() : '')).catch(() => ''),
  ]);
  const { candles, last } = candlesFromYahoo(chart, interval === '4h' ? 4 : 1);
  const spot = spotFromStooq(spotCsv);
  const basis = spot && last ? +(last - spot).toFixed(3) : 0;
  const shift = (c) => ({ ...c, o: c.o - basis, h: c.h - basis, l: c.l - basis, c: c.c - basis });
  let adr = null;
  if (daily) {
    const d = candlesFromYahoo(daily).candles.slice(-11, -1);
    if (d.length) adr = d.reduce((s, c) => s + (c.h - c.l), 0) / d.length;
  }
  const data = { symbol, name: m.name, interval, candles: candles.slice(-300).map(shift), price: spot ?? (last != null ? last - basis : null), futures: last, spot, basis, adr, source: spot ? 'COMEX futures shifted to spot (Stooq)' : 'COMEX futures (spot unavailable)', updatedAt: new Date().toISOString() };
  cache.set(key, { at: Date.now(), data });
  return data;
}
