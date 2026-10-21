import mongoose from 'mongoose';
import { EVENT_TYPES, TASK_STATUSES, PRIORITIES } from './constants.js';

const { Schema } = mongoose;

/**
 * task_events — append-only, immutable event log (the analytics fact table).
 *
 * One document per change. It is never updated or deleted, so it is the
 * source of truth for "what happened when": time-in-status, reopen loops,
 * reassignment churn, activity heatmaps, and point-in-time reconstruction.
 *
 * Dimension keys (teamId, projectId) and the task's priority/assignee at the
 * time of the event are copied onto every row. That denormalisation is
 * deliberate: analytical queries filter and group on them without a $lookup,
 * and the values reflect the state *at that moment* (a slowly-changing
 * dimension captured for free).
 */
const taskEventSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: EVENT_TYPES, required: true },

    // Typed before/after fields instead of a free-form Mixed payload, so the
    // columns are queryable, indexable and export cleanly to CSV.
    fromStatus: { type: String, enum: [...TASK_STATUSES, null], default: null },
    toStatus: { type: String, enum: [...TASK_STATUSES, null], default: null },
    fromAssigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    toAssigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    fromValue: { type: String, default: null }, // priority / due date / estimate (stringified)
    toValue: { type: String, default: null },

    // Snapshot of the task at event time
    priority: { type: String, enum: PRIORITIES },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    at: { type: Date, required: true, default: Date.now },
  },
  {
    collection: 'task_events',
    versionKey: false,
    // Immutability: no updatedAt; mutations are blocked below.
    timestamps: false,
  },
);

taskEventSchema.index({ taskId: 1, at: 1 }); // task timeline + $setWindowFields partition
taskEventSchema.index({ teamId: 1, type: 1, at: 1 }); // team analytics over a date range
taskEventSchema.index({ actorId: 1, at: -1 }); // per-user activity feed
taskEventSchema.index({ type: 1, toStatus: 1, at: 1 }); // transition analysis

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  taskEventSchema.pre(op, function blockMutation(next) {
    next(new Error('task_events is append-only'));
  });
}

export const TaskEvent = mongoose.model('TaskEvent', taskEventSchema);
