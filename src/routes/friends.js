import { Router } from 'express';
import { z } from 'zod';
import { Friendship } from '../models/Friendship.js';
import { User } from '../models/User.js';
import { DailyPlan } from '../models/DailyPlan.js';
import { parse, HttpError, isObjectId } from '../lib/http.js';

const r = Router();
const who = (u) => (u ? { id: String(u._id), username: u.username, displayName: u.displayName } : null);

// { friends, incoming, outgoing }
r.get('/', async (req, res) => {
  const me = req.userId;
  const rows = await Friendship.find({ $or: [{ from: me }, { to: me }] })
    .sort({ updatedAt: -1 })
    .populate('from', 'username displayName')
    .populate('to', 'username displayName');
  const friends = [], incoming = [], outgoing = [];
  for (const f of rows) {
    if (!f.from || !f.to) continue; // the other side deleted their account
    const mineSent = String(f.from._id) === me;
    const other = who(mineSent ? f.to : f.from);
    const row = { id: String(f._id), user: other, createdAt: f.createdAt };
    if (f.status === 'accepted') friends.push(row);
    else (mineSent ? outgoing : incoming).push(row);
  }
  res.json({ friends, incoming, outgoing });
});

// Send a request by username. If they already asked you, this accepts it.
r.post('/', async (req, res) => {
  const { username } = parse(z.object({ username: z.string().trim().toLowerCase().min(1).max(24) }), req.body);
  const other = await User.findOne({ username: username.replace(/^@/, '') }).select('username displayName');
  if (!other) throw new HttpError(404, 'No trader with that username');
  if (String(other._id) === req.userId) throw new HttpError(400, "You can't add yourself");
  const reverse = await Friendship.findOne({ from: other._id, to: req.userId });
  if (reverse) {
    if (reverse.status === 'pending') { reverse.status = 'accepted'; await reverse.save(); }
    return res.json({ status: 'accepted', id: String(reverse._id), user: who(other) });
  }
  const existing = await Friendship.findOne({ from: req.userId, to: other._id });
  if (existing) return res.json({ status: existing.status, id: String(existing._id), user: who(other) });
  const f = await Friendship.create({ from: req.userId, to: other._id });
  res.status(201).json({ status: 'pending', id: String(f._id), user: who(other) });
});

r.post('/:id/accept', async (req, res) => {
  if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
  const f = await Friendship.findOneAndUpdate({ _id: req.params.id, to: req.userId, status: 'pending' }, { $set: { status: 'accepted' } }, { new: true });
  if (!f) throw new HttpError(404, 'Request not found');
  res.json({ ok: true });
});

// Decline, cancel, or unfriend. Either side may remove it.
r.delete('/:id', async (req, res) => {
  if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
  const f = await Friendship.findOneAndDelete({ _id: req.params.id, $or: [{ from: req.userId }, { to: req.userId }] });
  if (!f) throw new HttpError(404, 'Request not found');
  // Stop sharing plans both ways.
  await Promise.all([
    DailyPlan.updateMany({ user: f.from }, { $pull: { sharedWith: f.to } }),
    DailyPlan.updateMany({ user: f.to }, { $pull: { sharedWith: f.from } }),
  ]);
  res.json({ ok: true });
});

export default r;
