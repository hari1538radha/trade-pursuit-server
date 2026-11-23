import mongoose from 'mongoose';

const noteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body: { type: String, default: '', maxlength: 20000 },
    tags: { type: [String], default: [] },
    pinned: { type: Boolean, default: false },
    kind: { type: String, enum: ['lesson', 'rule', 'mistake', 'idea', 'review'], default: 'lesson' },
    trade: { type: mongoose.Schema.Types.ObjectId, ref: 'Trade' },
  },
  { timestamps: true }
);
noteSchema.index({ user: 1, pinned: -1, updatedAt: -1 });
noteSchema.set('toJSON', { transform: (_d, r) => { r.id = String(r._id); delete r._id; delete r.__v; return r; } });

export const Note = mongoose.model('Note', noteSchema);
