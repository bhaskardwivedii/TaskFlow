import { Notification } from '../models/index.js';

export async function list(req, res) {
  const [items, unread] = await Promise.all([
    Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ userId: req.user._id, readAt: null }),
  ]);
  res.json({ notifications: items, unread });
}

export async function markRead(req, res) {
  await Notification.updateOne({ _id: req.params.id, userId: req.user._id }, { $set: { readAt: new Date() } });
  res.json({ ok: true });
}

export async function markAllRead(req, res) {
  const r = await Notification.updateMany({ userId: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  res.json({ ok: true, updated: r.modifiedCount });
}
