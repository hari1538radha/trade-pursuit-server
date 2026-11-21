import { Router } from 'express';
import { z } from 'zod';
import { Trade } from '../models/Trade.js';
import { HttpError, parse, isObjectId } from '../lib/http.js';

const r = Router();
const num = z.coerce.number().finite().optional().nullable();
const strs = z.array(z.string().max(60)).max(30).optional();
const leg = z.array(z.object({ price: num, size: num })).max(20).optional();

export const tradeInput = z.object({
  mode: z.enum(['live', 'paper']).optional(),
  noTrade: z.boolean().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbol: z.string().max(20).optional(),
  assetClass: z.string().max(20).optional(),
  tradeType: z.string().max(20).optional(),
  direction: z.enum(['long', 'short']).optional(),
  session: z.string().max(20).optional(),
  followedPlan: z.boolean().optional(),
  accounts: z.array(z.string().refine(isObjectId, 'bad account id')).max(50).optional(),
  entry: num, exit: num, pnl: num, size: num, plannedRR: num, realizedRR: num,
  entryTime: z.string().max(10).optional().nullable(),
  exitTime: z.string().max(10).optional().nullable(),
  stopLoss: num, target: num, mae: num, mfe: num,
  partials: leg, addOns: leg,
  exitReason: z.string().max(80).optional().nullable(),
  playbook: z.string().max(60).optional().nullable(),
  targets: strs, confluences: strs, confirmations: strs, bonus: strs, emotionsPos: strs, emotionsNeg: strs,
  postLoss: z.string().max(60).optional(),
  grade: z.enum(['A+', 'A', 'B', 'C', 'F', '']).optional(),
  notes: z.string().max(5000).optional().nullable(),
  images: z.array(z.string().max(1_500_000)).max(6).optional(),
  checklist: z.array(z.boolean()).max(20).optional(),
});

r.get('/', async (req, res) => {
  const q = { user: req.userId };
  const { from, to, mode, account } = req.query;
  if (mode === 'live' || mode === 'paper') q.mode = mode;
  if (from || to) q.date = { ...(from && { $gte: String(from) }), ...(to && { $lte: String(to) }) };
  if (account && isObjectId(String(account))) q.accounts = account;
  const limit = Math.min(Number(req.query.limit) || 5000, 5000);
  const skip = Math.max(Number(req.query.skip) || 0, 0);
  const [trades, total] = await Promise.all([
    Trade.find(q).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit),
    Trade.countDocuments(q),
  ]);
  res.json({ trades, total });
});

r.post('/', async (req, res) => {
  const data = parse(tradeInput, req.body);
  const trade = await Trade.create({ ...data, user: req.userId });
  res.status(201).json({ trade });
});

// CSV import / bulk create
r.post('/bulk', async (req, res) => {
  const { trades } = parse(z.object({ trades: z.array(tradeInput).min(1).max(2000) }), req.body);
  const docs = await Trade.insertMany(trades.map((t) => ({ ...t, user: req.userId })));
  res.status(201).json({ inserted: docs.length });
});

r.get('/:id', async (req, res) => {
  const trade = await Trade.findOne({ _id: req.params.id, user: req.userId });
  if (!trade) throw new HttpError(404, 'Trade not found');
  res.json({ trade });
});

r.put('/:id', async (req, res) => {
  const data = parse(tradeInput.partial(), req.body);
  const trade = await Trade.findOneAndUpdate({ _id: req.params.id, user: req.userId }, { $set: data }, { new: true, runValidators: true });
  if (!trade) throw new HttpError(404, 'Trade not found');
  res.json({ trade });
});

r.delete('/:id', async (req, res) => {
  const out = await Trade.deleteOne({ _id: req.params.id, user: req.userId });
  if (!out.deletedCount) throw new HttpError(404, 'Trade not found');
  res.json({ ok: true });
});

export default r;
