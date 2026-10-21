import { Server } from 'socket.io';
import { verifyToken } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { User, Team } from '../models/index.js';

let io = null;

export const rooms = {
  team: (id) => `team:${id}`,
  user: (id) => `user:${id}`,
};

/**
 * Realtime gateway. Clients authenticate with the same JWT as the REST API
 * (handshake auth), are joined to their personal room and to a room per team
 * they belong to. Mutations are broadcast by the service layer, not by
 * controllers, so every write path (REST, scripts, future jobs) emits.
 */
export function initSockets(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const { sub } = verifyToken(socket.handshake.auth?.token);
      const user = await User.findById(sub);
      if (!user?.isActive) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const { user } = socket.data;
    socket.join(rooms.user(user._id));
    // Admins and managers can open any board, so they listen to every team.
    const filter = user.role === 'member' ? { 'members.userId': user._id } : {};
    const teams = await Team.find(filter, { _id: 1 }).lean();
    teams.forEach((t) => socket.join(rooms.team(t._id)));

    // Lightweight presence: who is looking at which task right now.
    socket.on('task:viewing', ({ taskId, teamId } = {}) => {
      if (teamId && socket.rooms.has(rooms.team(teamId))) {
        socket.to(rooms.team(teamId)).emit('presence:viewing', { taskId, user: { id: user._id, name: user.name } });
      }
    });
  });

  return io;
}

export function emitToTeam(teamId, event, payload) {
  io?.to(rooms.team(teamId)).emit(event, payload);
}

export function emitToUser(userId, event, payload) {
  io?.to(rooms.user(userId)).emit(event, payload);
}
