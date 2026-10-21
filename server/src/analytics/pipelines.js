/**
 * Analytics aggregation pipelines.
 *
 * Every function is PURE: it takes a filter and returns a pipeline array. That
 * keeps them unit-testable (tests/pipelines.test.js runs them against seeded
 * data with an in-process engine) and lets the controller, the snapshot job
 * and ad-hoc scripts share one definition.
 *
 * Conventions
 *   - `teamIds`  ObjectId[] the caller is allowed to see (RBAC applied upstream)
 *   - `from/to`  Date range, half-open [from, to)
 *   - `tz`       IANA zone for calendar bucketing (days/weeks are local)
 *   - durations are reported in HOURS, rounded to 1 dp
 */

import { OPEN_STATUSES, PRIORITY_WEIGHT } from '../models/constants.js';

const HOUR_MS = 3_600_000;
const hoursBetween = (start, end) => ({ $round: [{ $divide: [{ $subtract: [end, start] }, HOUR_MS] }, 1] });
const inRange = (field, from, to) => ({ [field]: { $gte: from, $lt: to } });
const teamMatch = (teamIds) => ({ teamId: { $in: teamIds } });

/**
 * Percentiles without $percentile (keeps us compatible with MongoDB < 7 and
 * with the test engine): sort, push into an array, index into it.
 * Nearest-rank method: index = ceil(p * n) - 1.
 */
const pct = (arrayField, p) => ({
  $arrayElemAt: [
    arrayField,
    { $max: [0, { $subtract: [{ $ceil: { $multiply: [p, { $size: arrayField }] } }, 1] }] },
  ],
});

const priorityWeightExpr = {
  $switch: {
    branches: Object.entries(PRIORITY_WEIGHT).map(([k, w]) => ({ case: { $eq: ['$priority', k] }, then: w })),
    default: 1,
  },
};

// ---------------------------------------------------------------------------
// tasks collection
// ---------------------------------------------------------------------------

/** KPI tiles: counts by status, open/overdue, throughput and cycle-time in range. */
export function summary({ teamIds, from, to, now = new Date() }) {
  return [
    { $match: { ...teamMatch(teamIds), deletedAt: null } },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
        totals: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              open: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
              overdue: {
                $sum: {
                  $cond: [{ $and: [{ $in: ['$status', OPEN_STATUSES] }, { $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] }, 1, 0],
                },
              },
              unassignedOpen: {
                $sum: { $cond: [{ $and: [{ $in: ['$status', OPEN_STATUSES] }, { $eq: ['$assigneeId', null] }] }, 1, 0] },
              },
              createdInRange: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', from] }, { $lt: ['$createdAt', to] }] }, 1, 0] } },
            },
          },
          { $project: { _id: 0 } },
        ],
        completed: [
          { $match: { ...inRange('completedAt', from, to), status: 'done' } },
          {
            $project: {
              leadHours: hoursBetween('$createdAt', '$completedAt'),
              cycleHours: { $cond: [{ $ne: ['$startedAt', null] }, hoursBetween('$startedAt', '$completedAt'), null] },
              onTime: { $cond: [{ $eq: ['$dueDate', null] }, null, { $lte: ['$completedAt', '$dueDate'] }] },
            },
          },
          { $sort: { cycleHours: 1 } },
          {
            $group: {
              _id: null,
              completedInRange: { $sum: 1 },
              avgLeadHours: { $avg: '$leadHours' },
              avgCycleHours: { $avg: '$cycleHours' },
              cycle: { $push: '$cycleHours' },
              withDue: { $sum: { $cond: [{ $ne: ['$onTime', null] }, 1, 0] } },
              onTime: { $sum: { $cond: [{ $eq: ['$onTime', true] }, 1, 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              completedInRange: 1,
              avgLeadHours: { $round: ['$avgLeadHours', 1] },
              avgCycleHours: { $round: ['$avgCycleHours', 1] },
              medianCycleHours: pct({ $filter: { input: '$cycle', cond: { $ne: ['$$this', null] } } }, 0.5),
              onTimeRate: { $cond: [{ $gt: ['$withDue', 0] }, { $round: [{ $divide: ['$onTime', '$withDue'] }, 3] }, null] },
            },
          },
        ],
      },
    },
    {
      $project: {
        byStatus: 1,
        kpis: { $mergeObjects: [{ $arrayElemAt: ['$totals', 0] }, { $arrayElemAt: ['$completed', 0] }] },
      },
    },
  ];
}

