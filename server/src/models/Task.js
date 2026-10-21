import mongoose from 'mongoose';
import { TASK_STATUSES, PRIORITIES } from './constants.js';

const { Schema } = mongoose;

/**
 * tasks — the CURRENT state of each task (OLTP side).
 *
 * History is NOT embedded here. Every change is appended to `task_events`
 * instead, because an embedded history array grows without bound, bloats
 * every board read and makes "time in status" queries awkward.
 *
 * A few lifecycle timestamps (startedAt, completedAt) are denormalised from
 * the event log so the most common analytics (cycle/lead time, throughput)
 * are single-collection index scans rather than event-log reconstructions.
 */
const taskSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true }, // denormalised from project for RBAC + filtering
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    number: { type: Number, required: true }, // per-team sequence -> "PLAT-142"

    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 10000, default: '' },
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    labels: {
      type: [{ type: String, lowercase: true, trim: true, maxlength: 30 }],
      validate: [(v) => v.length <= 10, 'At most 10 labels'],
    },

    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    estimateHours: { type: Number, min: 0, max: 400, default: null },
    dueDate: { type: Date, default: null },
    position: { type: Number, default: 0 }, // ordering inside a board column

    // Denormalised lifecycle timestamps, maintained by taskService
    startedAt: { type: Date, default: null }, // first move out of todo
    completedAt: { type: Date, default: null }, // latest move into done (cleared on reopen)
    reopenCount: { type: Number, default: 0 }, // done -> anything else
    commentCount: { type: Number, default: 0 },

    deletedAt: { type: Date, default: null }, // soft delete keeps history analysable
    version: { type: Number, default: 0 }, // optimistic concurrency for realtime edits
  },
  { timestamps: true, collection: 'tasks' },
);

// ---- Indexes: each one is justified by a concrete query (see docs/SCHEMA.md) ----
taskSchema.index({ teamId: 1, number: 1 }, { unique: true }); // key lookup "PLAT-142"
taskSchema.index({ projectId: 1, status: 1, position: 1 }); // kanban board (ESR: equality, equality, sort)
taskSchema.index({ assigneeId: 1, status: 1, dueDate: 1 }); // "my work", workload, overdue per person
taskSchema.index({ teamId: 1, status: 1, dueDate: 1 }); // overdue + team filters
taskSchema.index({ teamId: 1, completedAt: 1 }, { partialFilterExpression: { completedAt: { $type: 'date' } } }); // throughput/cycle time
taskSchema.index({ teamId: 1, createdAt: 1 }); // arrival rate
taskSchema.index({ title: 'text', description: 'text' }, { weights: { title: 5, description: 1 } }); // search

taskSchema.virtual('isOverdue').get(function isOverdue() {
  return Boolean(this.dueDate && this.status !== 'done' && this.dueDate < new Date());
});

taskSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Task = mongoose.model('Task', taskSchema);
