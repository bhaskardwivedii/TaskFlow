import mongoose from 'mongoose';
import { NOTIFICATION_TYPES } from './constants.js';

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // recipient
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    message: { type: String, required: true, maxlength: 300 },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'notifications', versionKey: false },
);

// Unread badge + inbox listing in one index (equality on userId/readAt, sort on createdAt)
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
// Notifications are transient: MongoDB's TTL monitor removes them after 90 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const Notification = mongoose.model('Notification', notificationSchema);
