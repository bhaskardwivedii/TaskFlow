import { z } from 'zod';
import mongoose from 'mongoose';
import { Task, TaskEvent, Comment, TASK_STATUSES, PRIORITIES, OPEN_STATUSES } from '../models/index.js';
import * as taskService from '../services/taskService.js';
import { badRequest, forbidden } from '../utils/http.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

export const createTaskSchema = z.object({
  projectId: objectId,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  labels: z.array(z.string().trim().toLowerCase().max(30)).max(10).optional(),
  assigneeId: objectId.nullable().optional(),
  estimateHours: z.number().min(0).max(400).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

export const updateTaskSchema = createTaskSchema
  .omit({ projectId: true })
  .partial()
  .extend({ position: z.number().optional(), version: z.number().int().optional() })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'No changes supplied');

export const listTasksQuery = z.object({
  projectId: objectId.optional(),
  status: z.string().optional(), // comma-separated
  assigneeId: z.union([objectId, z.literal('me'), z.literal('none')]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  q: z.string().trim().max(100).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  sort: z.enum(['position', '-createdAt', 'dueDate', '-updatedAt']).default('position'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  mentions: z.array(objectId).max(20).optional(),
});

/** Assignees must be members of the task's team. */
function assertAssignable(team, assigneeId) {
  if (assigneeId && !team.roleOf(assigneeId)) throw badRequest('Assignee is not a member of this team');
}

export async function listTasks(req, res) {
  const q = req.validatedQuery;
  const filter = { teamId: req.team._id, deletedAt: null };
  if (q.projectId) filter.projectId = q.projectId;
  if (q.status) {
    const statuses = q.status.split(',').filter((s) => TASK_STATUSES.includes(s));
    filter.status = { $in: statuses };
  }
  if (q.assigneeId === 'me') filter.assigneeId = req.user._id;
  else if (q.assigneeId === 'none') filter.assigneeId = null;
  else if (q.assigneeId) filter.assigneeId = q.assigneeId;
  if (q.priority) filter.priority = q.priority;
  if (q.overdue === 'true') Object.assign(filter, { status: { $in: OPEN_STATUSES }, dueDate: { $lt: new Date() } });
  if (q.q) filter.$text = { $search: q.q };

  const sort = { position: { status: 1, position: 1 }, '-createdAt': { createdAt: -1 }, dueDate: { dueDate: 1 }, '-updatedAt': { updatedAt: -1 } }[q.sort] ?? { createdAt: -1 };

  const [tasks, total] = await Promise.all([
    Task.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate('assigneeId', 'name email')
      .lean(),
    Task.countDocuments(filter),
  ]);
  res.json({ tasks, total, page: q.page, limit: q.limit });
}

export async function createTask(req, res) {
  if (req.teamRole === 'viewer') throw forbidden('Viewers cannot create tasks');
  assertAssignable(req.team, req.body.assigneeId);
  const task = await taskService.createTask({ actor: req.user, teamId: req.team._id, input: req.body });
  res.status(201).json({ task });
}

export async function getTask(req, res) {
  const task = await req.task.populate([
    { path: 'assigneeId', select: 'name email' },
    { path: 'creatorId', select: 'name email' },
    { path: 'projectId', select: 'name color' },
  ]);
  res.json({ task: { ...task.toJSON(), key: `${req.team.key}-${task.number}` } });
}

export async function updateTask(req, res) {
  if (req.teamRole === 'viewer') throw forbidden('Viewers cannot edit tasks');
  const { version, ...changes } = req.body;
  if ('assigneeId' in changes) assertAssignable(req.team, changes.assigneeId);
  const task = await taskService.updateTask({ actor: req.user, task: req.task, changes, expectedVersion: version });
  res.json({ task });
}

export async function deleteTask(req, res) {
  const canDelete = req.teamRole === 'lead' || req.task.creatorId.equals(req.user._id);
  if (!canDelete) throw forbidden('Only the creator or a team lead can delete a task');
  await taskService.softDeleteTask({ actor: req.user, task: req.task });
  res.status(204).end();
}

export async function taskHistory(req, res) {
  const events = await TaskEvent.find({ taskId: req.task._id })
    .sort({ at: 1, _id: 1 }) // _id breaks ties between events written in the same transaction
    .populate('actorId', 'name')
    .populate('toAssigneeId', 'name')
    .lean();
  res.json({ events });
}

export async function listComments(req, res) {
  const comments = await Comment.find({ taskId: req.task._id }).sort({ createdAt: 1 }).populate('authorId', 'name email').lean();
  res.json({ comments });
}

export async function addComment(req, res) {
  if (req.teamRole === 'viewer') throw forbidden('Viewers cannot comment');
  const comment = await taskService.addComment({ actor: req.user, task: req.task, ...req.body });
  res.status(201).json({ comment });
}

export async function myTasks(req, res) {
  const tasks = await Task.find({ assigneeId: req.user._id, deletedAt: null, status: { $in: OPEN_STATUSES } })
    .sort({ dueDate: 1 })
    .limit(100)
    .populate('teamId', 'key name')
    .lean();
  res.json({ tasks });
}
