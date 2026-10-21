import { Task, TaskEvent, Team, Project, Comment } from '../models/index.js';
import { withTransaction } from '../config/db.js';
import { emitToTeam } from '../sockets/index.js';
import { notify } from './notificationService.js';
import { badRequest, conflict, notFound } from '../utils/http.js';

/**
 * All task writes go through this service. Each mutation:
 *   1. updates the task document (current state)
 *   2. appends one task_events row per changed field
 *   3. commits both atomically (transaction when available)
 *   4. then broadcasts over Socket.io and creates notifications
 */

function eventBase(task, actorId, at) {
  return {
    taskId: task._id,
    teamId: task.teamId,
    projectId: task.projectId,
    actorId,
    priority: task.priority,
    assigneeId: task.assigneeId,
    at,
  };
}

const str = (v) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

/** Apply lifecycle side effects of a status transition to the task doc. */
export function applyStatusTransition(task, from, to, at) {
  if (from === to) return;
  if (from === 'todo' && !task.startedAt) task.startedAt = at;
  if (to === 'done') task.completedAt = at;
  if (from === 'done' && to !== 'done') {
    task.completedAt = null;
    task.reopenCount += 1;
  }
}

export async function createTask({ actor, teamId, input }) {
  const project = await Project.findOne({ _id: input.projectId, teamId });
  if (!project) throw badRequest('Project does not belong to this team');

  const task = await withTransaction(async (session) => {
    // Atomic per-team counter gives human-readable keys without races.
    const team = await Team.findByIdAndUpdate(teamId, { $inc: { taskSeq: 1 } }, { new: true, session });
    const at = new Date();
    const [doc] = await Task.create(
      [{ ...input, teamId, number: team.taskSeq, creatorId: actor._id, startedAt: input.status && input.status !== 'todo' ? at : null }],
      { session },
    );
    const events = [{ ...eventBase(doc, actor._id, at), type: 'created', toStatus: doc.status }];
    if (doc.assigneeId) events.push({ ...eventBase(doc, actor._id, at), type: 'assigned', toAssigneeId: doc.assigneeId });
    await TaskEvent.insertMany(events, { session });
    return doc;
  });

  emitToTeam(teamId, 'task:created', task.toJSON());
  if (task.assigneeId) {
    await notify({
      recipients: [task.assigneeId],
      type: 'task_assigned',
      taskId: task._id,
      actorId: actor._id,
      message: `${actor.name} assigned you "${task.title}"`,
    });
  }
  return task;
}

const TRACKED = {
  status: 'status_changed',
  assigneeId: 'assigned',
  priority: 'priority_changed',
  dueDate: 'due_date_changed',
  estimateHours: 'estimate_changed',
};

export async function updateTask({ actor, task, changes, expectedVersion }) {
  if (expectedVersion !== undefined && expectedVersion !== task.version) {
    throw conflict('Task was modified by someone else. Refresh and try again.');
  }

  const at = new Date();
  const before = task.toObject();
  const events = [];

  for (const [field, value] of Object.entries(changes)) {
    const prev = before[field];
    const same = str(prev) === str(value);
    if (same) continue;

    if (TRACKED[field]) {
      const ev = { type: TRACKED[field] };
      if (field === 'status') Object.assign(ev, { fromStatus: prev, toStatus: value });
      else if (field === 'assigneeId') Object.assign(ev, { fromAssigneeId: prev, toAssigneeId: value });
      else Object.assign(ev, { fromValue: str(prev), toValue: str(value) });
      events.push(ev);
    }
    if (field === 'status') applyStatusTransition(task, prev, value, at);
    task[field] = value;
  }

  if (events.length === 0 && !task.isModified()) return task;
  task.version += 1;

  const $set = {
    ...changes,
    version: task.version,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    reopenCount: task.reopenCount,
  };

  // Optimistic concurrency at the DB level: only write if version still matches.
  await withTransaction(async (session) => {
    const res = await Task.updateOne({ _id: task._id, version: task.version - 1 }, { $set }, { session, runValidators: true });
    if (res.matchedCount === 0) throw conflict('Task was modified concurrently');
    if (events.length) {
      // Snapshot fields (priority/assignee) reflect state AFTER this change.
      await TaskEvent.insertMany(events.map((e) => ({ ...eventBase(task, actor._id, at), ...e })), { session });
    }
  });

  const payload = task.toJSON();
  emitToTeam(task.teamId, 'task:updated', payload);

  const assignment = events.find((e) => e.type === 'assigned');
  if (assignment?.toAssigneeId) {
    await notify({
      recipients: [assignment.toAssigneeId],
      type: 'task_assigned',
      taskId: task._id,
      actorId: actor._id,
      message: `${actor.name} assigned you "${task.title}"`,
    });
  }
  const statusEv = events.find((e) => e.type === 'status_changed');
  if (statusEv) {
    await notify({
      recipients: [task.creatorId, task.assigneeId],
      type: 'task_status',
      taskId: task._id,
      actorId: actor._id,
      message: `"${task.title}" moved to ${statusEv.toStatus.replace('_', ' ')}`,
    });
  }
  return task;
}

export async function softDeleteTask({ actor, task }) {
  const at = new Date();
  await withTransaction(async (session) => {
    await Task.updateOne({ _id: task._id }, { $set: { deletedAt: at }, $inc: { version: 1 } }, { session });
    await TaskEvent.create([{ ...eventBase(task, actor._id, at), type: 'deleted' }], { session });
  });
  emitToTeam(task.teamId, 'task:deleted', { id: task._id, teamId: task.teamId });
}

export async function addComment({ actor, task, body, mentions = [] }) {
  const at = new Date();
  const comment = await withTransaction(async (session) => {
    const [c] = await Comment.create([{ taskId: task._id, teamId: task.teamId, authorId: actor._id, body, mentions }], { session });
    await Task.updateOne({ _id: task._id }, { $inc: { commentCount: 1 } }, { session });
    await TaskEvent.create([{ ...eventBase(task, actor._id, at), type: 'commented' }], { session });
    return c;
  });
  const populated = await comment.populate('authorId', 'name email');
  emitToTeam(task.teamId, 'comment:created', { taskId: task._id, comment: populated.toObject() });
  await notify({
    recipients: [task.assigneeId, task.creatorId],
    type: 'task_comment',
    taskId: task._id,
    actorId: actor._id,
    message: `${actor.name} commented on "${task.title}"`,
  });
  if (mentions.length) {
    await notify({ recipients: mentions, type: 'mention', taskId: task._id, actorId: actor._id, message: `${actor.name} mentioned you on "${task.title}"` });
  }
  return populated;
}

export async function getTaskOr404(id) {
  const task = await Task.findOne({ _id: id, deletedAt: null });
  if (!task) throw notFound('Task');
  return task;
}
