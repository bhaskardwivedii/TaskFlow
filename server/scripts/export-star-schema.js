/**
 * Export the operational database as a star schema of CSV files for SQL / BI.
 *
 *   npm run export                       # from MongoDB -> ../analytics/data/*.csv
 *   npm run export -- --generated        # no DB needed: export the synthetic dataset directly
 *   npm run export -- --out=/some/dir
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toStarSchema, toCsv } from '../src/analytics/starSchema.js';
import { generateDataset } from '../src/seed/generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}`))?.split('=')[1] ?? (process.argv.includes(`--${name}`) ? true : undefined);
const outDir = path.resolve(arg('out') ?? path.join(__dirname, '../../analytics/data'));
const tz = process.env.ANALYTICS_TZ ?? 'Asia/Kolkata';

let data;
if (arg('generated')) {
  data = generateDataset({ seed: Number(arg('seed') ?? 42), now: arg('now') ? new Date(arg('now')) : new Date() });
} else {
  const { connectDB, disconnectDB } = await import('../src/config/db.js');
  const m = await import('../src/models/index.js');
  await connectDB();
  const [users, teams, projects, tasks, events] = await Promise.all([
    m.User.find().lean(),
    m.Team.find().lean(),
    m.Project.find().lean(),
    m.Task.find().lean(),
    m.TaskEvent.find().sort({ at: 1 }).lean(),
  ]);
  data = { users, teams, projects, tasks, events };
  await disconnectDB();
}

const tables = toStarSchema(data, { now: new Date(), tz });
await fs.mkdir(outDir, { recursive: true });
for (const [name, rows] of Object.entries(tables)) {
  await fs.writeFile(path.join(outDir, `${name}.csv`), toCsv(rows));
  console.log(`  ${name.padEnd(22)} ${String(rows.length).padStart(6)} rows`);
}
console.log(`\nWrote ${Object.keys(tables).length} tables to ${outDir}`);
