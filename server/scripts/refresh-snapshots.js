/**
 * Recompute daily_team_stats for the last N days (default 3) via $merge.
 * Idempotent: schedule it nightly (Render cron job, GitHub Actions, Atlas trigger).
 *
 *   npm run snapshot -- --days=30
 */
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { TaskEvent, DailyTeamStat } from '../src/models/index.js';
import { dailyTeamSnapshot } from '../src/analytics/pipelines.js';

const days = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 3);
await connectDB();
const to = new Date();
const from = new Date(to.getTime() - days * 864e5);
await TaskEvent.aggregate(dailyTeamSnapshot({ from, to, tz: env.analyticsTz }));
console.log(`daily_team_stats refreshed for ${days} day(s); total rows: ${await DailyTeamStat.countDocuments()}`);
await disconnectDB();
