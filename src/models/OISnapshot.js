import mongoose from 'mongoose';

// Intraday option-chain summary, saved at most every few minutes while a user watches a chain.
const snap = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: String,
  expiry: String,
  at: { type: Date, default: Date.now },
  spot: Number, pcr: Number, ceOI: Number, peOI: Number, ceChg: Number, peChg: Number, maxPain: Number, atmIv: Number,
  // per-strike OI near the money: [strike, ceOI, peOI, ceChg, peChg]
  strikes: { type: [[Number]], default: [] },
});
snap.index({ user: 1, symbol: 1, expiry: 1, at: -1 });
snap.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 }); // keep 14 days

export const OISnapshot = mongoose.model('OISnapshot', snap);