/** Weekly created vs completed (arrival vs throughput). */
export function throughputByWeek({ teamIds, from, to, tz }) {
  const week = (field) => ({ $dateTrunc: { date: field, unit: 'week', timezone: tz, startOfWeek: 'monday' } });
  return [
    { $match: { ...teamMatch(teamIds), deletedAt: null, $or: [inRange('createdAt', from, to), inRange('completedAt', from, to)] } },
    {
      $project: {
        events: {
          $concatArrays: [
            { $cond: [{ $and: [{ $gte: ['$createdAt', from] }, { $lt: ['$createdAt', to] }] }, [{ k: 'created', week: week('$createdAt') }], []] },
            {
              $cond: [
                { $and: [{ $ne: ['$completedAt', null] }, { $gte: ['$completedAt', from] }, { $lt: ['$completedAt', to] }] },
                [{ k: 'completed', week: week('$completedAt') }],
                [],
              ],
            },
          ],
        },
      },
    },
    { $unwind: '$events' },
    {
      $group: {
        _id: '$events.week',
        created: { $sum: { $cond: [{ $eq: ['$events.k', 'created'] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$events.k', 'completed'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, week: '$_id', created: 1, completed: 1, net: { $subtract: ['$created', '$completed'] } } },
  ];
}

/** Cycle-time distribution (p50 / p85 / p95) per priority — "do urgent tasks actually move faster?" */
export function cycleTimeByPriority({ teamIds, from, to }) {
  return [
    { $match: { ...teamMatch(teamIds), deletedAt: null, status: 'done', startedAt: { $ne: null }, ...inRange('completedAt', from, to) } },
    { $project: { priority: 1, cycleHours: hoursBetween('$startedAt', '$completedAt') } },
    { $sort: { cycleHours: 1 } },
    { $group: { _id: '$priority', n: { $sum: 1 }, avg: { $avg: '$cycleHours' }, values: { $push: '$cycleHours' } } },
    {
      $project: {
        _id: 0,
        priority: '$_id',
        n: 1,
        avgHours: { $round: ['$avg', 1] },
        p50Hours: pct('$values', 0.5),
        p85Hours: pct('$values', 0.85),
        p95Hours: pct('$values', 0.95),
      },
    },
    { $addFields: { order: { $indexOfArray: [['urgent', 'high', 'medium', 'low'], '$priority'] } } },
    { $sort: { order: 1 } },
    { $project: { order: 0 } },
  ];
}

/** Open-work load per assignee, joined to users for names. */
export function workloadByAssignee({ teamIds, now = new Date() }) {
  return [
    { $match: { ...teamMatch(teamIds), deletedAt: null, status: { $in: OPEN_STATUSES } } },
    {
      $group: {
        _id: '$assigneeId',
        open: { $sum: 1 },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
        blocked: { $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] } },
        overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] }, 1, 0] } },
        weightedLoad: { $sum: priorityWeightExpr },
        estimateHours: { $sum: { $ifNull: ['$estimateHours', 0] } },
      },
    },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    {
      $project: {
        _id: 0,
        assigneeId: '$_id',
        name: { $ifNull: [{ $arrayElemAt: ['$user.name', 0] }, 'Unassigned'] },
        title: { $arrayElemAt: ['$user.title', 0] },
        open: 1,
        inProgress: 1,
        blocked: 1,
        overdue: 1,
        weightedLoad: 1,
        estimateHours: 1,
      },
    },
    { $sort: { weightedLoad: -1 } },
  ];
}

/** On-time delivery by priority for tasks that had a due date. */
export function slaByPriority({ teamIds, from, to }) {
  return [
    { $match: { ...teamMatch(teamIds), deletedAt: null, status: 'done', dueDate: { $ne: null }, ...inRange('completedAt', from, to) } },
    { $project: { priority: 1, lateHours: { $max: [0, hoursBetween('$dueDate', '$completedAt')] } } },
    {
      $group: {
        _id: '$priority',
        n: { $sum: 1 },
        late: { $sum: { $cond: [{ $gt: ['$lateHours', 0] }, 1, 0] } },
        avgLateHours: { $avg: { $cond: [{ $gt: ['$lateHours', 0] }, '$lateHours', null] } },
      },
    },
    {
      $project: {
        _id: 0,
        priority: '$_id',
        n: 1,
        late: 1,
        breachRate: { $round: [{ $divide: ['$late', '$n'] }, 3] },
        avgLateHours: { $round: ['$avgLateHours', 1] },
      },
    },
    { $sort: { breachRate: -1 } },
  ];
}

