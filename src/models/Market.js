import mongoose from 'mongoose';

// One document per NSE symbol with up to ~300 daily bars (oldest -> newest).
const eod = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true },
  isin: String, name: String, series: String,
  d: [String], o: [Number], h: [Number], l: [Number], c: [Number], v: [Number], val: [Number],
}, { minimize: false });
export const EodSeries = mongoose.model('EodSeries', eod);

// Single status/scan document
const meta = new mongoose.Schema({
  _id: String,
  lastDate: String,
  symbols: Number,
  scannedAt: Date,
  results: { type: Array, default: [] },
}, { minimize: false });
export const MarketMeta = mongoose.model('MarketMeta', meta);

const watch = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: { type: String, required: true, uppercase: true, trim: true, maxlength: 30 },
  setup: { type: String, maxlength: 60, default: '' },
  side: { type: String, enum: ['long', 'short', 'watch'], default: 'watch' },
  entry: Number, stop: Number, target: Number,
  qty: Number, buyPrice: Number, // holding, to work out invested amount and return
  note: { type: String, maxlength: 1000, default: '' },
  addedClose: Number,
  status: { type: String, enum: ['watching', 'triggered', 'done', 'dropped'], default: 'watching' },
}, { timestamps: true });
watch.index({ user: 1, symbol: 1 }, { unique: true });
watch.set('toJSON', { transform: (_d, r) => { r.id = String(r._id); delete r._id; delete r.__v; return r; } });
export const Watch = mongoose.model('Watch', watch);
