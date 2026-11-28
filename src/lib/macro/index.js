// Everything the Macro page needs, in one bundle:
//  • FRED macro series (yields, real yields, inflation, jobs, dollar, VIX, credit, liquidity)
//  • Daily gold and Nasdaq futures since 2005 (Yahoo), and hourly bars around recent
//    CPI / jobs / Fed releases for the intraday event study
//  • CFTC positioning (gold managed money, Nasdaq leveraged funds and asset managers)
//  • This week's and next week's economic calendar, and recent market headlines
// The browser does the analysis, so every number on the page can be traced to this data.
// Each source is cached on its own and serves its last good copy if a refresh fails.
import { EVENTS } from './dates.js';
import { getNews } from '../news.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; TradePursuit/1.0)', Accept: '*/*' };
const H = 3600e3, DAY = 24 * H;

// id: [name, unit, frequency, days after the observation date that it is public]
export const FRED = {
  DFII10: ['10-year real yield (TIPS)', '%', 'd', 0],
  DGS10: ['10-year Treasury yield', '%', 'd', 0],
  DGS2: ['2-year Treasury yield', '%', 'd', 0],
  T10YIE: ['10-year breakeven inflation', '%', 'd', 0],
  DTWEXBGS: ['US dollar index (broad)', 'index', 'd', 0],
  VIXCLS: ['VIX (stock market fear gauge)', 'index', 'd', 0],
  BAMLH0A0HYM2: ['High-yield credit spread', '%', 'd', 0],
  DFEDTARU: ['Fed funds rate (upper target)', '%', 'd', 0],
  DCOILWTICO: ['WTI crude oil', '$', 'd', 0],
  RRPONTSYD: ['Fed reverse repo', '$bn', 'd', 0],
  WALCL: ['Fed balance sheet', '$m', 'w', 1],
  WTREGEN: ['Treasury cash account (TGA)', '$bn', 'w', 1],
  NFCI: ['Financial conditions (Chicago Fed)', 'index', 'w', 5],
  ICSA: ['Initial jobless claims', 'people', 'w', 5],
  CPIAUCSL: ['CPI', 'index', 'm', 45],
  CPILFESL: ['Core CPI', 'index', 'm', 45],
  PCEPILFE: ['Core PCE prices', 'index', 'm', 60],
  UNRATE: ['Unemployment rate', '%', 'm', 38],
  PAYEMS: ['Non-farm payrolls', 'thousands', 'm', 38],
  SAHMREALTIME: ['Sahm recession indicator (real time)', 'pts', 'm', 38],
  FEDFUNDS: ['Fed funds rate (monthly average)', '%', 'm', 31],
};

// ───────────── Parsers (exported for tests) ─────────────
/** FRED fredgraph.csv -> [[ymd, value]] (blank or "." rows dropped) */
export function parseFredCsv(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  if (!/^(observation_date|DATE),/i.test(lines[0] || '')) throw new Error(`not a FRED csv (starts with: ${String(csv).slice(0, 40)})`);
  const out = [];
  for (const l of lines.slice(1)) {
    const [d, v] = l.split(',');
    const n = Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v !== '' && v !== '.' && Number.isFinite(n)) out.push([d, n]);
  }
  return out;
}

