import { z } from 'zod';
import mongoose from 'mongoose';
import { Task, TaskEvent, Team, DailyTeamStat } from '../models/index.js';
import * as P from '../analytics/pipelines.js';
import { env } from '../config/env.js';
import { forbidden } from '../utils/http.js';

export const rangeQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
  teamId: z.string().refine((v) => mongoose.isValidObjectId(v)).optional(),
});

/**
 * Which teams may this user analyse?
 *   admin / manager -> every team (optionally narrowed by ?teamId)
 *   team lead       -> teams they lead
 *   others          -> 403
 */
async function scope(req) {
  const { teamId } = req.validatedQuery;
  let ids;
  if (req.user.role === 'admin' || req.user.role === 'manager') {
    ids = teamId ? [new mongoose.Types.ObjectId(teamId)] : (await Team.find({}, { _id: 1 }).lean()).map((t) => t._id);
  } else {
    const led = await Team.find({ members: { $elemMatch: { userId: req.user._id, role: 'lead' } } }, { _id: 1 }).lean();
    ids = led.map((t) => t._id).filter((id) => !teamId || id.equals(teamId));
  }
  if (!ids.length) throw forbidden('Analytics are available to team leads, managers and admins');
  const to = new Date();
  const from = new Date(to.getTime() - req.validatedQuery.days * 864e5);
  return { teamIds: ids, from, to, now: to, tz: env.analyticsTz };
}

/** One round trip for the dashboard: all widgets computed in parallel. */
export async function dashboard(req, res) {
  const s = await scope(req);
  const [summary, throughput, cycleTime, timeInStatus, workload, rework, wip, heatmap, sla, scorecard] = await Promise.all([
    Task.aggregate(P.summary(s)),
    Task.aggregate(P.throughputByWeek(s)),
    Task.aggregate(P.cycleTimeByPriority(s)),
    TaskEvent.aggregate(P.timeInStatus(s)).allowDiskUse(true),
    Task.aggregate(P.workloadByAssignee(s)),
    TaskEvent.aggregate(P.reworkByTeam(s)),
    TaskEvent.aggregate(P.wipOverTime(s)).allowDiskUse(true),
    TaskEvent.aggregate(P.activityHeatmap(s)),
    Task.aggregate(P.slaByPriority(s)),
    Task.aggregate(P.teamScorecard(s)),
  ]);
  res.json({
    range: { from: s.from, to: s.to, tz: s.tz },
    summary: summary[0],
    throughput,
    cycleTime,
    timeInStatus,
    workload,
    rework,
    wip,
    heatmap,
    sla,
    scorecard,
  });
}

/** Explain a pipeline's query plan — handy for showing index usage in an interview. */
export async function explain(req, res) {
  if (req.user.role !== 'admin') throw forbidden();
  const s = await scope(req);
  const plan = await Task.aggregate(P.throughputByWeek(s)).explain('executionStats');
  res.json(plan);
}

/** Recompute daily_team_stats for the range (idempotent $merge). */
export async function refreshSnapshots(req, res) {
  const s = await scope(req);
  await TaskEvent.aggregate(P.dailyTeamSnapshot(s));
  const rows = await DailyTeamStat.countDocuments({ teamId: { $in: s.teamIds }, day: { $gte: s.from } });
  res.json({ ok: true, rows });
}

export async function dailyStats(req, res) {
  const s = await scope(req);
  const rows = await DailyTeamStat.find({ teamId: { $in: s.teamIds }, day: { $gte: s.from } }).sort({ day: 1 }).lean();
  res.json({ rows });
}
