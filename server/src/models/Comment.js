import mongoose from 'mongoose';

const { Schema } = mongoose;

// Comments live in their own collection (unbounded per task). The task keeps a
// commentCount counter so board cards never need to count.
const commentSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    editedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'comments' },
);

commentSchema.index({ taskId: 1, createdAt: 1 });
commentSchema.index({ authorId: 1, createdAt: -1 });

export const Comment = mongoose.model('Comment', commentSchema);