const weekOf = (ymd) => { const t = Date.parse(ymd + 'T00:00:00Z'); return Math.floor((t / DAY + 3) / 7); }; // Monday-based week number
/** Daily series -> last observation of each week (keeps the latest value exactly) */
export function toWeekly(points) {
  const out = [];
  for (const p of points) {
    if (out.length && weekOf(out.at(-1)[0]) === weekOf(p[0])) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** Yahoo daily chart -> [[ymd, o, h, l, c]] using the exchange's own calendar date */
export function parseYahooDaily(json) {
  const res = json?.chart?.result?.[0];
  if (!res) throw new Error(json?.chart?.error?.description || 'empty Yahoo response');
  const q = res.indicators?.quote?.[0] || {};
  const off = (res.meta?.gmtoffset || 0) * 1000;
  const out = [];
  (res.timestamp || []).forEach((t, i) => {
    const v = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if (!v.every((x) => Number.isFinite(x) && x > 0)) return;
    const ymd = new Date(t * 1000 + off).toISOString().slice(0, 10);
    const row = [ymd, ...v.map((x) => +x.toFixed(2))];
    if (out.length && out.at(-1)[0] === ymd) out[out.length - 1] = row; else out.push(row);
  });
  return out;
}

/** Yahoo hourly chart -> [[t, o, h, l, c]] */
export function parseYahooHourly(json) {
  const res = json?.chart?.result?.[0];
  if (!res) throw new Error(json?.chart?.error?.description || 'empty Yahoo response');
  const q = res.indicators?.quote?.[0] || {};
  const out = [];
  (res.timestamp || []).forEach((t, i) => {
    const v = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if (v.every((x) => Number.isFinite(x) && x > 0)) out.push([t * 1000, ...v.map((x) => +x.toFixed(2))]);
  });
  return out;
}

/** Hourly bars from 6h before to 10h after each past event, keyed "TYPE:date" */
export function eventWindows(bars, events, now = Date.now()) {
  const out = {};
  if (!bars.length) return out;
  const first = bars[0][0];
  for (const e of events) {
    if (e.at < first || e.at > now) continue;
    const w = bars.filter((b) => b[0] >= e.at - 6 * H && b[0] < e.at + 10 * H);
    if (w.length >= 6) out[`${e.type}:${e.date}`] = w;
  }
  return out;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
/** CFTC Socrata rows -> [[ymd, ...fields]] sorted by date */
export function parseCot(rows, fields) {
  if (!Array.isArray(rows)) throw new Error('CFTC did not return a list');
  return rows
    .map((r) => [String(r.report_date_as_yyyy_mm_dd || '').slice(0, 10), ...fields.map((f) => num(r[f]))])
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r.slice(1).every((v) => v != null))
    .sort((a, b) => a[0].localeCompare(b[0]));
}

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#x27;/g, "'")
  .replace(/\s+/g, ' ').trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : ''; };

/** RSS 2.0 -> [{ title, link, at }] (headline and link only) */
export function parseRss(xml) {
  const items = String(xml).match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return items.map((it) => {
    const pub = tag(it, 'pubDate');
    // Investing.com writes "2026-11-15 03:12:19" (UTC) with no zone
    const at = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(pub) ? pub.replace(' ', 'T') + 'Z' : pub);
    return { title: tag(it, 'title'), link: tag(it, 'link') || tag(it, 'guid'), at: Number.isFinite(at) ? at : null };
  }).filter((x) => x.title && /^https?:\/\//.test(x.link));
}

// ───────────── Fetching ─────────────
const get = async (fetchImpl, url, as = 'text', ms = 15000) => {
  const r = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return as === 'json' ? r.json() : r.text();
};

/** Run async jobs with at most n in flight */
async function pool(jobs, n) {
  const out = new Array(jobs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length) { const k = i++; out[k] = await jobs[k]().then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })); }
  }));
  return out;
}

