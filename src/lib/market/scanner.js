// Technical setups on daily bars. Input: { d:[], o:[], h:[], l:[], c:[], v:[], val:[] } oldest -> newest.

export const SETUPS = {
  '52w-high-breakout': { label: '52-week high breakout', side: 'long', desc: 'Closed at a new 52-week high.' },
  'near-52w-high': { label: 'Near 52-week high', side: 'long', desc: 'Within 3% of the 52-week high.' },
  'near-52w-low': { label: 'Near 52-week low (support)', side: 'watch', desc: 'Within 3% of the 52-week low: a key support level to watch.' },
  '52w-low-bounce': { label: '52-week low bounce', side: 'long', desc: 'Touched the 52-week low in the last 5 days and closed 3%+ off it.' },
  'breakout-20d': { label: '20-day breakout on volume', side: 'long', desc: 'Closed above the prior 20-day high with 1.5x+ average volume.' },
  'breakdown-20d': { label: '20-day breakdown on volume', side: 'short', desc: 'Closed below the prior 20-day low with 1.5x+ average volume.' },
  'resistance-breakout': { label: 'Resistance breakout', side: 'long', desc: 'Closed above a tested resistance level today.' },
  'support-breakdown': { label: 'Support breakdown', side: 'short', desc: 'Closed below a tested support level today.' },
  'near-support': { label: 'At support', side: 'long', desc: 'Within 2% above a level tested 2+ times.' },
  'near-resistance': { label: 'At resistance', side: 'watch', desc: 'Within 2% below a level tested 2+ times.' },
  'volume-spike': { label: 'Volume spike', side: 'watch', desc: 'Volume 3x+ the 20-day average.' },
  'nr7': { label: 'NR7 squeeze', side: 'watch', desc: 'Narrowest range of the last 7 days: often precedes a big move.' },
  'inside-day': { label: 'Inside day', side: 'watch', desc: "Today's range sits inside yesterday's." },
  'gap-up': { label: 'Gap up 3%+', side: 'long', desc: 'Opened 3%+ above the previous close.' },
  'gap-down': { label: 'Gap down 3%+', side: 'short', desc: 'Opened 3%+ below the previous close.' },
  'golden-cross': { label: 'Golden cross', side: 'long', desc: '50-day average crossed above the 200-day in the last 5 days.' },
  'uptrend': { label: 'Strong uptrend', side: 'long', desc: 'Price above the 50-day, which is above the 200-day.' },
  'rsi-oversold': { label: 'RSI oversold', side: 'watch', desc: 'RSI(14) below 30.' },
  'rsi-overbought': { label: 'RSI overbought', side: 'watch', desc: 'RSI(14) above 70.' },
};

const last = (a, k = 1) => a[a.length - k];
const sma = (a, n, end = a.length) => (end >= n ? a.slice(end - n, end).reduce((s, x) => s + x, 0) / n : null);
const max = (a) => a.reduce((m, x) => (x > m ? x : m), -Infinity);
const min = (a) => a.reduce((m, x) => (x < m ? x : m), Infinity);

