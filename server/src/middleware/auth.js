import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { User, Team } from '../models/index.js';
import { unauthorized, forbidden, notFound, badRequest, asyncHandler } from '../utils/http.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

/** Authenticate: Bearer JWT -> req.user (fresh from DB so role changes / deactivation apply immediately). */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw unauthorized('Account is not active');
  req.user = user;
  next();
});

/** Global role gate, e.g. authorize('admin', 'manager'). */
export const authorize = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

/**
 * Team-scoped RBAC. Resolves the team from req.params[param] (or a loader),
 * attaches req.team and req.teamRole, and checks the minimum team role.
 * Global admins bypass membership; managers get read access to every team.
 */
const TEAM_RANK = { viewer: 1, member: 2, lead: 3 };

export function requireTeamRole(minRole = 'viewer', resolveTeamId = (req) => req.params.teamId) {
  return asyncHandler(async (req, _res, next) => {
    const teamId = await resolveTeamId(req);
    if (!teamId || !mongoose.isValidObjectId(teamId)) throw badRequest('Valid teamId required');
    const team = await Team.findById(teamId);
    if (!team) throw notFound('Team');

    let role = team.roleOf(req.user._id);
    if (req.user.role === 'admin') role = 'lead';
    else if (!role && req.user.role === 'manager') role = 'viewer';

    if (!role || TEAM_RANK[role] < TEAM_RANK[minRole]) throw forbidden();
    req.team = team;
    req.teamRole = role;
    next();
  });
}
