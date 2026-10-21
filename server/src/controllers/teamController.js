import { z } from 'zod';
import mongoose from 'mongoose';
import { Team, User, Project, TEAM_ROLES, PROJECT_STATUSES } from '../models/index.js';
import { badRequest, notFound } from '../utils/http.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  key: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/),
  description: z.string().max(500).optional(),
});
export const addMemberSchema = z.object({ email: z.string().email(), role: z.enum(TEAM_ROLES).default('member') });
export const memberRoleSchema = z.object({ role: z.enum(TEAM_ROLES) });
export const memberParams = z.object({ teamId: objectId, userId: objectId });

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(2000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function listMyTeams(req, res) {
  const filter = req.user.role === 'admin' || req.user.role === 'manager' ? {} : { 'members.userId': req.user._id };
  const teams = await Team.find(filter).sort({ name: 1 }).lean();
  res.json({
    teams: teams.map((t) => ({
      id: t._id,
      name: t.name,
      key: t.key,
      description: t.description,
      memberCount: t.members.length,
      myRole: t.members.find((m) => m.userId.equals(req.user._id))?.role ?? (req.user.role === 'admin' ? 'lead' : 'viewer'),
    })),
  });
}

export async function createTeam(req, res) {
  const team = await Team.create({ ...req.body, createdBy: req.user._id, members: [{ userId: req.user._id, role: 'lead' }] });
  res.status(201).json({ team });
}

export async function getTeam(req, res) {
  const team = await req.team.populate('members.userId', 'name email title department');
  res.json({
    team: {
      id: team._id,
      name: team.name,
      key: team.key,
      description: team.description,
      myRole: req.teamRole,
      members: team.members.map((m) => ({ ...m.userId.toJSON(), teamRole: m.role, joinedAt: m.joinedAt })),
    },
  });
}

export async function addMember(req, res) {
  const user = await User.findOne({ email: req.body.email.toLowerCase() });
  if (!user) throw notFound('User');
  if (req.team.roleOf(user._id)) throw badRequest('User is already a member');
  // $push with a guard keeps it idempotent under concurrent requests.
  await Team.updateOne({ _id: req.team._id, 'members.userId': { $ne: user._id } }, { $push: { members: { userId: user._id, role: req.body.role } } });
  res.status(201).json({ ok: true });
}

export async function updateMemberRole(req, res) {
  const r = await Team.updateOne({ _id: req.team._id, 'members.userId': req.params.userId }, { $set: { 'members.$.role': req.body.role } });
  if (!r.matchedCount) throw notFound('Member');
  res.json({ ok: true });
}

export async function removeMember(req, res) {
  await Team.updateOne({ _id: req.team._id }, { $pull: { members: { userId: req.params.userId } } });
  res.status(204).end();
}

export async function listProjects(req, res) {
  const projects = await Project.find({ teamId: req.team._id }).sort({ status: 1, name: 1 }).lean();
  res.json({ projects });
}

export async function createProject(req, res) {
  const project = await Project.create({ ...req.body, teamId: req.team._id, ownerId: req.user._id });
  res.status(201).json({ project });
}
