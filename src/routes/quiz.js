import { Router } from 'express';
import { z } from 'zod';
import { QuizResult } from '../models/QuizResult.js';
import { parse } from '../lib/http.js';

const r = Router();
r.get('/', async (req, res) => {
  const results = await QuizResult.find({ user: req.userId }).sort({ createdAt: -1 }).limit(100);
  res.json({ results });
});
r.post('/', async (req, res) => {
  const body = parse(z.object({ topic: z.string().max(40).optional(), score: z.number().int().min(0), total: z.number().int().min(1).max(200), missed: z.array(z.string().max(20)).max(200).optional(), asked: z.array(z.string().max(20)).max(200).optional() }), req.body);
  const result = await QuizResult.create({ ...body, user: req.userId });
  res.status(201).json({ result });
});
export default r;
