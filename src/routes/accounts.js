import { Router } from 'express';
import { z } from 'zod';
import { Account } from '../models/Account.js';
import { Trade } from '../models/Trade.js';
import { HttpError, parse } from '../lib/http.js';

const r = Router();
const num = z.coerce.number().finite().optional().nullable();
const accountInput = z.object({
  name: z.string().trim().min(1).max(60),
  firmId: z.string().max(60).optional(),
  firmName: z.string().max(60).optional(),
  firmType: z.string().max(20).optional(),
  program: z.string().max(60).optional(),
  variant: z.string().max(60).optional(),
  programId: z.string().max(60).optional().nullable(),
  variantId: z.string().max(60).optional().nullable(),
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  passedAt: z.string().max(10).optional().nullable(),
  failedAt: z.string().max(10).optional().nullable(),
  prevAccount: z.string().max(40).optional().nullable(),
  size: z.coerce.number().positive(),
  phase: z.string().max(30).optional(),
  kind: z.enum(['eval', 'funded', 'personal']).optional(),
  status: z.enum(['active', 'passed', 'failed', 'archived']).optional(),
  paid: num,
  startBalance: num,
  payouts: z.array(z.object({ amount: z.coerce.number(), date: z.string() })).max(200).optional(),
  rules: z
    .object({ profitTarget: num, maxLoss: num, maxLossType: z.string().optional(), dailyLoss: num, minDays: num, minTrades: num, consistency: z.string().optional().nullable() })
    .optional(),
});

r.get('/', async (req, res) => {
  const accounts = await Account.find({ user: req.userId }).sort({ createdAt: 1 });
  res.json({ accounts });
});

// Create one or many (the "How many" stepper in Log eval)
r.post('/', async (req, res) => {
  const { count = 1, ...data } = parse(accountInput.extend({ count: z.coerce.number().int().min(1).max(50).optional() }), req.body);
  const docs = Array.from({ length: count }, (_, i) => ({
    ...data,
    name: count > 1 ? `${data.name} ${i + 1}` : data.name,
    startBalance: data.startBalance ?? data.size,
    user: req.userId,
  }));
  const accounts = await Account.insertMany(docs);
  res.status(201).json({ accounts });
});

r.put('/:id', async (req, res) => {
  const data = parse(accountInput.partial(), req.body);
  const account = await Account.findOneAndUpdate({ _id: req.params.id, user: req.userId }, { $set: data }, { new: true, runValidators: true });
  if (!account) throw new HttpError(404, 'Account not found');
  res.json({ account });
});

r.delete('/:id', async (req, res) => {
  const out = await Account.deleteOne({ _id: req.params.id, user: req.userId });
  if (!out.deletedCount) throw new HttpError(404, 'Account not found');
  await Trade.updateMany({ user: req.userId, accounts: req.params.id }, { $pull: { accounts: req.params.id } });
  res.json({ ok: true });
});

export default r;
