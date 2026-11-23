import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    bias: { type: String, default: '' },
    keyLevels: { type: String, default: '' },
    ruleReminder: { type: String, default: '' },
    avoid: { type: String, default: '' },
    checks: { type: [Boolean], default: [] },
    // Full pre-market analysis
    instruments: { type: [String], default: [] },
    sessionFocus: { type: String, default: '' },
    narrative: { type: String, default: '' }, // higher-timeframe story
    bullCase: { type: String, default: '' },
    bearCase: { type: String, default: '' },
    newsToWatch: { type: String, default: '' },
    images: {
      type: [{ src: String, caption: { type: String, default: '' }, _id: false }],
      default: [],
      validate: (v) => v.length <= 8,
    },
    rangeChecks: {
      type: [{ symbol: String, adr: Number, todayRange: Number, pct: Number, left: Number, pdh: Number, pdl: Number, verdict: String, line: String, at: Date, _id: false }],
      default: [],
    },
  },
  { timestamps: true }
);
planSchema.index({ user: 1, date: 1 }, { unique: true });
planSchema.set('toJSON', {
  transform: (_d, r) => {
    r.id = String(r._id);
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const DailyPlan = mongoose.model('DailyPlan', planSchema);
