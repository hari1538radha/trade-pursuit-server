// Admin: see every trader's journey (read-only) and manage roles.
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User, isAdminName } from '../models/User.js';
import { Trade } from '../models/Trade.js';
import { Account } from '../models/Account.js';
import { DailyPlan } from '../models/DailyPlan.js';
import { SbRecorder } from '../models/SbRecorder.js';
import { roles } from '../middleware/auth.js';
import { HttpError, parse, isObjectId } from '../lib/http.js';

const r = Router();

// All traders with headline stats
r.get('/users', async (_req, res) => {
  const [users, stats] = await Promise.all([
    User.find().sort({ createdAt: 1 }).lean(),
    Trade.aggregate([
      { $match: { noTrade: { $ne: true } } },
      { $group: {
        _id: { user: '$user', mode: '$mode' },
        trades: { $sum: 1 }, pnl: { $sum: '$pnl' },
        wins: { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
        losses: { $sum: { $cond: [{ $lt: ['$pnl', 0] }, 1, 0] } },
        offPlan: { $sum: { $cond: [{ $eq: ['$followedPlan', false] }, 1, 0] } },
        first: { $min: '$date' }, last: { $max: '$date' },
      } },
    ]),
  ]);
  const by = new Map();
  for (const s of stats) {
    const k = String(s._id.user);
    const cur = by.get(k) || {};
    cur[s._id.mode || 'live'] = { trades: s.trades, pnl: s.pnl, wins: s.wins, losses: s.losses, offPlan: s.offPlan, first: s.first, last: s.last };
    by.set(k, cur);
  }
  res.json({
    users: users.map((u) => ({
      id: String(u._id), username: u.username, displayName: u.displayName || u.username,
      role: isAdminName(u.username) ? 'admin' : u.role || 'user', fixedAdmin: isAdminName(u.username),
      joined: u.createdAt, stats: by.get(String(u._id)) || {},
    })),
  });
});

// One trader's journey: profile, accounts, all trades, recent plans
r.get('/users/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Trader not found');
  const id = new mongoose.Types.ObjectId(req.params.id);
  const user = await User.findById(id).lean();
  if (!user) throw new HttpError(404, 'Trader not found');
  const [accounts, trades, plans] = await Promise.all([
    Account.find({ user: id }).sort({ createdAt: 1 }).lean(),
    Trade.find({ user: id }).sort({ date: -1, entryTime: -1, createdAt: -1 }).limit(5000).select('-images').lean(),
    DailyPlan.find({ user: id }).sort({ date: -1 }).limit(30).select('-images').lean(),
  ]);
  const clean = (x) => { const { _id, __v, user: _u, ...rest } = x; return { id: String(_id), ...rest }; };
  res.json({
    user: { id: String(user._id), username: user.username, displayName: user.displayName || user.username, role: isAdminName(user.username) ? 'admin' : user.role || 'user', joined: user.createdAt, bio: user.bio, goals: user.goals, settings: { breakEven: user.settings?.breakEven || 0, donts: user.settings?.donts || [], guardrails: user.settings?.guardrails } },
    accounts: accounts.map(clean),
    trades: trades.map((t) => ({ ...clean(t), accounts: (t.accounts || []).map(String) })),
    plans: plans.map(clean),
  });
});

// Promote / demote
r.patch('/users/:id/role', async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(['user', 'admin']) }), req.body);
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Trader not found');
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'Trader not found');
  if (isAdminName(user.username) && role !== 'admin') throw new HttpError(400, `${user.username} is an admin through ADMIN_USERNAMES on the server; remove it there first`);
  if (role === 'user' && String(user._id) === req.userId) {
    const others = await User.countDocuments({ _id: { $ne: user._id }, role: 'admin' });
    if (!others) throw new HttpError(400, "You're the only admin. Make someone else admin first.");
  }
  user.role = role;
  await user.save();
  // Users can't use the option-chain tools: stop their server recording
  if (role === 'user') await SbRecorder.deleteMany({ user: user._id });
  roles.clear(user._id);
  res.json({ ok: true, role: isAdminName(user.username) ? 'admin' : role });
});

export default r;
