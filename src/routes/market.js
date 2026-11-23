import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { HttpError, parse } from '../lib/http.js';
import { OISnapshot } from '../models/OISnapshot.js';
import { EodSeries, Watch } from '../models/Market.js';
import * as sb from '../lib/market/sensibull.js';
import { chainStats, marketOpen, tickDelta } from '../lib/market/options.js';
import { OITick } from '../models/OITick.js';
import { SETUPS, analyze } from '../lib/market/scanner.js';
import * as eod from '../lib/market/eod.js';

const r = Router();

// ---------------- Option chain (Sensibull, user's own session) ----------------
const lastCall = new Map(); // userId -> ms (rate limit)
const inFlight = new Set(); // userIds with a Sensibull call running
const lastChain = new Map(); // `${user}|${key}|${expiry}` -> { at, chain } for the 3-second delta
const MIN_GAP_MS = 2500; // the page pulls every 3 seconds

async function saveSnapshot(user, key, expiry, chain, stats, minGapMs = 3 * 60000) {
  const lastSnap = await OISnapshot.findOne({ user, symbol: key, expiry }).sort({ at: -1 }).select('at').lean();
  if (lastSnap && Date.now() - new Date(lastSnap.at).getTime() < minGapMs) return;
  const i = chain.findIndex((x) => x.strike === stats.atm);
  const near = chain.slice(Math.max(0, i - 12), i + 13).map((x) => [x.strike, x.ce.oi, x.pe.oi, x.ce.chgOi, x.pe.chgOi]);
  await OISnapshot.create({ user, symbol: key, expiry, spot: stats.spot, pcr: stats.pcr, ceOI: stats.ceOI, peOI: stats.peOI, ceChg: stats.ceChg, peChg: stats.peChg, maxPain: stats.maxPain, atmIv: stats.atmIv, strikes: near });
}

const chainInput = z.object({
  cookie: z.string().min(10).max(8000),
  underlying: z.string().trim().toUpperCase().regex(/^[A-Z0-9&-]{2,20}$/),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  atm: z.enum(['five', 'ten', 'fifteen', 'twenty', 'all']).optional(),
  deviceId: z.string().max(80).optional(),
  debug: z.boolean().optional(),
});

r.post('/options/chain', requireAuth, async (req, res) => {
  const body = parse(chainInput, req.body);
  const last = lastCall.get(req.userId) || 0;
  if (inFlight.has(req.userId) || Date.now() - last < MIN_GAP_MS) throw new HttpError(429, 'Too fast: one refresh every 3 seconds');
  lastCall.set(req.userId, Date.now());
  inFlight.add(req.userId);
  let raw;
  try {
    raw = await sb.fetchOiChange({ cookie: sb.extractCookie(body.cookie), underlying: body.underlying, expiry: body.expiry, atm: body.atm, deviceId: body.deviceId });
  } finally { inFlight.delete(req.userId); }
  const parsed = sb.parseOiChange(raw);
  if (!parsed.rows.length) throw new HttpError(502, 'Sensibull returned no strikes for that expiry. Check the expiry date.');
  const chain = parsed.rows.map((x) => ({ ...x, expiry: body.expiry }));
  const stats = chainStats(chain, { spot: parsed.spot, atmStrike: parsed.atmStrike });
  const open = marketOpen();

  // Delta since this user's previous pull of the same chain (ignored if older than a minute)
  const k = `${req.userId}|${body.underlying}|${body.expiry}`;
  const prev = lastChain.get(k);
  lastChain.set(k, { at: Date.now(), chain });
  let tick = null;
  if (stats && prev && Date.now() - prev.at < 60000) {
    const d = tickDelta(prev.chain, chain, stats.atm);
    tick = { at: new Date(), spot: stats.spot, atm: stats.atm, pcr: stats.pcr, ceOI: stats.ceOI, peOI: stats.peOI, dCe: d.dCe, dPe: d.dPe, ceDelta: d.ceDelta, peDelta: d.peDelta, d: d.strikes };
    if (open) await OITick.create({ user: req.userId, symbol: body.underlying, expiry: body.expiry, ...tick });
  }
  if (stats && open) await saveSnapshot(req.userId, body.underlying, body.expiry, chain, stats);
  res.json({ chain, stats, has: parsed.has, marketOpen: open, at: new Date(), tick, ...(body.debug && { debug: { keys: parsed.keys, sampleStrike: parsed.sampleStrike } }) });
});

// Recorded 3-second ticks: ?key=NIFTY&expiry=YYYY-MM-DD[&since=ISO] (default: last 8 hours, max 3000)
r.get('/options/ticks', requireAuth, async (req, res) => {
  const { key, expiry, since } = parse(z.object({ key: z.string().min(2).max(60), expiry: z.string(), since: z.coerce.date().optional() }), req.query);
  const from = since || new Date(Date.now() - 8 * 3600000);
  const ticks = await OITick.find({ user: req.userId, symbol: key, expiry, at: { $gt: from } }).sort({ at: -1 }).limit(3000).lean();
  res.json({ ticks: ticks.reverse().map(({ _id, user, __v, ...x }) => x) });
});

r.get('/options/history', requireAuth, async (req, res) => {
  const { key, expiry } = parse(z.object({ key: z.string().min(2).max(60), expiry: z.string() }), req.query);
  const since = new Date(Date.now() - 18 * 3600000);
  const snaps = await OISnapshot.find({ user: req.userId, symbol: key, expiry, at: { $gte: since } }).sort({ at: 1 }).lean();
  res.json({ snaps: snaps.map(({ _id, user, __v, ...x }) => x) });
});

