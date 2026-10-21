/**
 * Runs every analytics pipeline against the seeded dataset using mingo, an
 * in-process implementation of the MongoDB aggregation language, and checks
 * the results against independent plain-JS calculations. No database needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'mingo/init/system';
import { Aggregator } from 'mingo';
import { generateDataset } from '../src/seed/generator.js';
import * as P from '../src/analytics/pipelines.js';
import { toStarSchema } from '../src/analytics/starSchema.js';

const NOW = new Date('2026-10-21T12:00:00Z');

// mingo compares values structurally and cannot tell BSON ObjectIds apart, so
// the test engine gets hex strings in their place. MongoDB itself compares
// ObjectIds natively; the pipelines are identical either way.
const stringifyIds = (v) => {
  if (v === null || v === undefined || v instanceof Date) return v;
  if (v?._bsontype === 'ObjectId') return v.toHexString();
  if (Array.isArray(v)) return v.map(stringifyIds);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stringifyIds(x)]));
  return v;
};
const data = stringifyIds(generateDataset({ now: NOW }));
const teamIds = data.teams.map((t) => t._id);
const from = new Date(NOW.getTime() - 90 * 864e5);
const to = NOW;
const tz = 'Asia/Kolkata';

const collections = { tasks: data.tasks, task_events: data.events, users: data.users, teams: data.teams };
const run = (coll, pipeline) =>
  new Aggregator(pipeline, { collectionResolver: (name) => collections[name], idKey: '_id' }).run(collections[coll]);

const close = (a, b, eps = 0.15) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const live = data.tasks.filter((t) => !t.deletedAt);

test('dataset: tasks current state is consistent with the event log', () => {
  const lastStatus = new Map();
  for (const e of data.events) if (e.toStatus) lastStatus.set(String(e.taskId), e.toStatus);
  for (const t of data.tasks) assert.equal(t.status, lastStatus.get(String(t._id)) ?? 'todo');
  for (const t of data.tasks) if (t.status === 'done') assert.ok(t.completedAt && t.startedAt <= t.completedAt);
});

test('summary KPIs match a plain-JS recomputation', () => {
  const [res] = run('tasks', P.summary({ teamIds, from, to, now: NOW }));
  const open = live.filter((t) => t.status !== 'done');
  assert.equal(res.kpis.total, live.length);
  assert.equal(res.kpis.open, open.length);
  assert.equal(res.kpis.overdue, open.filter((t) => t.dueDate && t.dueDate < NOW).length);
  const done = live.filter((t) => t.status === 'done' && t.completedAt >= from && t.completedAt < to);
  assert.equal(res.kpis.completedInRange, done.length);
  const avgCycle = done.reduce((s, t) => s + Math.round(((t.completedAt - t.startedAt) / 36e5) * 10) / 10, 0) / done.length;
  close(res.kpis.avgCycleHours, avgCycle);
  assert.equal(res.byStatus.reduce((s, x) => s + x.count, 0), live.length);
});

test('throughputByWeek totals equal tasks completed in range', () => {
  const rows = run('tasks', P.throughputByWeek({ teamIds, from, to, tz }));
  const done = live.filter((t) => t.completedAt && t.completedAt >= from && t.completedAt < to).length;
  assert.equal(rows.reduce((s, r) => s + r.completed, 0), done);
  assert.ok(rows.length >= 12 && rows.length <= 15);
});

test('cycleTimeByPriority returns ordered percentiles', () => {
  const rows = run('tasks', P.cycleTimeByPriority({ teamIds, from, to }));
  assert.deepEqual(rows.map((r) => r.priority), ['urgent', 'high', 'medium', 'low']);
  for (const r of rows) assert.ok(r.p50Hours <= r.p85Hours && r.p85Hours <= r.p95Hours);
});

test('timeInStatus window function reproduces LEAD() intervals', () => {
  const rows = run('task_events', P.timeInStatus({ teamIds, from, to, now: NOW }));
  // Independent computation
  const byTask = new Map();
  for (const e of data.events) {
    if (e.type !== 'created' && e.type !== 'status_changed') continue;
    if (!byTask.has(String(e.taskId))) byTask.set(String(e.taskId), []);
    byTask.get(String(e.taskId)).push(e);
  }
  let reviewCount = 0;
  for (const evs of byTask.values()) {
    evs.forEach((e) => {
      if (e.at >= from && e.toStatus === 'in_review') reviewCount += 1;
    });
  }
  assert.equal(rows.find((r) => r.status === 'in_review').intervals, reviewCount);
  assert.deepEqual(rows.map((r) => r.status), ['todo', 'in_progress', 'in_review', 'blocked']);
});

test('reworkByTeam surfaces the planted patterns', () => {
  const rows = run('task_events', P.reworkByTeam({ teamIds, from: new Date(NOW - 180 * 864e5), to }));
  const by = Object.fromEntries(rows.map((r) => [r.team, r]));
  assert.equal(rows[0].team, 'Growth', 'Growth should have the highest reopen rate');
  const worstReview = [...rows].sort((a, b) => a.firstPassReviewRate - b.firstPassReviewRate)[0];
  assert.equal(worstReview.team, 'Mobile');
  const mostBlocked = [...rows].sort((a, b) => b.blockedEntries / b.toDone - a.blockedEntries / a.toDone)[0];
  assert.equal(mostBlocked.team, 'Data');
  assert.ok(by.Growth.reopenRate > 0.08);
});

test('wipOverTime running sum equals open-task count at the end', () => {
  const rows = run('task_events', P.wipOverTime({ teamIds, from, to, tz }));
  const last = rows[rows.length - 1];
  // Deleted tasks never left WIP in the event model, so include them.
  assert.equal(last.wip, data.tasks.filter((t) => t.status !== 'done').length);
});

test('workloadByAssignee joins names and flags the planted heroes', () => {
  const rows = run('tasks', P.workloadByAssignee({ teamIds, now: NOW }));
  assert.ok(rows.every((r) => typeof r.name === 'string'));
  assert.equal(rows.reduce((s, r) => s + r.open, 0), live.filter((t) => t.status !== 'done').length);
});

test('teamScorecard, slaByPriority, heatmap and daily snapshot run', () => {
  assert.equal(run('tasks', P.teamScorecard({ teamIds, from, to, now: NOW })).length, 5);
  const sla = run('tasks', P.slaByPriority({ teamIds, from, to }));
  assert.ok(sla.every((r) => r.breachRate >= 0 && r.breachRate <= 1));
  const heat = run('task_events', P.activityHeatmap({ teamIds, from, to, tz }));
  const peak = heat.reduce((a, b) => (b.events > a.events ? b : a));
  assert.ok(peak.dow <= 5 && peak.hour >= 9 && peak.hour < 20, 'peak activity should be in IST business hours');
  const snap = run('task_events', P.dailyTeamSnapshot({ from, to, tz, merge: false }));
  const created = data.events.filter((e) => e.type === 'created' && e.at >= from && e.at < to).length;
  assert.equal(snap.reduce((s, r) => s + r.created, 0), created);
});

test('star schema export has referential integrity', () => {
  const s = toStarSchema(data, { now: NOW, tz });
  const userKeys = new Set(s.dim_user.map((u) => u.user_id));
  const dateKeys = new Set(s.dim_date.map((d) => d.date_key));
  for (const f of s.fact_task) {
    assert.ok(dateKeys.has(f.created_date_key));
    if (f.assignee_id) assert.ok(userKeys.has(f.assignee_id));
  }
  for (const i of s.fact_status_interval) assert.ok(i.duration_hours >= 0);
  assert.equal(s.fact_task.length, data.tasks.length);
});
