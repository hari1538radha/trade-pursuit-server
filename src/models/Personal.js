// Admin-only personal tracking: money (expenses, income, EMIs), prop-firm purchases & payouts, lifestyle.
import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;
const own = { user: { type: ObjectId, ref: 'User', required: true, index: true } };
const json = (schema) => schema.set('toJSON', { transform: (_d, r) => { r.id = String(r._id); delete r._id; delete r.__v; delete r.user; return r; } });

// Expenses and income (₹ by default)
export const FinEntry = mongoose.model('FinEntry', json(new mongoose.Schema({
  ...own,
  kind: { type: String, enum: ['expense', 'income'], required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  category: { type: String, default: 'Other', maxlength: 40 },
  method: { type: String, default: '', maxlength: 40 }, // card, UPI, cash…
  note: { type: String, default: '', maxlength: 300 },
}, { timestamps: true })));

// Loans / EMIs: monthly amount, due day, tenure, months paid
export const Emi = mongoose.model('Emi', json(new mongoose.Schema({
  ...own,
  name: { type: String, required: true, maxlength: 60 },
  lender: { type: String, default: '', maxlength: 60 },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  dueDay: { type: Number, min: 1, max: 31, default: 5 },
  start: { type: String, required: true }, // YYYY-MM (first instalment)
  months: { type: Number, min: 1, max: 600, required: true },
  paid: { type: [String], default: [] }, // YYYY-MM marked paid
  note: { type: String, default: '', maxlength: 300 },
}, { timestamps: true })));

// Prop-firm account purchases (USD fee) and payouts
export const PropPurchase = mongoose.model('PropPurchase', json(new mongoose.Schema({
  ...own,
  date: { type: String, required: true },
  firm: { type: String, required: true, maxlength: 60 },
  fee: { type: Number, required: true }, // USD
  inr: Number, // amount debited in ₹, if known
  program: { type: String, default: '', maxlength: 60 },
  size: Number,
  status: { type: String, default: '', maxlength: 30 }, // active | passed | funded | breached | failed
  note: { type: String, default: '', maxlength: 300 },
  src: { type: String, default: '' },
}, { timestamps: true })));

export const PropPayout = mongoose.model('PropPayout', json(new mongoose.Schema({
  ...own,
  date: { type: String, required: true },
  firm: { type: String, required: true, maxlength: 60 },
  gross: { type: Number, required: true },
  fee: { type: Number, default: 0 },
  net: { type: Number, required: true },
  inr: Number,
  account: { type: String, default: '', maxlength: 60 },
  ref: { type: String, default: '', maxlength: 60 },
  note: { type: String, default: '', maxlength: 300 },
  src: { type: String, default: '' },
}, { timestamps: true })));

// One lifestyle log per day
const dayLog = new mongoose.Schema({
  ...own,
  date: { type: String, required: true },
  habits: { type: Map, of: Boolean, default: {} },
  sleep: Number, workout: Number, steps: Number, water: Number, meditation: Number, screen: Number,
  mood: Number, energy: Number, weight: Number, calories: Number, protein: Number,
  junk: Boolean,
  meals: { breakfast: String, lunch: String, dinner: String, snacks: String },
  note: { type: String, default: '', maxlength: 1000 },
}, { timestamps: true });
dayLog.index({ user: 1, date: 1 }, { unique: true });
export const DayLog = mongoose.model('DayLog', json(dayLog));