export function rsi(c, n = 14) {
  if (c.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

export function atr(s, n = 14) {
  const tr = [];
  for (let i = 1; i < s.c.length; i++) tr.push(Math.max(s.h[i] - s.l[i], Math.abs(s.h[i] - s.c[i - 1]), Math.abs(s.l[i] - s.c[i - 1])));
  return tr.length >= n ? sma(tr, n) : null;
}

/** Cut history at the last suspected split/bonus (a 45%+ overnight jump) so levels aren't distorted. */
export function trimCorporateActions(s) {
  let start = 0;
  for (let i = 1; i < s.c.length; i++) { const r = s.o[i] / s.c[i - 1]; if (r < 0.55 || r > 1.8) start = i; }
  if (!start) return s;
  const cut = (a) => a.slice(start);
  return { ...s, d: cut(s.d), o: cut(s.o), h: cut(s.h), l: cut(s.l), c: cut(s.c), v: cut(s.v), val: cut(s.val || []), adjusted: true };
}

/** Swing-pivot support/resistance levels over the last `lookback` bars, clustered within `tol`. */
export function levels(s, lookback = 120, w = 5, tol = 0.015) {
  const n = s.c.length, from = Math.max(w, n - lookback), pts = [];
  for (let i = from; i < n - w; i++) {
    const hs = s.h.slice(i - w, i + w + 1), ls = s.l.slice(i - w, i + w + 1);
    if (s.h[i] === max(hs)) pts.push(s.h[i]);
    if (s.l[i] === min(ls)) pts.push(s.l[i]);
  }
  pts.sort((a, b) => a - b);
  const clusters = [];
  for (const p of pts) {
    const c = clusters.at(-1);
    if (c && p <= c.price * (1 + tol)) { c.sum += p; c.touches++; c.price = c.sum / c.touches; } else clusters.push({ price: p, sum: p, touches: 1 });
  }
  return clusters.filter((c) => c.touches >= 2).map((c) => ({ price: +c.price.toFixed(2), touches: c.touches }));
}

export function analyze(raw) {
  const s = trimCorporateActions(raw);
  const n = s.c.length;
  if (n < 30) return null;
  const c = last(s.c), pc = s.c[n - 2], o = last(s.o), h = last(s.h), l = last(s.l), v = last(s.v);
  const look = Math.min(252, n - 1);
  const prevHi = max(s.h.slice(n - 1 - look, n - 1)), prevLo = min(s.l.slice(n - 1 - look, n - 1));
  const hi52 = Math.max(prevHi, h), lo52 = Math.min(prevLo, l);
  const avgVol20 = sma(s.v, 20, n - 1) || 0;
  const vals = s.val?.length === n ? s.val : s.c.map((x, i) => x * s.v[i]);
  const turnoverCr = (sma(vals, Math.min(20, n), n) || 0) / 1e7;
  const volRatio = avgVol20 ? v / avgVol20 : 0;
  const hh20 = max(s.h.slice(n - 21, n - 1)), ll20 = min(s.l.slice(n - 21, n - 1));
  const sma20 = sma(s.c, 20), sma50 = sma(s.c, 50), sma200 = sma(s.c, 200);
  const r = rsi(s.c), a = atr(s);
  const lv = levels(s);
  const support = lv.filter((x) => x.price < c).at(-1) || null;
  const resistance = lv.find((x) => x.price > c) || null;
  const tags = [];
  const add = (t) => tags.push(t);
  if (n > 120 && h > prevHi && c >= prevHi) add('52w-high-breakout');
  else if (n > 120 && c >= hi52 * 0.97) add('near-52w-high');
  if (n > 120 && c <= lo52 * 1.03) add('near-52w-low');
  const low5 = min(s.l.slice(n - 5));
  if (n > 120 && low5 <= lo52 * 1.01 && c >= low5 * 1.03) add('52w-low-bounce');
  if (c > hh20 && volRatio >= 1.5) add('breakout-20d');
  if (c < ll20 && volRatio >= 1.5) add('breakdown-20d');
  const crossedUp = lv.find((x) => pc < x.price && c > x.price);
  const crossedDown = lv.find((x) => pc > x.price && c < x.price);
  if (crossedUp) add('resistance-breakout');
  if (crossedDown) add('support-breakdown');
  if (support && (c - support.price) / c <= 0.02 && !crossedUp) add('near-support');
  if (resistance && (resistance.price - c) / c <= 0.02) add('near-resistance');
  if (volRatio >= 3) add('volume-spike');
  const ranges = s.h.slice(n - 7).map((x, i) => x - s.l[n - 7 + i]);
  if (n >= 7 && h - l <= min(ranges)) add('nr7');
  if (h <= s.h[n - 2] && l >= s.l[n - 2]) add('inside-day');
  if (pc && o / pc - 1 >= 0.03) add('gap-up');
  if (pc && o / pc - 1 <= -0.03) add('gap-down');
  if (sma200 && sma50) {
    for (let k = 0; k < 5; k++) {
      const e = n - k, a50 = sma(s.c, 50, e), a200 = sma(s.c, 200, e), b50 = sma(s.c, 50, e - 1), b200 = sma(s.c, 200, e - 1);
      if (a50 && a200 && b50 && b200 && b50 <= b200 && a50 > a200) { add('golden-cross'); break; }
    }
    if (c > sma50 && sma50 > sma200) add('uptrend');
  }
  if (r != null && r < 30) add('rsi-oversold');
  if (r != null && r > 70) add('rsi-overbought');
  const round = (x) => (x == null ? null : +x.toFixed(2));
  return {
    date: last(s.d), close: c, chgPct: pc ? (c / pc - 1) * 100 : 0, open: o, high: h, low: l, volume: v, volRatio: round(volRatio), turnoverCr: round(turnoverCr),
    hi52: round(hi52), lo52: round(lo52), fromHigh: round((c / hi52 - 1) * 100), fromLow: round((c / lo52 - 1) * 100),
    sma20: round(sma20), sma50: round(sma50), sma200: round(sma200), rsi: round(r), atr: round(a),
    support: support?.price ?? null, supportTouches: support?.touches ?? 0, resistance: resistance?.price ?? null, resistanceTouches: resistance?.touches ?? 0,
    stop: round(a ? (support && support.price < c && c - support.price < 3 * a ? support.price - 0.25 * a : c - 1.5 * a) : null),
    tags, bars: n, adjusted: !!s.adjusted,
  };
}
