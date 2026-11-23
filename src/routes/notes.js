import { Router } from 'express';
import { z } from 'zod';
import { Note } from '../models/Note.js';
import { HttpError, parse, isObjectId } from '../lib/http.js';

const r = Router();
const input = z.object({
  title: z.string().trim().min(1).max(140),
  body: z.string().max(20000).optional(),
  tags: z.array(z.string().trim().toLowerCase().max(30)).max(15).optional(),
  pinned: z.boolean().optional(),
  kind: z.enum(['lesson', 'rule', 'mistake', 'idea', 'review']).optional(),
  trade: z.string().refine(isObjectId, 'bad trade id').optional().nullable(),
});

r.get('/', async (req, res) => {
  const notes = await Note.find({ user: req.userId }).sort({ pinned: -1, updatedAt: -1 }).limit(1000);
  res.json({ notes });
});
r.post('/', async (req, res) => {
  const note = await Note.create({ ...parse(input, req.body), user: req.userId });
  res.status(201).json({ note });
});
r.put('/:id', async (req, res) => {
  const note = await Note.findOneAndUpdate({ _id: req.params.id, user: req.userId }, { $set: parse(input.partial(), req.body) }, { new: true, runValidators: true });
  if (!note) throw new HttpError(404, 'Note not found');
  res.json({ note });
});
r.delete('/:id', async (req, res) => {
  const out = await Note.deleteOne({ _id: req.params.id, user: req.userId });
  if (!out.deletedCount) throw new HttpError(404, 'Note not found');
  res.json({ ok: true });
});
export default r;
