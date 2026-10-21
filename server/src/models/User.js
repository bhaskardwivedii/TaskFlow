import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { GLOBAL_ROLES } from './constants.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      lowercase: true, // normalised at write time so the unique index is case-insensitive
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email'],
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: GLOBAL_ROLES, default: 'member', index: true },
    // Analytics attributes (dimension columns in dim_user)
    title: { type: String, trim: true, maxlength: 80 },
    department: { type: String, trim: true, maxlength: 60 },
    timezone: { type: String, default: 'Asia/Kolkata' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ email: 1 }, { unique: true });

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, 10);

userSchema.methods.toJSON = function toJSON() {
  const { _id, name, email, role, title, department, timezone, isActive, createdAt } = this;
  return { id: _id, name, email, role, title, department, timezone, isActive, createdAt };
};

export const User = mongoose.model('User', userSchema);
