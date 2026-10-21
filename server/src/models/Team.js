import mongoose from 'mongoose';
import { TEAM_ROLES } from './constants.js';

const { Schema } = mongoose;

// Membership is embedded: a team has tens of members, not thousands, so the
// array is bounded and we read it on every authorization check. A multikey
// index on members.userId answers "which teams am I in?" without a join.
const memberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: TEAM_ROLES, default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    key: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z]{2,6}$/ }, // e.g. "PLAT" -> PLAT-142
    description: { type: String, maxlength: 500 },
    members: {
      type: [memberSchema],
      validate: [(v) => v.length <= 200, 'A team cannot exceed 200 members'],
    },
    taskSeq: { type: Number, default: 0 }, // atomic counter for human-readable task numbers
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'teams' },
);

teamSchema.index({ key: 1 }, { unique: true });
teamSchema.index({ 'members.userId': 1 });

teamSchema.methods.roleOf = function roleOf(userId) {
  const m = this.members.find((x) => x.userId.equals(userId));
  return m ? m.role : null;
};

export const Team = mongoose.model('Team', teamSchema);
