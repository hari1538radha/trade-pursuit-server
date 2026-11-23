import mongoose from 'mongoose';
import { config } from '../config.js';

/** Usernames listed in ADMIN_USERNAMES are always admins */
export const isAdminName = (u) => config.adminUsernames.includes(String(u || '').toLowerCase());

export const DEFAULT_CHECKLIST = [
  'Have you done your high timeframe?',
  'Do you have that FVG gap?',
  'Do we have an inverse to the upside?',
  'Did we think about this entry before entering?',
];

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 24 },
    displayName: { type: String, trim: true, maxlength: 40 },
    passwordHash: { type: String, required: true, select: false },
    bio: { type: String, maxlength: 200, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    settings: {
      checklist: { type: [String], default: DEFAULT_CHECKLIST },
      breakEven: { type: Number, default: 0 }, // |pnl| <= this counts as break-even
      guardrails: {
        enabled: { type: Boolean, default: false },
        dailyLossLimit: { type: Number, default: 0 },
        maxTradesPerDay: { type: Number, default: 0 },
      },
      donts: { type: [String], default: [] }, // trader's own 'never do this' list
      coach: {
        enabled: { type: Boolean, default: true },
        lookback: { type: Number, default: 5 },
      },
      tags: {
        playbooks: { type: [String], default: ['Reversal', 'Continuation', 'Retracement', 'Manipulation'] },
        targets: { type: [String], default: ['Liquidity sweep', 'Equal highs', 'Equal lows', 'Session liquidity', 'Major high', 'Major low'] },
        confluences: { type: [String], default: ['FVG', 'Order block', 'Breaker', 'Equilibrium', 'Imbalance', 'Liquidity sweep'] },
        confirmations: { type: [String], default: ['iFVG', 'Market structure shift', 'Retest', 'Rejection'] },
        bonus: { type: [String], default: ['SMT', 'CISD', 'Displacement'] },
        exitReasons: { type: [String], default: [] },
      },
    },
    goals: {
      week: { type: String, default: '' },
      month: { type: String, default: '' },
      year: { type: String, default: '' },
      life: { type: String, default: '' },
      why: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  transform: (_d, r) => {
    r.id = String(r._id);
    delete r._id;
    delete r.__v;
    delete r.passwordHash;
    if (isAdminName(r.username)) r.role = 'admin';
    r.role = r.role || 'user';
    return r;
  },
});

export const User = mongoose.model('User', userSchema);
