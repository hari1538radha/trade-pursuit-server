import mongoose from 'mongoose';

const rulesSchema = new mongoose.Schema(
  {
    profitTarget: Number, // $ (null for funded)
    maxLoss: Number, // $
    maxLossType: { type: String, default: 'Static' },
    dailyLoss: Number, // $
    minDays: { type: Number, default: 0 },
    minTrades: { type: Number, default: 0 },
    consistency: String,
  },
  { _id: false }
);

const accountSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    firmId: String,
    firmName: String,
    firmType: { type: String, default: 'CFD' },
    program: String,
    variant: String,
    programId: String, // catalog ids, so the next phase can take the right rules
    variantId: String,
    purchasedAt: String, // YYYY-MM-DD the account was bought (defaults to when it was added)
    passedAt: String,
    failedAt: String,
    prevAccount: String, // previous phase's account id (Phase 1 → Phase 2 → Funded)
    size: { type: Number, required: true },
    phase: { type: String, default: 'Phase 1' },
    kind: { type: String, enum: ['eval', 'funded', 'personal'], default: 'eval' },
    status: { type: String, enum: ['active', 'passed', 'failed', 'archived'], default: 'active' },
    paid: { type: Number, default: 0 },
    startBalance: Number, // balance when added (defaults to size)
    payouts: [{ amount: Number, date: String, _id: false }],
    rules: rulesSchema,
  },
  { timestamps: true }
);

accountSchema.set('toJSON', {
  transform: (_d, r) => {
    r.id = String(r._id);
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const Account = mongoose.model('Account', accountSchema);
