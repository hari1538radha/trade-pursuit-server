// Admin-only personal tracking API (mounted behind requireAdmin).
import { Router } from 'express';
import { z } from 'zod';
import { FinEntry, Emi, PropPurchase, PropPayout, DayLog, Holding } from '../models/Personal.js';
import { HttpError, parse, isObjectId } from '../lib/http.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ym = z.string().regex(/^\d{4}-\d{2}$/);
const str = (n) => z.string().trim().max(n);
const num = z.number().finite();

/** Standard list / create / update / delete for one model */
function crud(r, path, Model, schema, sort = { date: -1, createdAt: -1 }) {
  r.get(path, async (req, res) => {
    const q = { user: req.userId };
    if (req.query.from || req.query.to) q.date = { ...(req.query.from && { $gte: String(req.query.from) }), ...(req.query.to && { $lte: String(req.query.to) }) };
    res.json({ items: (await Model.find(q).sort(sort).limit(5000)).map((d) => d.toJSON()) });
  });
  r.post(path, async (req, res) => {
    const b = parse(schema, req.body);
    res.status(201).json({ item: (await Model.create({ ...b, user: req.userId })).toJSON() });
  });
  r.put(`${path}/:id`, async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(404, 'Not found');
    const b = parse(schema.partial(), req.body);
    const d = await Model.findOneAndUpdate({ _id: req.params.id, user: req.userId }, { $set: b }, { new: true });
    if (!d) throw new HttpError(404, 'Not found');
    res.json({ item: d.toJSON() });
  });
  r.delete(`${path}/:id`, async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(404, 'Not found');
    await Model.deleteOne({ _id: req.params.id, user: req.userId });
    res.json({ ok: true });
  });
}

const r = Router();

export const entrySchema = z.object({
  kind: z.enum(['expense', 'income']), date: ymd, amount: num.positive(), currency: str(3).optional(),
  category: str(40).optional(), method: str(40).optional(), note: str(300).optional(),
});
export const emiSchema = z.object({
  name: str(60).min(1), lender: str(60).optional(), amount: num.positive(), currency: str(3).optional(),
  dueDay: z.number().int().min(1).max(31).optional(), start: ym, months: z.number().int().min(1).max(600),
  paid: z.array(ym).max(600).optional(), note: str(300).optional(),
});
export const purchaseSchema = z.object({
  date: ymd, firm: str(60).min(1), fee: num.nonnegative(), inr: num.nonnegative().nullable().optional(),
  program: str(60).optional(), size: num.nonnegative().nullable().optional(), status: str(30).optional(), note: str(300).optional(), src: str(80).optional(),
});
export const payoutSchema = z.object({
  date: ymd, firm: str(60).min(1), gross: num.nonnegative(), fee: num.nonnegative().optional(), net: num.nonnegative(),
  inr: num.nonnegative().nullable().optional(), account: str(60).optional(), ref: str(60).optional(), note: str(300).optional(), src: str(80).optional(),
});
const n0 = num.nullable().optional();
export const daySchema = z.object({
  habits: z.record(z.string().max(40), z.boolean()).optional(),
  sleep: n0, workout: n0, steps: n0, water: n0, meditation: n0, screen: n0, mood: n0, energy: n0, weight: n0, calories: n0, protein: n0,
  junk: z.boolean().nullable().optional(),
  meals: z.object({ breakfast: str(300).optional(), lunch: str(300).optional(), dinner: str(300).optional(), snacks: str(300).optional() }).optional(),
  note: str(1000).optional(),
});

crud(r, '/money/entries', FinEntry, entrySchema);
crud(r, '/money/emis', Emi, emiSchema, { start: 1, createdAt: 1 });
export const holdingSchema = z.object({
  kind: z.enum(['investment', 'loan']), name: str(60).min(1), where: str(60).optional(), principal: num.positive(),
  rate: num.min(0).max(100), compounding: z.enum(['simple', 'yearly', 'quarterly', 'monthly']).optional(), start: ymd,
  months: z.number().int().min(1).max(600).nullable().optional(), closed: z.boolean().optional(), note: str(300).optional(),
});
crud(r, '/money/holdings', Holding, holdingSchema, { start: -1 });
crud(r, '/props/purchases', PropPurchase, purchaseSchema);
crud(r, '/props/payouts', PropPayout, payoutSchema);

// Bulk import (e.g. a statement); skips rows already present (same date, firm and amount)
r.post('/props/import', async (req, res) => {
  const b = parse(z.object({ purchases: z.array(purchaseSchema).max(2000).default([]), payouts: z.array(payoutSchema).max(500).default([]) }), req.body);
  const key = (x, amt) => `${x.date}|${x.firm}|${amt}`;
  const have = new Map();
  for (const p of await PropPurchase.find({ user: req.userId }).lean()) { const k = key(p, p.fee); have.set(k, (have.get(k) || 0) + 1); }
  const seen = new Map(); let added = 0;
  const toAdd = [];
  for (const p of b.purchases) {
    const k = key(p, p.fee); seen.set(k, (seen.get(k) || 0) + 1);
    if (seen.get(k) > (have.get(k) || 0)) toAdd.push({ ...p, user: req.userId });
  }
  if (toAdd.length) { await PropPurchase.insertMany(toAdd); added += toAdd.length; }
  const havePay = new Set((await PropPayout.find({ user: req.userId }).lean()).map((p) => key(p, p.net)));
  const pays = b.payouts.filter((p) => !havePay.has(key(p, p.net))).map((p) => ({ ...p, user: req.userId }));
  if (pays.length) await PropPayout.insertMany(pays);
  res.json({ purchases: toAdd.length, payouts: pays.length, skipped: b.purchases.length - toAdd.length + b.payouts.length - pays.length });
});

// Lifestyle: one log per day
r.get('/life/days', async (req, res) => {
  const q = { user: req.userId };
  if (req.query.from) q.date = { $gte: String(req.query.from) };
  res.json({ items: (await DayLog.find(q).sort({ date: -1 }).limit(800)).map((d) => d.toJSON()) });
});
r.put('/life/days/:date', async (req, res) => {
  const date = parse(ymd, req.params.date);
  const b = parse(daySchema, req.body);
  const set = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === 'habits' || k === 'meals') for (const [hk, hv] of Object.entries(v)) set[`${k}.${hk}`] = hv;
    else set[k] = v;
  }
  const d = await DayLog.findOneAndUpdate({ user: req.userId, date }, { $set: set }, { new: true, upsert: true, setDefaultsOnInsert: true });
  res.json({ item: d.toJSON() });
});

export default r;
