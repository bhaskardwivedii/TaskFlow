/**
 * Seed the database with ~6 months of realistic, internally consistent data.
 *
 *   npm run seed                 # wipes and reseeds (refuses in production unless --force)
 *   npm run seed -- --seed=7 --days=365
 *
 * All demo users share the password "Password@123".
 *   admin@taskflow.dev    (admin)    manager@taskflow.dev  (manager)
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import * as models from '../src/models/index.js';
import { generateDataset } from '../src/seed/generator.js';
import { dailyTeamSnapshot } from '../src/analytics/pipelines.js';
import { applyValidators } from './apply-validators.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));

if (env.isProd && !args.force) {
  console.error('Refusing to wipe a production database. Re-run with --force if you really mean it.');
  process.exit(1);
}

await connectDB();
const db = mongoose.connection.db;

console.time('seed');
const passwordHash = await bcrypt.hash('Password@123', 10);
const data = generateDataset({ seed: Number(args.seed ?? 42), days: Number(args.days ?? 180), passwordHash });

// Clean slate, then let Mongoose build every declared index.
await db.dropDatabase();
for (const m of Object.values(models)) {
  if (m?.prototype instanceof mongoose.Model) await m.createCollection();
}
await applyValidators(db);
for (const m of Object.values(models)) {
  if (m?.prototype instanceof mongoose.Model) await m.syncIndexes();
}

// Bulk insert through the driver (bypasses per-doc middleware; the generator
// already produces schema-valid documents and the $jsonSchema validators
// still check every insert at the database level).
const insert = async (name, docs) => {
  for (let i = 0; i < docs.length; i += 5000) await db.collection(name).insertMany(docs.slice(i, i + 5000), { ordered: false });
  console.log(`  ${name.padEnd(16)} ${docs.length}`);
};
await insert('users', data.users);
await insert('teams', data.teams);
await insert('projects', data.projects);
await insert('tasks', data.tasks);
await insert('task_events', data.events);
await insert('comments', data.comments);
await insert('notifications', data.notifications);

// Build the daily snapshot fact table from the event log.
const from = new Date(Math.min(...data.tasks.map((t) => t.createdAt.getTime())));
await models.TaskEvent.aggregate(dailyTeamSnapshot({ from, to: new Date(), tz: env.analyticsTz }));
console.log(`  daily_team_stats ${await models.DailyTeamStat.countDocuments()}`);

console.timeEnd('seed');
console.log('\nLogin: admin@taskflow.dev / Password@123  (also manager@taskflow.dev, or any team member)');
const lead = data.users.find((u) => data.teams[0].members[0].userId.equals(u._id));
console.log(`Team lead example: ${lead.email} / Password@123`);
await disconnectDB();
