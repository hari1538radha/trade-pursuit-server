import { Router } from 'express';
import { z } from 'zod';
import { Post } from '../models/Post.js';
import { parse, HttpError } from '../lib/http.js';

const r = Router();

const shape = (p, me) => ({
  id: String(p._id),
  text: p.text,
  tags: p.tags,
  trade: p.trade,
  createdAt: p.createdAt,
  likes: p.likes.length,
  liked: p.likes.some((u) => String(u) === me),
  author: p.user ? { id: String(p.user._id), username: p.user.username, displayName: p.user.displayName } : null,
  mine: p.user && String(p.user._id) === me,
});

// Cursor-paginated feed: ?before=<ISO date>&tag=<tag>&user=<username>
r.get('/', async (req, res) => {
  const q = {};
  if (req.query.before) q.createdAt = { $lt: new Date(String(req.query.before)) };
  if (req.query.tag) q.tags = String(req.query.tag).toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const posts = await Post.find(q).sort({ createdAt: -1 }).limit(limit).populate('user', 'username displayName');
  res.json({ posts: posts.map((p) => shape(p, req.userId)), next: posts.length === limit ? posts.at(-1).createdAt : null });
});

r.post('/', async (req, res) => {
  const { text, trade } = parse(z.object({ text: z.string().trim().min(1).max(1000), trade: z.record(z.string(), z.any()).optional() }), req.body);
  const tags = [...new Set((text.match(/[#$][a-z0-9_]+/gi) || []).map((t) => t.toLowerCase()))].slice(0, 15);
  const post = await Post.create({ user: req.userId, text, tags, trade });
  await post.populate('user', 'username displayName');
  res.status(201).json({ post: shape(post, req.userId) });
});

r.post('/:id/like', async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) throw new HttpError(404, 'Post not found');
  const liked = post.likes.some((u) => String(u) === req.userId);
  await Post.updateOne({ _id: post._id }, liked ? { $pull: { likes: req.userId } } : { $addToSet: { likes: req.userId } });
  res.json({ liked: !liked, likes: post.likes.length + (liked ? -1 : 1) });
});

r.delete('/:id', async (req, res) => {
  const out = await Post.deleteOne({ _id: req.params.id, user: req.userId });
  if (!out.deletedCount) throw new HttpError(404, 'Post not found');
  res.json({ ok: true });
});

export default r;
