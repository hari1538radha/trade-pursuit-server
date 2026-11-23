import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin as requireAuth } from '../middleware/auth.js'; // every route here is admin-only
import { HttpError, parse } from '../lib/http.js';
import { OISnapshot } from '../models/OISnapshot.js';
import { SbRecorder } from '../models/SbRecorder.js';
import { seal } from '../lib/secret.js';
import { recordPull, latestChain } from '../lib/market/store.js';
import { refreshRecorders } from '../lib/market/recorder.js';
import { EodSeries, Watch } from '../models/Market.js';
import * as sb from '../lib/market/sensibull.js';
import { chainStats, marketOpen } from '../lib/market/options.js';
import { OITick } from '../models/OITick.js';
import { SETUPS, analyze } from '../lib/market/scanner.js';
import * as eod from '../lib/market/eod.js';

const r = Router();

// ---------------- Option chain (Sensibull, user's own session) ----------------
const lastCall = new Map(); // userId -> ms (rate limit)
const inFlight = new Set(); // userIds with a Sensibull call running
const MIN_GAP_MS = 2500; // the page pulls every 3 seconds

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
  const open = marketOpen();
  const { stats, tick } = await recordPull({ user: req.userId, key: body.underlying, expiry: body.expiry, chain, spot: parsed.spot, atmStrike: parsed.atmStrike, has: parsed.has, save: open });
  res.json({ chain, stats, has: parsed.has, marketOpen: open, at: new Date(), tick, ...(body.debug && { debug: { keys: parsed.keys, sampleStrike: parsed.sampleStrike } }) });
});

// Recorded ticks: ?key&expiry[&since=ISO][&bucket=1m]
//  raw: every 3s tick (latest 3000, without the full chain); bucket=1m: summed per minute for the whole day
r.get('/options/ticks', requireAuth, async (req, res) => {
  const { key, expiry, since, bucket } = parse(z.object({ key: z.string().min(2).max(60), expiry: z.string(), since: z.coerce.date().optional(), bucket: z.enum(['1m']).optional() }), req.query);
  const from = since || new Date(Date.now() - 8 * 3600000);
  if (bucket === '1m') {
    const rows = await OITick.find({ user: req.userId, symbol: key, expiry, at: { $gt: from } }).select('at dCe dPe pcr ceOI peOI spot').sort({ at: 1 }).lean();
    const m = new Map();
    for (const t of rows) {
      const k = Math.floor(new Date(t.at).getTime() / 60000) * 60000;
      const b = m.get(k) || { at: new Date(k), dCe: 0, dPe: 0, n: 0 };
      b.dCe += t.dCe || 0; b.dPe += t.dPe || 0; b.n++; b.pcr = t.pcr; b.ceOI = t.ceOI; b.peOI = t.peOI; b.spot = t.spot;
      m.set(k, b);
    }
    return res.json({ ticks: [...m.values()], bucket: '1m' });
  }
  const ticks = await OITick.find({ user: req.userId, symbol: key, expiry, at: { $gt: from } }).select('-s').sort({ at: -1 }).limit(3000).lean();
  res.json({ ticks: ticks.reverse().map(({ _id, user, __v, ...x }) => x) });
});

// Per-strike OI over time from the stored full chains: ?key&expiry&strikes=26100,26150[&since]
// Returns at most ~1500 points (evenly thinned) per request.
r.get('/options/strike-series', requireAuth, async (req, res) => {
  const q = parse(z.object({ key: z.string().min(2).max(60), expiry: z.string(), strikes: z.string().max(200), since: z.coerce.date().optional() }), req.query);
  const want = new Set(q.strikes.split(',').map(Number).filter(Number.isFinite).slice(0, 8));
  const from = q.since || new Date(Date.now() - 8 * 3600000);
  const docs = await OITick.find({ user: req.userId, symbol: q.key, expiry: q.expiry, at: { $gt: from }, s: { $exists: true } }).select('at s').sort({ at: 1 }).lean();
  const step = Math.max(1, Math.ceil(docs.length / 1500));
  const points = [];
  for (let i = 0; i < docs.length; i += step) {
    const d = i + step >= docs.length ? docs.at(-1) : docs[i];
    points.push({ at: d.at, s: d.s.filter((x) => want.has(x[0])).map((x) => x.slice(0, 5)) });
  }
  res.json({ points, thinned: step > 1 });
});

