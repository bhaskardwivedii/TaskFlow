import { z } from 'zod';
import { User } from '../models/index.js';
import { signToken } from '../middleware/auth.js';
import { conflict, unauthorized } from '../utils/http.js';

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128).regex(/[A-Za-z]/, 'Needs a letter').regex(/\d/, 'Needs a digit'),
  title: z.string().trim().max(80).optional(),
  department: z.string().trim().max(60).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function register(req, res) {
  const { password, ...rest } = req.body;
  if (await User.exists({ email: rest.email })) throw conflict('Email already registered');
  // Self-registration always yields the least-privileged role; admins promote.
  const user = await User.create({ ...rest, role: 'member', passwordHash: await User.hashPassword(password) });
  res.status(201).json({ token: signToken(user), user });
}

export async function login(req, res) {
  const user = await User.findOne({ email: req.body.email }).select('+passwordHash');
  // Same error for unknown email and wrong password (no account enumeration).
  if (!user || !user.isActive || !(await user.verifyPassword(req.body.password))) {
    throw unauthorized('Invalid email or password');
  }
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ token: signToken(user), user });
}

export async function me(req, res) {
  res.json({ user: req.user });
}
