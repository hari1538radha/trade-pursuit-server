import { Router } from 'express';
import { z } from 'zod';
import { DailyPlan } from '../models/DailyPlan.js';
import { parse, HttpError } from '../lib/http.js';

const r = Router();
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const checkDate = (d) => { if (!dateRe.test(d || '')) throw new HttpError(400, 'Bad date'); return d; };

export const planInput = z.object({
  bias: z.string().max(40).optional(),
  keyLevels: z.string().max(1000).optional(),
  ruleReminder: z.string().max(500).optional(),
  avoid: z.string().max(500).optional(),
  checks: z.array(z.boolean()).max(20).optional(),
  instruments: z.array(z.string().trim().max(20)).max(12).optional(),
  sessionFocus: z.string().max(40).optional(),
  narrative: z.string().max(3000).optional(),
  bullCase: z.string().max(1500).optional(),
  bearCase: z.string().max(1500).optional(),
  newsToWatch: z.string().max(1500).optional(),
  rangeChecks: z.array(z.object({
    symbol: z.string().max(20), adr: z.number().nullable().optional(), todayRange: z.number().nullable().optional(), pct: z.number().nullable().optional(),
    left: z.number().nullable().optional(), pdh: z.number().nullable().optional(), pdl: z.number().nullable().optional(),
    verdict: z.string().max(20).optional(), line: z.string().max(300), at: z.coerce.date().optional(),
  })).max(30).optional(),
  images: z.array(z.object({ src: z.string().max(1_500_000), caption: z.string().max(140).optional().default('') })).max(8).optional(),
});

// History of my plans (no images, to keep it light): ?from=&to=
r.get('/', async (req, res) => {
  const q = { user: req.userId };
  const { from, to } = req.query;
  if (from || to) q.date = { ...(from && { $gte: String(from) }), ...(to && { $lte: String(to) }) };
  const plans = await DailyPlan.find(q).sort({ date: -1 }).limit(120).select('-images -checks').lean();
  res.json({ plans: plans.map(({ _id, __v, ...p }) => ({ ...p, id: String(_id) })) });
});

r.get('/:date', async (req, res) => {
  const plan = await DailyPlan.findOne({ user: req.userId, date: checkDate(req.params.date) });
  res.json({ plan });
});

r.put('/:date', async (req, res) => {
  const date = checkDate(req.params.date);
  const body = parse(planInput, req.body);
  const plan = await DailyPlan.findOneAndUpdate({ user: req.userId, date }, { $set: body }, { new: true, upsert: true, runValidators: true });
  res.json({ plan });
});

export default r;