// ---------------- NSE stocks ----------------
r.get('/stocks/status', requireAuth, async (_req, res) => {
  const m = await eod.getMeta();
  const stale = eod.isStale(m);
  if (stale && !eod.state.running) eod.ensureFresh();
  res.json({ lastDate: m.lastDate, symbols: m.symbols || 0, scannedAt: m.scannedAt, stale, job: eod.state });
});

r.post('/stocks/refresh', requireAuth, async (_req, res) => {
  eod.ensureFresh();
  res.json({ job: eod.state });
});

r.get('/stocks/setups', requireAuth, (_req, res) => res.json({ setups: SETUPS }));

r.get('/stocks/scan', requireAuth, async (req, res) => {
  const q = parse(z.object({
    setup: z.string().max(40).optional(), q: z.string().max(40).optional(),
    minPrice: z.coerce.number().min(0).optional(), maxPrice: z.coerce.number().min(0).optional(),
    minTurnover: z.coerce.number().min(0).optional(), series: z.enum(['EQ', 'BE', 'all']).optional(),
    sort: z.enum(['turnover', 'change', 'volume', 'fromHigh', 'fromLow', 'rsi']).optional(), limit: z.coerce.number().int().min(1).max(3000).optional(),
  }), req.query);
  const m = await eod.getMeta();
  let rows = m.results;
  const counts = {};
  const base = rows.filter((x) =>
    (q.series && q.series !== 'all' ? x.series === q.series : true) &&
    x.close >= (q.minPrice ?? 20) && (!q.maxPrice || x.close <= q.maxPrice) && x.turnoverCr >= (q.minTurnover ?? 1));
  for (const x of base) for (const t of x.tags) counts[t] = (counts[t] || 0) + 1;
  rows = base.filter((x) => (!q.setup || x.tags.includes(q.setup)) && (!q.q || x.symbol.includes(q.q.toUpperCase()) || (x.name || '').toUpperCase().includes(q.q.toUpperCase())));
  const key = { turnover: (x) => -x.turnoverCr, change: (x) => -x.chgPct, volume: (x) => -x.volRatio, fromHigh: (x) => -x.fromHigh, fromLow: (x) => x.fromLow, rsi: (x) => x.rsi ?? 50 }[q.sort || 'turnover'];
  rows = rows.slice().sort((a, b) => key(a) - key(b));
  res.json({ lastDate: m.lastDate, total: rows.length, universe: base.length, counts, rows: rows.slice(0, q.limit || 500) });
});

r.get('/stocks/search', requireAuth, async (req, res) => {
  const qq = String(req.query.q || '').toUpperCase().slice(0, 30);
  if (!qq) return res.json({ results: [] });
  const m = await eod.getMeta();
  res.json({ results: m.results.filter((x) => x.symbol.startsWith(qq) || (x.name || '').toUpperCase().includes(qq)).slice(0, 15).map((x) => ({ symbol: x.symbol, name: x.name, isin: x.isin, close: x.close })) });
});

r.get('/stocks/:symbol', requireAuth, async (req, res) => {
  const s = await EodSeries.findOne({ symbol: String(req.params.symbol).toUpperCase() }).lean();
  if (!s) throw new HttpError(404, 'Symbol not found');
  const n = s.c.length, from = Math.max(0, n - 250);
  const bars = s.d.slice(from).map((d, i) => ({ d, o: s.o[from + i], h: s.h[from + i], l: s.l[from + i], c: s.c[from + i], v: s.v[from + i] }));
  res.json({ symbol: s.symbol, name: s.name, isin: s.isin, analysis: analyze(s), bars });
});

// ---------------- Watchlist ----------------
const num = z.coerce.number().finite().optional().nullable();
const watchInput = z.object({
  symbol: z.string().trim().min(1).max(30), setup: z.string().max(60).optional(), side: z.enum(['long', 'short', 'watch']).optional(),
  entry: num, stop: num, target: num, note: z.string().max(1000).optional(), addedClose: num,
  status: z.enum(['watching', 'triggered', 'done', 'dropped']).optional(),
});
r.get('/watchlist', requireAuth, async (req, res) => {
  const items = await Watch.find({ user: req.userId }).sort({ createdAt: -1 });
  const m = await eod.getMeta();
  const bySym = new Map(m.results.map((x) => [x.symbol, x]));
  res.json({ items: items.map((w) => ({ ...w.toJSON(), now: bySym.get(w.symbol) || null })) });
});
r.post('/watchlist', requireAuth, async (req, res) => {
  const body = parse(watchInput, req.body);
  const item = await Watch.findOneAndUpdate({ user: req.userId, symbol: body.symbol.toUpperCase() }, { $set: { ...body, symbol: body.symbol.toUpperCase() } }, { new: true, upsert: true, runValidators: true });
  res.status(201).json({ item });
});
r.put('/watchlist/:id', requireAuth, async (req, res) => {
  const item = await Watch.findOneAndUpdate({ _id: req.params.id, user: req.userId }, { $set: parse(watchInput.partial(), req.body) }, { new: true, runValidators: true });
  if (!item) throw new HttpError(404, 'Not in your watchlist');
  res.json({ item });
});
r.delete('/watchlist/:id', requireAuth, async (req, res) => {
  await Watch.deleteOne({ _id: req.params.id, user: req.userId });
  res.json({ ok: true });
});

export default r;
