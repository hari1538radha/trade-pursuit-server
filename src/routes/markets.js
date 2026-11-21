import { Router } from 'express';
import { getRange, RANGE_SYMBOLS } from '../lib/range.js';

const r = Router();

// GET /api/markets/range?symbols=XAUUSD,XAGUSD
r.get('/range', async (req, res) => {
  const symbols = [...new Set(String(req.query.symbols || 'XAUUSD,XAGUSD').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 6);
  const out = await Promise.all(symbols.map((s) => getRange(s).then((data) => ({ ok: true, data }), (e) => ({ ok: false, symbol: s, error: e.message, reason: e.reason }))));
  res.json({ results: out.filter((x) => x.ok).map((x) => x.data), errors: out.filter((x) => !x.ok).map(({ ok, ...e }) => e), supported: Object.keys(RANGE_SYMBOLS) });
});

export default r;
