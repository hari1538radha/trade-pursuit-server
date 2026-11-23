import { Router } from 'express';
import { getRange, RANGE_SYMBOLS } from '../lib/range.js';
import { getGoldbachData } from '../lib/goldbach.js';
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

export default r;
