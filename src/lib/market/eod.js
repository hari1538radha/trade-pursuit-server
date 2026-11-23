// Keeps NSE end-of-day data current and re-runs the scanner. Runs inside the API process.
import { EodSeries, MarketMeta } from '../../models/Market.js';
import { downloadBhavcopy, parseBhavcopy } from './nse.js';
import { analyze } from './scanner.js';

const KEEP = 300; // bars per symbol
const META = 'nse-eod';
export const state = { running: false, done: 0, total: 0, current: null, error: null, startedAt: null };
let cache = null; // { lastDate, results }

const istNow = () => new Date(Date.now() + 5.5 * 3600000); // fields read with getUTC*
const ymd = (d) => d.toISOString().slice(0, 10);

/** Weekdays after `from` up to the latest date whose bhavcopy should exist (published in the evening IST). */
export function pendingDates(from, now = istNow()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < 19 * 60) end.setUTCDate(end.getUTCDate() - 1);
  const start = from ? new Date(`${from}T00:00:00Z`) : new Date(end.getTime() - 400 * 86400000);
  const out = [];
  for (const d = new Date(start.getTime() + 86400000); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(new Date(d));
  }
  return out;
}

export async function getMeta() {
  if (cache) return cache;
  const m = await MarketMeta.findById(META).lean();
  cache = m ? { lastDate: m.lastDate, symbols: m.symbols, scannedAt: m.scannedAt, results: m.results || [] } : { lastDate: null, symbols: 0, results: [] };
  return cache;
}

export function isStale(meta) {
  const p = pendingDates(meta.lastDate);
  return p.length > 0;
}

export async function update({ log = console.log } = {}) {
  if (state.running) return;
  Object.assign(state, { running: true, done: 0, total: 0, current: null, error: null, startedAt: new Date() });
  try {
    const meta = await getMeta();
    const dates = pendingDates(meta.lastDate);
    state.total = dates.length;
    if (!dates.length) return;
    const docs = await EodSeries.find({}).lean();
    const map = new Map(docs.map((d) => [d.symbol, d]));
    const dirty = new Set();
    let lastDate = meta.lastDate;
    for (const date of dates) {
      state.current = ymd(date);
      let csv = null;
      try { csv = await downloadBhavcopy(date); } catch (e) { log(`[eod] ${ymd(date)}: ${e.message}`); }
      state.done++;
      if (csv) {
        const { rows, date: fileDate } = parseBhavcopy(csv);
        const day = fileDate || ymd(date);
        for (const r of rows) {
          let s = map.get(r.symbol);
          if (!s) { s = { symbol: r.symbol, isin: r.isin, name: r.name, series: r.series, d: [], o: [], h: [], l: [], c: [], v: [], val: [] }; map.set(r.symbol, s); }
          if (s.d.length && s.d.at(-1) >= day) continue;
          s.isin = r.isin || s.isin; s.name = r.name || s.name; s.series = r.series;
          s.d.push(day); s.o.push(r.o); s.h.push(r.h); s.l.push(r.l); s.c.push(r.c); s.v.push(r.v); s.val.push(r.val);
          dirty.add(r.symbol);
        }
        lastDate = day;
      }
      await new Promise((r) => setTimeout(r, 300)); // be polite to NSE
    }
    // write back changed series (trimmed)
    const ops = [...dirty].map((sym) => {
      const s = map.get(sym);
      for (const k of ['d', 'o', 'h', 'l', 'c', 'v', 'val']) s[k] = s[k].slice(-KEEP);
      const { _id, __v, ...doc } = s;
      return { updateOne: { filter: { symbol: sym }, update: { $set: doc }, upsert: true } };
    });
    for (let i = 0; i < ops.length; i += 500) await EodSeries.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    // scan everything that traded in the last ~2 weeks
    const results = [];
    for (const s of map.values()) {
      if (!lastDate || !s.d.length || s.d.at(-1) < shift(lastDate, -14)) continue;
      const a = analyze(s);
      if (a) results.push({ symbol: s.symbol, name: s.name, isin: s.isin, series: s.series, ...a });
    }
    results.sort((a, b) => b.turnoverCr - a.turnoverCr);
    const out = { lastDate, symbols: results.length, scannedAt: new Date(), results };
    await MarketMeta.updateOne({ _id: META }, { $set: out }, { upsert: true });
    cache = out;
    log(`[eod] updated to ${lastDate}, ${results.length} symbols scanned`);
  } catch (e) {
    state.error = e.message;
    log(`[eod] failed: ${e.message}`);
  } finally {
    state.running = false;
  }
}

const shift = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return ymd(x); };

/** Start an update in the background if data is stale. */
export async function ensureFresh() {
  if (state.running) return;
  const meta = await getMeta();
  if (isStale(meta)) update().catch(() => {});
}
