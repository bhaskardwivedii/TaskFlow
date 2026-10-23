import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, authorize, requireTeamRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h, badRequest } from '../utils/http.js';
import { getTaskOr404 } from '../services/taskService.js';

import * as auth from '../controllers/authController.js';
import * as teams from '../controllers/teamController.js';
import * as tasks from '../controllers/taskController.js';
import * as analytics from '../controllers/analyticsController.js';
import * as notifications from '../controllers/notificationController.js';
import * as users from '../controllers/userController.js';

const router = Router();

const idParam = (name) => z.object({ [name]: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id') });

/** Load :taskId into req.task so team RBAC can resolve the team from it. */
const loadTask = h(async (req, _res, next) => {
  if (!mongoose.isValidObjectId(req.params.taskId)) throw badRequest('Invalid task id');
  req.task = await getTaskOr404(req.params.taskId);
  next();
});
const taskTeam = (req) => req.task.teamId;

// ---- health ----
router.get('/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

// ---- auth ----
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: 'draft-7', legacyHeaders: false });
router.post('/auth/register', authLimiter, validate({ body: auth.registerSchema }), h(auth.register));
router.post('/auth/login', authLimiter, validate({ body: auth.loginSchema }), h(auth.login));
router.get('/auth/me', authenticate, h(auth.me));

router.use(authenticate);

// ---- teams & membership ----
router.get('/teams', h(teams.listMyTeams));
router.post('/teams', authorize('admin', 'manager'), validate({ body: teams.createTeamSchema }), h(teams.createTeam));
router.get('/teams/:teamId', requireTeamRole('viewer'), h(teams.getTeam));
router.post('/teams/:teamId/members', requireTeamRole('lead'), validate({ body: teams.addMemberSchema }), h(teams.addMember));
router.patch('/teams/:teamId/members/:userId', requireTeamRole('lead'), validate({ params: teams.memberParams, body: teams.memberRoleSchema }), h(teams.updateMemberRole));
router.delete('/teams/:teamId/members/:userId', requireTeamRole('lead'), validate({ params: teams.memberParams }), h(teams.removeMember));

// ---- users (admin directory + global role management) ----
router.get('/users', authorize('admin', 'manager'), h(users.listUsers));
router.patch('/users/:id/role', authorize('admin'), validate({ params: idParam('id'), body: users.roleSchema }), h(users.updateRole));

// ---- projects ----
router.get('/teams/:teamId/projects', requireTeamRole('viewer'), h(teams.listProjects));
router.post('/teams/:teamId/projects', requireTeamRole('lead'), validate({ body: teams.createProjectSchema }), h(teams.createProject));

// ---- tasks ----
router.get('/me/tasks', h(tasks.myTasks));
router.get('/teams/:teamId/tasks', requireTeamRole('viewer'), validate({ query: tasks.listTasksQuery }), h(tasks.listTasks));
router.post('/teams/:teamId/tasks', requireTeamRole('member'), validate({ body: tasks.createTaskSchema }), h(tasks.createTask));
router.get('/tasks/:taskId', loadTask, requireTeamRole('viewer', taskTeam), h(tasks.getTask));
router.patch('/tasks/:taskId', loadTask, requireTeamRole('member', taskTeam), validate({ body: tasks.updateTaskSchema }), h(tasks.updateTask));
router.delete('/tasks/:taskId', loadTask, requireTeamRole('member', taskTeam), h(tasks.deleteTask));
router.get('/tasks/:taskId/events', loadTask, requireTeamRole('viewer', taskTeam), h(tasks.taskHistory));
router.get('/tasks/:taskId/comments', loadTask, requireTeamRole('viewer', taskTeam), h(tasks.listComments));
router.post('/tasks/:taskId/comments', loadTask, requireTeamRole('member', taskTeam), validate({ body: tasks.commentSchema }), h(tasks.addComment));

// ---- notifications ----
router.get('/notifications', h(notifications.list));
router.post('/notifications/read-all', h(notifications.markAllRead));
router.patch('/notifications/:id/read', validate({ params: idParam('id') }), h(notifications.markRead));

// ---- analytics (leads, managers, admins; scoping inside the controller) ----
router.get('/analytics/dashboard', validate({ query: analytics.rangeQuery }), h(analytics.dashboard));
router.get('/analytics/daily', validate({ query: analytics.rangeQuery }), h(analytics.dailyStats));
router.post('/analytics/snapshots/refresh', authorize('admin', 'manager'), validate({ query: analytics.rangeQuery }), h(analytics.refreshSnapshots));
router.get('/analytics/explain', authorize('admin'), validate({ query: analytics.rangeQuery }), h(analytics.explain));

export default router;
