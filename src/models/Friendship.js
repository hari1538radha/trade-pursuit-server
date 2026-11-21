import mongoose from 'mongoose';

// One document per pair of traders. `from` sent the request, `to` received it.
const friendshipSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
  },
  { timestamps: true }
);
friendshipSchema.index({ from: 1, to: 1 }, { unique: true });
friendshipSchema.index({ to: 1, status: 1 });

/** Ids of everyone with an accepted friendship with `userId`. */
friendshipSchema.statics.friendIds = async function (userId) {
  const rows = await this.find({ status: 'accepted', $or: [{ from: userId }, { to: userId }] }).select('from to').lean();
  return rows.map((r) => String(String(r.from) === String(userId) ? r.to : r.from));
};

export const Friendship = mongoose.model('Friendship', friendshipSchema);
