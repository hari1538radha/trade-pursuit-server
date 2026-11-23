import mongoose from 'mongoose';

// A server-side Sensibull recorder: keeps pulling one chain every 3s during market hours,
// even when nobody has the site open. The session cookie is stored encrypted (lib/secret.js)
// and is never returned by the API.
const rec = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  underlying: { type: String, required: true },
  expiry: { type: String, required: true }, // YYYY-MM-DD, rolled forward automatically after expiry
  atm: { type: String, default: 'ten' },
  autoRoll: { type: Boolean, default: true },
  cookie: { type: String, required: true }, // sealed
  enabled: { type: Boolean, default: true },
  status: { type: String, default: 'waiting' }, // waiting | recording | expired | error | rolling
  lastAt: Date,
  lastError: String,
  pulls: { type: Number, default: 0 },
  fails: { type: Number, default: 0 },
}, { timestamps: true });
rec.index({ user: 1, underlying: 1 }, { unique: true });

export const SbRecorder = mongoose.model('SbRecorder', rec);
