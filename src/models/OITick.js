import mongoose from 'mongoose';

// One record per 3-second pull while a user has the option chain open:
// totals plus the OI change since the previous pull, per strike (only strikes that moved).
const tick = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: String,
  expiry: String,
  at: { type: Date, default: Date.now },
  spot: Number, atm: Number, pcr: Number, ceOI: Number, peOI: Number,
  dCe: Number, dPe: Number, // change in total call / put OI since the previous pull
  ceDelta: Number, peDelta: Number, // ATM option delta (greek), when the feed has it
  d: { type: [[Number]], default: [] }, // [strike, dCeOI, dPeOI]
});
tick.index({ user: 1, symbol: 1, expiry: 1, at: -1 });
tick.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 3 }); // keep 3 days

export const OITick = mongoose.model('OITick', tick);
