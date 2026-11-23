import { Router } from 'express';
import { z } from 'zod';
import { DailyPlan } from '../models/DailyPlan.js';
import { parse, HttpError } from '../lib/http.js';

const r = Router();
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

r.get('/:date', async (req, res) => {
  if (!dateRe.test(req.params.date)) throw new HttpError(400, 'Bad date');
  const plan = await DailyPlan.findOne({ user: req.userId, date: req.params.date });
  res.json({ plan });
});

r.put('/:date', async (req, res) => {
  if (!dateRe.test(req.params.date)) throw new HttpError(400, 'Bad date');
  const body = parse(
    z.object({
      bias: z.string().max(40).optional(),
      keyLevels: z.string().max(500).optional(),
      ruleReminder: z.string().max(500).optional(),
      avoid: z.string().max(500).optional(),
      checks: z.array(z.boolean()).max(20).optional(),
    }),
    req.body
  );
  const plan = await DailyPlan.findOneAndUpdate(
    { user: req.userId, date: req.params.date },
    { $set: body },
    { new: true, upsert: true, runValidators: true }
  );
  res.json({ plan });
});

export default r;
