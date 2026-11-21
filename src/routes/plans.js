import { Router } from 'express';
import { z } from 'zod';
import { DailyPlan } from '../models/DailyPlan.js';
import { Friendship } from '../models/Friendship.js';
import { parse, HttpError, isObjectId } from '../lib/http.js';

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

const author = (u) => (u && u._id ? { id: String(u._id), username: u.username, displayName: u.displayName } : null);

// History of my plans (no images, to keep it light): ?from=&to=
r.get('/', async (req, res) => {
  const q = { user: req.userId };
  const { from, to } = req.query;
  if (from || to) q.date = { ...(from && { $gte: String(from) }), ...(to && { $lte: String(to) }) };
  const plans = await DailyPlan.find(q).sort({ date: -1 }).limit(120).select('-images -checks').lean();
  res.json({ plans: plans.map(({ _id, __v, ...p }) => ({ ...p, id: String(_id), sharedWith: (p.sharedWith || []).map(String) })) });
});

// Plans friends shared with me for a date: ?date=YYYY-MM-DD
r.get('/shared', async (req, res) => {
  const date = checkDate(String(req.query.date || ''));
  const friends = await Friendship.friendIds(req.userId);
  const plans = await DailyPlan.find({ date, sharedWith: req.userId, user: { $in: friends } })
    .populate('user', 'username displayName')
    .select('-sharedWith -checks');
  res.json({ plans: plans.map((p) => ({ ...p.toJSON(), user: undefined, author: author(p.user) })) });
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

// Share a day's plan with friends. `userIds` replaces the current list ([] = stop sharing).
r.post('/:date/share', async (req, res) => {
  const date = checkDate(req.params.date);
  const { userIds } = parse(z.object({ userIds: z.array(z.string().refine(isObjectId, 'bad user id')).max(200) }), req.body);
  const friends = new Set(await Friendship.friendIds(req.userId));
  const bad = userIds.find((u) => !friends.has(u));
  if (bad) throw new HttpError(403, 'You can only share with friends');
  const plan = await DailyPlan.findOneAndUpdate({ user: req.userId, date }, { $set: { sharedWith: [...new Set(userIds)] } }, { new: true, upsert: true });
  res.json({ plan });
});

export default r;
