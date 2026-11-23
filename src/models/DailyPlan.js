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
