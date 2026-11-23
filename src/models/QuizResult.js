import mongoose from 'mongoose';

const quizSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    topic: { type: String, default: 'mixed', maxlength: 40 },
    score: { type: Number, required: true },
    total: { type: Number, required: true },
    missed: { type: [String], default: [] }, // question ids answered wrong
    asked: { type: [String], default: [] }, // all question ids in this quiz
  },
  { timestamps: true }
);
quizSchema.index({ user: 1, createdAt: -1 });
quizSchema.set('toJSON', { transform: (_d, r) => { r.id = String(r._id); delete r._id; delete r.__v; return r; } });

export const QuizResult = mongoose.model('QuizResult', quizSchema);