async function loadFred(fetchImpl) {
  const ids = Object.keys(FRED);
  const res = await pool(ids.map((id) => () => get(fetchImpl, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=2003-01-01`).then(parseFredCsv)), 6);
  const fred = {}, missing = [];
  ids.forEach((id, k) => {
    const [name, unit, freq, lag] = FRED[id];
    if (!res[k].ok || !res[k].v.length) { missing.push(id); return; }
    fred[id] = { name, unit, freq, lag, points: freq === 'd' ? toWeekly(res[k].v) : res[k].v };
  });
  if (missing.length > ids.length / 2) throw new Error(`FRED: ${missing.length} of ${ids.length} series failed`);
  return { fred, missing };
}

const ASSETS = { XAUUSD: { yahoo: 'GC=F', name: 'Gold futures' }, NAS100: { yahoo: 'NQ=F', name: 'Nasdaq 100 futures' } };
const chart = (sym, q) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${q}`;

async function loadPrices(fetchImpl) {
  const p1 = Math.floor(Date.parse('2005-01-01') / 1000), p2 = Math.floor(Date.now() / 1000);
  const out = {};
  for (const [k, a] of Object.entries(ASSETS)) {
    const daily = parseYahooDaily(await get(fetchImpl, chart(a.yahoo, `interval=1d&period1=${p1}&period2=${p2}`), 'json'));
    if (daily.length < 1000) throw new Error(`too few daily bars for ${a.yahoo}`);
    out[k] = { name: a.name, source: `${a.yahoo} (Yahoo)`, daily };
  }
  return out;
}

async function loadIntraday(fetchImpl) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 728 * 86400; // Yahoo keeps ~730 days of hourly bars
  const out = {};
  for (const [k, a] of Object.entries(ASSETS)) {
    const bars = parseYahooHourly(await get(fetchImpl, chart(a.yahoo, `interval=1h&period1=${p1}&period2=${p2}`), 'json'));
    out[k] = eventWindows(bars, EVENTS);
  }
  return out;
}

const SOCRATA = 'https://publicreporting.cftc.gov/resource';
const COT = {
  XAUUSD: { ds: '72hh-3qpy', code: '088691', group: 'Managed money (hedge funds)', fields: ['m_money_positions_long_all', 'm_money_positions_short_all', 'open_interest_all'] },
  NAS100: { ds: 'gpe5-46if', code: '209742', group: 'Leveraged funds and asset managers', fields: ['lev_money_positions_long', 'lev_money_positions_short', 'asset_mgr_positions_long', 'asset_mgr_positions_short', 'open_interest_all'] },
};
async function loadCot(fetchImpl) {
  const out = {};
  for (const [k, c] of Object.entries(COT)) {
    const q = new URLSearchParams({
      cftc_contract_market_code: c.code,
      $select: ['report_date_as_yyyy_mm_dd', ...c.fields].join(','),
      $where: "report_date_as_yyyy_mm_dd >= '2010-01-01'",
      $order: 'report_date_as_yyyy_mm_dd',
      $limit: '5000',
    });
    out[k] = { group: c.group, fields: c.fields, rows: parseCot(await get(fetchImpl, `${SOCRATA}/${c.ds}.json?${q}`, 'json'), c.fields) };
  }
  return out;
}

const FEEDS = [
  ['Federal Reserve', 'https://www.federalreserve.gov/feeds/press_all.xml'],
  ['Investing.com', 'https://www.investing.com/rss/news_11.rss'],
  ['Investing.com', 'https://www.investing.com/rss/news_14.rss'],
  ['Investing.com', 'https://www.investing.com/rss/news_25.rss'],
  ['Investing.com', 'https://www.investing.com/rss/news_1.rss'],
  ['FXStreet', 'https://www.fxstreet.com/rss/news'],
  ['MarketWatch', 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines'],
];
async function loadHeadlines(fetchImpl) {
  const res = await pool(FEEDS.map(([, url]) => () => get(fetchImpl, url, 'text', 8000).then(parseRss)), 4);
  const since = Date.now() - 7 * DAY, seen = new Set(), out = [];
  res.forEach((r, k) => {
    if (!r.ok) return;
    for (const it of r.v) {
      const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (it.at == null || it.at < since || it.at > Date.now() + H || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...it, source: FEEDS[k][0] });
    }
  });
  if (!out.length && res.every((r) => !r.ok)) throw new Error('no news feed answered');
  return out.sort((a, b) => b.at - a.at).slice(0, 250);
}

async function loadCalendar(fetchImpl) {
  const weeks = await Promise.allSettled([getNews('thisweek', fetchImpl), getNews('nextweek', fetchImpl)]);
  const ev = weeks.flatMap((w) => (w.status === 'fulfilled' ? w.value.events : []));
  if (!ev.length && weeks.every((w) => w.status === 'rejected')) throw new Error(weeks[0].reason?.message || 'calendar unavailable');
  return ev;
}

// ───────────── Cache: each source refreshes on its own schedule ─────────────
const SOURCES = {
  fred: { ttl: 6 * H, load: loadFred },
  prices: { ttl: 1 * H, load: loadPrices },
  intraday: { ttl: 3 * H, load: loadIntraday },
  cot: { ttl: 12 * H, load: loadCot },
  calendar: { ttl: 30 * 60e3, load: loadCalendar },
  headlines: { ttl: 20 * 60e3, load: loadHeadlines },
};
const cache = new Map(); // key -> { at, data }
const fails = new Map(); // key -> { at, reason }
const BACKOFF = 5 * 60e3;
let inflight = null;

async function source(key, fetchImpl) {
  const s = SOURCES[key], hit = cache.get(key), f = fails.get(key);
  if (hit && Date.now() - hit.at < s.ttl) return { data: hit.data, status: { ok: true, at: hit.at } };
  if (f && Date.now() - f.at < BACKOFF) return { data: hit?.data ?? null, status: { ok: !!hit, stale: !!hit, at: hit?.at, error: f.reason } };
  try {
    const data = await s.load(fetchImpl);
    cache.set(key, { at: Date.now(), data });
    fails.delete(key);
    return { data, status: { ok: true, at: Date.now() } };
  } catch (e) {
    console.error(`[macro] ${key}: ${e.message}`);
    fails.set(key, { at: Date.now(), reason: e.message });
    return { data: hit?.data ?? null, status: { ok: !!hit, stale: !!hit, at: hit?.at, error: e.message } };
  }
}

export async function getMacro(fetchImpl = fetch) {
  if (inflight) return inflight; // many tabs opening at once share one refresh
  inflight = (async () => {
    const keys = Object.keys(SOURCES);
    const got = await Promise.all(keys.map((k) => source(k, fetchImpl)));
    const by = Object.fromEntries(keys.map((k, i) => [k, got[i]]));
    if (!by.prices.data) throw Object.assign(new Error('Market prices are unavailable right now, try again in a few minutes'), { status: 502, reason: by.prices.status.error });
    return {
      updatedAt: new Date().toISOString(),
      fred: by.fred.data?.fred || {},
      fredMissing: by.fred.data?.missing || [],
      prices: by.prices.data,
      intraday: by.intraday.data || {},
      cot: by.cot.data || {},
      calendar: by.calendar.data || [],
      headlines: by.headlines.data || [],
      events: EVENTS,
      status: Object.fromEntries(keys.map((k) => [k, by[k].status])),
    };
  })();
  try { return await inflight; } finally { inflight = null; }
}

export const _resetMacroCache = () => { cache.clear(); fails.clear(); };
