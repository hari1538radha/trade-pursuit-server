import { Router } from 'express';
import { getRange, RANGE_SYMBOLS } from '../lib/range.js';
import { getGoldbachData } from '../lib/goldbach.js';
import { getBars, BAR_SYMBOLS } from '../lib/bars.js';
import { getMacro } from '../lib/macro/index.js';
import { requireAdmin } from '../middleware/auth.js';

const r = Router();

// GET /api/markets/range?symbols=XAUUSD,XAGUSD
r.get('/range', async (req, res) => {
  const symbols = [...new Set(String(req.query.symbols || 'XAUUSD,XAGUSD').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 6);
  const out = await Promise.all(symbols.map((s) => getRange(s).then((data) => ({ ok: true, data }), (e) => ({ ok: false, symbol: s, error: e.message, reason: e.reason }))));
  res.json({ results: out.filter((x) => x.ok).map((x) => x.data), errors: out.filter((x) => !x.ok).map(({ ok, ...e }) => e), supported: Object.keys(RANGE_SYMBOLS) });
});

// GET /api/markets/goldbach?symbol=XAUUSD&interval=1h  (candles + spot for the Goldbach page)
r.get('/goldbach', requireAdmin, async (req, res) => {
  const symbol = String(req.query.symbol || 'XAUUSD').toUpperCase();
  const interval = String(req.query.interval || '1h');
  try { res.json(await getGoldbachData(symbol, interval)); }
  catch (e) { res.status(e.status || 502).json({ error: e.status ? e.message : `No price data for ${symbol} right now`, reason: e.message }); }
});

// GET /api/markets/macro  (macro data, prices, events, positioning, calendar and headlines for the Macro page)
r.get('/macro', requireAdmin, async (req, res) => {
  try { res.json(await getMacro()); }
  catch (e) { res.status(e.status || 502).json({ error: e.status ? e.message : 'Macro data is unavailable right now', reason: e.reason || e.message }); }
});

// GET /api/markets/bars?symbol=XAUUSD  (6 months of hourly candles for the Daily levels page)
r.get('/bars', requireAdmin, async (req, res) => {
  const symbol = String(req.query.symbol || 'XAUUSD').toUpperCase();
  if (!BAR_SYMBOLS.includes(symbol)) return res.status(400).json({ error: `symbol must be one of ${BAR_SYMBOLS.join(', ')}` });
  try { res.json(await getBars(symbol)); }
  catch (e) { res.status(e.status || 502).json({ error: e.message, reason: e.reason }); }
});

export default r;
