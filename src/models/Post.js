import mongoose from 'mongoose';

const postSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: 1000 },
    tags: [String],
    trade: { type: Object }, // snapshot of a shared trade/week card
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);
postSchema.index({ createdAt: -1 });
postSchema.index({ tags: 1, createdAt: -1 });

export const Post = mongoose.model('Post', postSchema);
