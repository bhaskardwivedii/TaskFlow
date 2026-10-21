import mongoose from 'mongoose';
import { PROJECT_STATUSES } from './constants.js';

const { Schema } = mongoose;

const projectSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 2000 },
    status: { type: String, enum: PROJECT_STATUSES, default: 'active' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startDate: { type: Date },
    targetDate: { type: Date },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: '#4f46e5' },
  },
  { timestamps: true, collection: 'projects' },
);

projectSchema.index({ teamId: 1, status: 1 });
projectSchema.index({ teamId: 1, name: 1 }, { unique: true });

export const Project = mongoose.model('Project', projectSchema);