// Latest chain from the database (filled by the server recorder or by an open page)
r.get('/options/live', requireAuth, async (req, res) => {
  const { key, expiry } = parse(z.object({ key: z.string().min(2).max(60), expiry: z.string() }), req.query);
  const live = await latestChain(req.userId, key, expiry);
  if (!live) return res.json({ chain: [], stats: null, at: null, marketOpen: marketOpen() });
  res.json({ chain: live.chain, stats: chainStats(live.chain, {}), has: live.has, at: live.at, tick: live.tick, marketOpen: marketOpen(), source: 'db' });
});

// ---- Server recorder (keeps recording when the site is closed) ----
const recView = (r) => ({ id: String(r._id), underlying: r.underlying, expiry: r.expiry, atm: r.atm, autoRoll: r.autoRoll, enabled: r.enabled, status: r.status, lastAt: r.lastAt, lastError: r.lastError, pulls: r.pulls, updatedAt: r.updatedAt });

r.get('/options/recorders', requireAuth, async (req, res) => {
  const recs = await SbRecorder.find({ user: req.userId }).sort({ underlying: 1 }).lean();
  res.json({ recorders: recs.map(recView), marketOpen: marketOpen() });
});

const recInput = z.object({
  underlying: z.string().trim().toUpperCase().regex(/^[A-Z0-9&-]{2,20}$/),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  atm: z.enum(['five', 'ten', 'fifteen', 'twenty', 'all']).optional(),
  autoRoll: z.boolean().optional(),
  enabled: z.boolean().optional(),
  cookie: z.string().min(10).max(8000).optional(),
});

r.put('/options/recorders', requireAuth, async (req, res) => {
  const b = parse(recInput, req.body);
  const existing = await SbRecorder.findOne({ user: req.userId, underlying: b.underlying });
  if (!existing) {
    if ((await SbRecorder.countDocuments({ user: req.userId })) >= 3) throw new HttpError(400, 'Up to 3 chains can be recorded at once');
    if (!b.cookie) throw new HttpError(400, 'Paste your Sensibull session to start server recording');
  }
  // A new cookie applies to all of this user's recorders (it's the same Sensibull login)
  if (b.cookie) await SbRecorder.updateMany({ user: req.userId }, { $set: { cookie: seal(b.cookie), status: 'waiting', lastError: null } });
  const set = { expiry: b.expiry, ...(b.atm && { atm: b.atm }), ...(b.autoRoll != null && { autoRoll: b.autoRoll }), ...(b.enabled != null && { enabled: b.enabled }) };
  if (b.enabled !== false && existing?.status !== 'recording') Object.assign(set, { status: 'waiting', lastError: null });
  const rec = existing
    ? await SbRecorder.findOneAndUpdate({ _id: existing._id }, { $set: set }, { new: true }).lean()
    : (await SbRecorder.create({ user: req.userId, underlying: b.underlying, cookie: seal(b.cookie), ...set })).toObject();
  refreshRecorders();
  res.json({ recorder: recView(rec) });
});

r.delete('/options/recorders/:underlying', requireAuth, async (req, res) => {
  await SbRecorder.deleteOne({ user: req.userId, underlying: String(req.params.underlying).toUpperCase() });
  refreshRecorders();
  res.json({ ok: true });
});

// Remove every stored session (stops all server recording)
r.delete('/options/recorders', requireAuth, async (req, res) => {
  await SbRecorder.deleteMany({ user: req.userId });
  refreshRecorders();
  res.json({ ok: true });
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