/** Cross-team scorecard for managers/admins. */
export function teamScorecard({ teamIds, from, to, now = new Date() }) {
  return [
    { $match: { ...teamMatch(teamIds), deletedAt: null } },
    {
      $group: {
        _id: '$teamId',
        open: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
        overdue: {
          $sum: { $cond: [{ $and: [{ $in: ['$status', OPEN_STATUSES] }, { $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] }, 1, 0] },
        },
        completed: { $sum: { $cond: [{ $and: [{ $gte: ['$completedAt', from] }, { $lt: ['$completedAt', to] }] }, 1, 0] } },
        avgCycleHours: {
          $avg: {
            $cond: [
              { $and: [{ $gte: ['$completedAt', from] }, { $lt: ['$completedAt', to] }, { $ne: ['$startedAt', null] }] },
              hoursBetween('$startedAt', '$completedAt'),
              null,
            ],
          },
        },
        reopened: { $sum: { $cond: [{ $gt: ['$reopenCount', 0] }, 1, 0] } },
      },
    },
    { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
    { $unwind: '$team' },
    {
      $project: {
        _id: 0,
        teamId: '$_id',
        team: '$team.name',
        key: '$team.key',
        open: 1,
        overdue: 1,
        completed: 1,
        avgCycleHours: { $round: ['$avgCycleHours', 1] },
        overdueRate: { $cond: [{ $gt: ['$open', 0] }, { $round: [{ $divide: ['$overdue', '$open'] }, 3] }, 0] },
        reopened: 1,
      },
    },
    { $sort: { completed: -1 } },
  ];
}

// ---------------------------------------------------------------------------
// task_events collection (event log)
// ---------------------------------------------------------------------------

/**
 * Time-in-status using window functions.
 * Each status-entering event (created / status_changed) opens an interval;
 * $shift pulls the NEXT event's timestamp within the same task, which closes
 * it. Open intervals are closed at `now`. This is the MongoDB equivalent of
 * SQL `LEAD(at) OVER (PARTITION BY task_id ORDER BY at)`.
 */
export function timeInStatus({ teamIds, from, to, now = new Date() }) {
  return [
    { $match: { ...teamMatch(teamIds), type: { $in: ['created', 'status_changed'] }, at: { $lt: to } } },
    {
      $setWindowFields: {
        partitionBy: '$taskId',
        sortBy: { at: 1 },
        output: { nextAt: { $shift: { output: '$at', by: 1, default: null } } },
      },
    },
    { $match: { at: { $gte: from }, toStatus: { $ne: 'done' } } },
    { $project: { status: '$toStatus', hours: hoursBetween('$at', { $ifNull: ['$nextAt', now] }) } },
    { $sort: { hours: 1 } },
    { $group: { _id: '$status', intervals: { $sum: 1 }, avg: { $avg: '$hours' }, total: { $sum: '$hours' }, values: { $push: '$hours' } } },
    {
      $project: {
        _id: 0,
        status: '$_id',
        intervals: 1,
        avgHours: { $round: ['$avg', 1] },
        medianHours: pct('$values', 0.5),
        p85Hours: pct('$values', 0.85),
        totalHours: { $round: ['$total', 0] },
      },
    },
    { $addFields: { order: { $indexOfArray: [['todo', 'in_progress', 'in_review', 'blocked'], '$status'] } } },
    { $sort: { order: 1 } },
    { $project: { order: 0 } },
  ];
}

/** Rework signals: review bounce-backs and reopened-after-done, per team. */
export function reworkByTeam({ teamIds, from, to }) {
  return [
    { $match: { ...teamMatch(teamIds), type: 'status_changed', ...inRange('at', from, to) } },
    {
      $group: {
        _id: '$teamId',
        toDone: { $sum: { $cond: [{ $eq: ['$toStatus', 'done'] }, 1, 0] } },
        reopened: { $sum: { $cond: [{ $eq: ['$fromStatus', 'done'] }, 1, 0] } },
        reviewBounces: { $sum: { $cond: [{ $and: [{ $eq: ['$fromStatus', 'in_review'] }, { $eq: ['$toStatus', 'in_progress'] }] }, 1, 0] } },
        reviewsPassed: { $sum: { $cond: [{ $and: [{ $eq: ['$fromStatus', 'in_review'] }, { $eq: ['$toStatus', 'done'] }] }, 1, 0] } },
        blockedEntries: { $sum: { $cond: [{ $eq: ['$toStatus', 'blocked'] }, 1, 0] } },
      },
    },
    { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
    {
      $project: {
        _id: 0,
        teamId: '$_id',
        team: { $arrayElemAt: ['$team.name', 0] },
        toDone: 1,
        reopened: 1,
        reviewBounces: 1,
        blockedEntries: 1,
        reopenRate: { $cond: [{ $gt: ['$toDone', 0] }, { $round: [{ $divide: ['$reopened', '$toDone'] }, 3] }, 0] },
        firstPassReviewRate: {
          $cond: [
            { $gt: [{ $add: ['$reviewsPassed', '$reviewBounces'] }, 0] },
            { $round: [{ $divide: ['$reviewsPassed', { $add: ['$reviewsPassed', '$reviewBounces'] }] }, 3] },
            null,
          ],
        },
      },
    },
    { $sort: { reopenRate: -1 } },
  ];
}

/**
 * Cumulative-flow / WIP over time. Each event contributes a delta to the
 * open-work count (created +1, ->done -1, done-> +1); a running $sum window
 * over ALL history gives the true WIP on each day, then we trim to the range.
 */
export function wipOverTime({ teamIds, from, to, tz }) {
  return [
    { $match: { ...teamMatch(teamIds), at: { $lt: to }, $or: [{ type: 'created' }, { type: 'status_changed', $or: [{ toStatus: 'done' }, { fromStatus: 'done' }] }] } },
    {
      $project: {
        day: { $dateTrunc: { date: '$at', unit: 'day', timezone: tz } },
        delta: {
          $switch: {
            branches: [
              { case: { $eq: ['$type', 'created'] }, then: 1 },
              { case: { $eq: ['$toStatus', 'done'] }, then: -1 },
              { case: { $eq: ['$fromStatus', 'done'] }, then: 1 },
            ],
            default: 0,
          },
        },
        created: { $cond: [{ $eq: ['$type', 'created'] }, 1, 0] },
        completed: { $cond: [{ $eq: ['$toStatus', 'done'] }, 1, 0] },
      },
    },
    { $group: { _id: '$day', delta: { $sum: '$delta' }, created: { $sum: '$created' }, completed: { $sum: '$completed' } } },
    {
      $setWindowFields: {
        sortBy: { _id: 1 },
        output: {
          wip: { $sum: '$delta', window: { documents: ['unbounded', 'current'] } },
          completed7d: { $sum: '$completed', window: { documents: [-6, 'current'] } },
        },
      },
    },
    { $match: { _id: { $gte: from } } },
    { $project: { _id: 0, day: '$_id', created: 1, completed: 1, wip: 1, completed7d: 1 } },
  ];
}

/** Activity heatmap: events by local weekday x hour. */
export function activityHeatmap({ teamIds, from, to, tz }) {
  return [
    { $match: { ...teamMatch(teamIds), ...inRange('at', from, to) } },
    {
      $group: {
        _id: { dow: { $isoDayOfWeek: { date: '$at', timezone: tz } }, hour: { $hour: { date: '$at', timezone: tz } } },
        events: { $sum: 1 },
      },
    },
    { $project: { _id: 0, dow: '$_id.dow', hour: '$_id.hour', events: 1 } },
    { $sort: { dow: 1, hour: 1 } },
  ];
}

/**
 * Periodic snapshot job: one row per team per local day, upserted with $merge.
 * Idempotent, so it can be re-run for any window (backfill or nightly).
 */
export function dailyTeamSnapshot({ from, to, tz, teamIds, merge = true }) {
  const pipeline = [
    { $match: { ...inRange('at', from, to), ...(teamIds ? teamMatch(teamIds) : {}) } },
    {
      $group: {
        _id: { teamId: '$teamId', day: { $dateTrunc: { date: '$at', unit: 'day', timezone: tz } } },
        created: { $sum: { $cond: [{ $eq: ['$type', 'created'] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$toStatus', 'done'] }, 1, 0] } },
        reopened: { $sum: { $cond: [{ $eq: ['$fromStatus', 'done'] }, 1, 0] } },
        statusChanges: { $sum: { $cond: [{ $eq: ['$type', 'status_changed'] }, 1, 0] } },
        actors: { $addToSet: '$actorId' },
      },
    },
    {
      $project: {
        _id: 0,
        teamId: '$_id.teamId',
        day: '$_id.day',
        created: 1,
        completed: 1,
        reopened: 1,
        statusChanges: 1,
        activeUsers: { $size: '$actors' },
        computedAt: '$$NOW',
      },
    },
  ];
  if (merge) {
    pipeline.push({ $merge: { into: 'daily_team_stats', on: ['teamId', 'day'], whenMatched: 'replace', whenNotMatched: 'insert' } });
  }
  return pipeline;
}
