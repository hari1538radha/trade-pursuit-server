import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Trade } from '../models/Trade.js';
import { Account } from '../models/Account.js';
import { DailyPlan } from '../models/DailyPlan.js';
import { Post } from '../models/Post.js';
import { Note } from '../models/Note.js';
import { QuizResult } from '../models/QuizResult.js';
import { Watch } from '../models/Market.js';
import { OISnapshot } from '../models/OISnapshot.js';
import { OITick } from '../models/OITick.js';
import { SbRecorder } from '../models/SbRecorder.js';
import { FinEntry, Emi, PropPurchase, PropPayout, DayLog } from '../models/Personal.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { HttpError, parse } from '../lib/http.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

const creds = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{3,24}$/, '3-24 letters, numbers, _ or .'),
  password: z.string().min(6, 'at least 6 characters').max(128),
  displayName: z.string().trim().max(40).optional(),
});

r.post('/register', limiter, async (req, res) => {
  const { username, password, displayName } = parse(creds, req.body);
  if (await User.exists({ username })) throw new HttpError(409, 'That username is taken');
  const passwordHash = await bcrypt.hash(password, 11);
  const user = await User.create({ username, passwordHash, displayName: displayName || username });
  res.status(201).json({ token: signToken(user), user });
});

r.post('/login', limiter, async (req, res) => {
  const { username, password } = parse(creds.pick({ username: true, password: true }), req.body);
  const user = await User.findOne({ username }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, 'Wrong username or password');
  res.json({ token: signToken(user), user });
});

r.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) throw new HttpError(401, 'Account not found');
  res.json({ user });
});

const profile = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  bio: z.string().max(200).optional(),
  settings: z.record(z.string(), z.any()).optional(),
  goals: z.record(z.string(), z.string().max(500)).optional(),
});

r.patch('/me', requireAuth, async (req, res) => {
  const body = parse(profile, req.body);
  const set = {};
  if (body.displayName !== undefined) set.displayName = body.displayName;
  if (body.bio !== undefined) set.bio = body.bio;
  for (const [k, v] of Object.entries(body.settings || {})) set[`settings.${k}`] = v;
  for (const [k, v] of Object.entries(body.goals || {})) set[`goals.${k}`] = v;
  const user = await User.findByIdAndUpdate(req.userId, { $set: set }, { new: true, runValidators: true });
  res.json({ user });
});

r.post('/password', requireAuth, limiter, async (req, res) => {
  const { current, next } = parse(z.object({ current: z.string(), next: z.string().min(6).max(128) }), req.body);
  const user = await User.findById(req.userId).select('+passwordHash');
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) throw new HttpError(401, 'Current password is wrong');
  user.passwordHash = await bcrypt.hash(next, 11);
  await user.save();
  res.json({ ok: true });
});

// Wipe all journal data but keep the login.
r.delete('/history', requireAuth, async (req, res) => {
  await Promise.all([Trade.deleteMany({ user: req.userId }), DailyPlan.deleteMany({ user: req.userId }), Account.deleteMany({ user: req.userId })]);
  res.json({ ok: true });
});

r.delete('/me', requireAuth, async (req, res) => {
  const { password } = parse(z.object({ password: z.string() }), req.body);
  const user = await User.findById(req.userId).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, 'Password is wrong');
  await Promise.all([
    Trade.deleteMany({ user: req.userId }),
    DailyPlan.deleteMany({ user: req.userId }),
    Account.deleteMany({ user: req.userId }),
    Post.deleteMany({ user: req.userId }),
    Note.deleteMany({ user: req.userId }),
    QuizResult.deleteMany({ user: req.userId }),
    Watch.deleteMany({ user: req.userId }),
    OISnapshot.deleteMany({ user: req.userId }),
    OITick.deleteMany({ user: req.userId }),
    SbRecorder.deleteMany({ user: req.userId }),
    ...[FinEntry, Emi, PropPurchase, PropPayout, DayLog].map((M) => M.deleteMany({ user: req.userId })),
    User.deleteOne({ _id: req.userId }),
  ]);
  res.json({ ok: true });
});

export default r;
