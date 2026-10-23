import { z } from 'zod';
import { User, GLOBAL_ROLES } from '../models/index.js';
import { notFound, badRequest } from '../utils/http.js';

export const roleSchema = z.object({ role: z.enum(GLOBAL_ROLES) });

/** Directory of all users (admin only) — powers the People admin page and member pickers. */
export async function listUsers(req, res) {
  const users = await User.find().sort({ name: 1 }).lean();
  res.json({
    users: users.map((u) => ({ id: u._id, name: u.name, email: u.email, role: u.role, title: u.title, department: u.department, isActive: u.isActive })),
  });
}

/** Change a user's GLOBAL role (member / manager / admin). Admin only. */
export async function updateRole(req, res) {
  if (String(req.params.id) === String(req.user._id)) throw badRequest("You can't change your own role");
  const user = await User.findByIdAndUpdate(req.params.id, { role: req.body.role }, { new: true });
  if (!user) throw notFound('User');
  res.json({ user });
}
