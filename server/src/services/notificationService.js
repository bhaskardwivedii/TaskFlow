import { Notification } from '../models/index.js';
import { emitToUser } from '../sockets/index.js';

/**
 * Create notifications for recipients (never the actor themself) and push
 * them over the socket. Called after the DB transaction commits.
 */
export async function notify({ recipients, type, taskId, actorId, message }) {
  const unique = [...new Set(recipients.filter(Boolean).map(String))].filter((id) => id !== String(actorId));
  if (unique.length === 0) return [];
  const docs = await Notification.insertMany(unique.map((userId) => ({ userId, type, taskId, actorId, message })));
  docs.forEach((n) => emitToUser(n.userId, 'notification:new', n.toObject()));
  return docs;
}
