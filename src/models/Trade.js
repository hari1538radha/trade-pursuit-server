import mongoose from 'mongoose';

const tradeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mode: { type: String, enum: ['live', 'paper'], default: 'live' },
    noTrade: { type: Boolean, default: false }, // "No Trade Day" entry
    date: { type: String, required: true }, // YYYY-MM-DD (trader's local day)
    symbol: { type: String, uppercase: true, trim: true, maxlength: 20, default: '' },
    assetClass: { type: String, default: 'Futures' },
    tradeType: { type: String, default: 'Day' },
    direction: { type: String, enum: ['long', 'short'], default: 'long' },
    session: { type: String, default: '' },
    followedPlan: { type: Boolean, default: true },
    accounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account' }],
    entry: Number,
    exit: Number,
    pnl: { type: Number, default: 0 },
    size: Number,
    plannedRR: Number,
    realizedRR: Number,
    entryTime: String,
    exitTime: String,
    stopLoss: Number,
    target: Number,
    partials: [{ price: Number, size: Number, _id: false }],
    addOns: [{ price: Number, size: Number, _id: false }],
    mae: Number,
    mfe: Number,
    exitReason: String,
    playbook: String,
    targets: [String],
    confluences: [String],
    confirmations: [String],
    bonus: [String],
    postLoss: { type: String, default: 'No revenge trade' },
    emotionsPos: [String],
    emotionsNeg: [String],
    grade: { type: String, enum: ['A+', 'A', 'B', 'C', 'F', ''], default: '' },
    notes: { type: String, maxlength: 5000 },
    images: { type: [String], validate: (v) => v.length <= 6 }, // URLs or small data URLs
    checklist: [Boolean],
  },
  { timestamps: true }
);

tradeSchema.index({ user: 1, date: -1, createdAt: -1 });
tradeSchema.index({ user: 1, accounts: 1 });

tradeSchema.set('toJSON', {
  transform: (_d, r) => {
    r.id = String(r._id);
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const Trade = mongoose.model('Trade', tradeSchema);
