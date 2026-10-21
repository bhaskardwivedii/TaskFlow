/**
 * Deterministic synthetic-data generator.
 *
 * Simulates ~6 months of a 5-team engineering org: task arrivals, a status
 * state machine with realistic (log-normal) durations, review bounce-backs,
 * blockers, reopens, reassignments and comments. Every change is emitted as a
 * task_events row, and the tasks' current state is derived FROM those events,
 * so the two collections are consistent by construction.
 *
 * Patterns are planted on purpose so the analytics have stories to find:
 *   - Mobile has a high review bounce rate (quality issue in review)
 *   - Data gets blocked far more often (external dependencies)
 *   - Growth ships fast but reopens more (speed vs quality trade-off)
 *   - A couple of "hero" engineers receive a disproportionate share of work
 *   - Urgent work starts sooner but is not always finished sooner
 *   - Work created on Fridays waits longer before it starts
 *
 * Pure function: same seed -> same dataset. No DB access.
 */

import mongoose from 'mongoose';

const { ObjectId } = mongoose.Types;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IST_OFFSET = 5.5 * HOUR; // business hours are simulated in IST

// ---------- seeded RNG helpers ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const r = mulberry32(seed);
  const api = {
    next: r,
    int: (min, max) => Math.floor(r() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    weighted(items) {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let x = r() * total;
      for (const [v, w] of items) {
        if ((x -= w) <= 0) return v;
      }
      return items[items.length - 1][0];
    },
    normal() {
      let u = 0;
      while (u === 0) u = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
    },
    // log-normal with a given median (hours) and spread sigma
    lognormal: (median, sigma = 0.6) => median * Math.exp(sigma * api.normal()),
    poisson(lambda) {
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= r();
      } while (p > L);
      return k - 1;
    },
  };
  return api;
}

// ---------- calendar helpers (IST business time) ----------
const istHour = (t) => new Date(t + IST_OFFSET).getUTCHours();
const istDow = (t) => new Date(t + IST_OFFSET).getUTCDay(); // 0 Sun .. 6 Sat

/** Nudge a timestamp into plausible working time (most activity 9:00-20:00 IST, Mon-Fri). */
function toWorkTime(t, rng) {
  let ts = t;
  const h = istHour(ts);
  if (h < 9 || h >= 20) {
    if (!rng.chance(0.08)) {
      // move to next morning 9:00-11:59 IST
      const istMidnight = Math.floor((ts + IST_OFFSET) / DAY) * DAY - IST_OFFSET;
      const base = h >= 20 ? istMidnight + DAY : istMidnight;
      ts = base + (9 + rng.next() * 3) * HOUR;
    }
  }
  const dow = istDow(ts);
  if ((dow === 0 || dow === 6) && !rng.chance(0.07)) {
    ts += (dow === 6 ? 2 : 1) * DAY;
  }
  return ts;
}

// ---------- static org definition ----------
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ishaan', 'Kabir', 'Arjun', 'Rohan', 'Siddharth', 'Karan', 'Dev', 'Nikhil', 'Rahul', 'Yash', 'Pranav', 'Harsh', 'Ananya', 'Diya', 'Saanvi', 'Ishita', 'Kavya', 'Meera', 'Priya', 'Riya', 'Sneha', 'Tanvi', 'Neha', 'Pooja', 'Aditi', 'Shreya', 'Nandini', 'Simran', 'Avni', 'Kriti', 'Manya', 'Zoya', 'Farhan', 'Imran', 'Sara', 'Rehan', 'Tara'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Iyer', 'Nair', 'Reddy', 'Patel', 'Mehta', 'Joshi', 'Kapoor', 'Malhotra', 'Bansal', 'Chopra', 'Agarwal', 'Rao', 'Das', 'Khan', 'Mishra', 'Saxena'];

export const TEAM_DEFS = [
  { name: 'Platform', key: 'PLAT', dept: 'Engineering', size: 8, arrivals: 3.2, speed: 1.0, bounce: 0.18, blocked: 0.10, reopen: 0.05, projects: ['API Gateway v2', 'Auth & Billing', 'Observability'] },
  { name: 'Mobile', key: 'MOB', dept: 'Engineering', size: 7, arrivals: 2.6, speed: 1.15, bounce: 0.38, blocked: 0.08, reopen: 0.06, projects: ['Android App', 'iOS App'] },
  { name: 'Data', key: 'DATA', dept: 'Data', size: 6, arrivals: 2.0, speed: 1.25, bounce: 0.15, blocked: 0.32, reopen: 0.04, projects: ['Warehouse Migration', 'Experimentation Platform'] },
  { name: 'Growth', key: 'GRW', dept: 'Product', size: 7, arrivals: 3.0, speed: 0.7, bounce: 0.12, blocked: 0.06, reopen: 0.15, projects: ['Onboarding Funnel', 'Referral Program', 'Pricing Page'] },
  { name: 'Design', key: 'DSGN', dept: 'Design', size: 5, arrivals: 1.6, speed: 0.9, bounce: 0.22, blocked: 0.05, reopen: 0.05, projects: ['Design System', 'Brand Refresh'] },
];

const TITLES = {
  Engineering: ['Software Engineer', 'Senior Software Engineer', 'SDE II', 'Staff Engineer'],
  Data: ['Data Engineer', 'Analytics Engineer', 'Data Analyst'],
  Product: ['Product Engineer', 'Growth Engineer', 'Product Analyst'],
  Design: ['Product Designer', 'UX Researcher', 'Visual Designer'],
};

const VERBS = ['Implement', 'Fix', 'Refactor', 'Add', 'Investigate', 'Migrate', 'Optimize', 'Document', 'Design', 'Test', 'Remove', 'Update'];
const NOUNS = ['login flow', 'rate limiter', 'push notifications', 'checkout page', 'search indexing', 'CSV export', 'dashboard filters', 'onboarding emails', 'cache layer', 'error tracking', 'dark mode', 'payment webhook', 'retry logic', 'feature flags', 'A/B test framework', 'user settings', 'audit log', 'image upload', 'pagination', 'session timeout', 'SSO integration', 'pricing table', 'empty states', 'deep links', 'ETL job', 'data quality checks', 'icon set', 'referral rewards'];
const LABELS = ['bug', 'feature', 'tech-debt', 'security', 'performance', 'ux', 'infra', 'analytics', 'customer'];
const COMMENTS = ['Picked this up, will update by EOD.', 'Blocked on API contract — pinged the owner.', 'PR is up for review.', 'Left a few comments on the PR.', 'Can we split this into two tasks?', 'Repro steps added.', 'Deployed to staging, please verify.', 'Looks good to me 👍', 'Moving this back — edge case with empty input.', 'Need design sign-off before merging.', 'Added tests for the failure path.', 'Customer confirmed the fix works.'];

/**
 * @param {object} opts
 * @param {number} [opts.seed=42]
 * @param {number} [opts.days=180]     history length
 * @param {Date}   [opts.now]          simulation end
 * @param {string} [opts.passwordHash] bcrypt hash applied to every demo user
 */
export function generateDataset({ seed = 42, days = 180, now = new Date(), passwordHash = 'x' } = {}) {
  const rng = makeRng(seed);
  const NOW = now.getTime();
  const START = NOW - days * DAY;

  const users = [];
  const teams = [];
  const projects = [];
  const tasks = [];
  const events = [];
  const comments = [];
  const notifications = [];

  const usedNames = new Set();
  const mkUser = (role, dept, title) => {
    let name;
    do name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    while (usedNames.has(name));
    usedNames.add(name);
    const u = {
      _id: new ObjectId(),
      name,
      email: `${name.toLowerCase().replace(' ', '.')}@taskflow.dev`,
      passwordHash,
      role,
      title,
      department: dept,
      timezone: 'Asia/Kolkata',
      isActive: true,
      createdAt: new Date(START - rng.int(10, 400) * DAY),
      updatedAt: new Date(START),
    };
    users.push(u);
    return u;
  };

  // Fixed demo accounts first (stable logins for the README)
  const admin = mkUser('admin', 'Operations', 'Engineering Director');
  Object.assign(admin, { name: 'Demo Admin', email: 'admin@taskflow.dev' });
  const manager = mkUser('manager', 'Engineering', 'Engineering Manager');
  Object.assign(manager, { name: 'Demo Manager', email: 'manager@taskflow.dev' });
  const extraManager = mkUser('manager', 'Product', 'Product Manager');

  // Per-person traits: speed multiplier and "hero" share of assignments
  const traits = new Map();

  for (const def of TEAM_DEFS) {
    const members = [];
    for (let i = 0; i < def.size; i += 1) {
      const u = mkUser('member', def.dept, rng.pick(TITLES[def.dept]));
      members.push(u);
      traits.set(String(u._id), { speed: Math.exp(0.25 * rng.normal()), share: 1 });
    }
    // Plant heroes in Platform and Growth
    if (def.key === 'PLAT' || def.key === 'GRW') traits.get(String(members[1]._id)).share = 3.2;

    const team = {
      _id: new ObjectId(),
      name: def.name,
      key: def.key,
      description: `${def.name} team`,
      members: members.map((u, i) => ({ userId: u._id, role: i === 0 ? 'lead' : 'member', joinedAt: u.createdAt })),
      taskSeq: 0,
      createdBy: admin._id,
      createdAt: new Date(START - 60 * DAY),
      updatedAt: new Date(START),
      _def: def,
      _members: members,
    };
    team.members.push({ userId: manager._id, role: 'viewer', joinedAt: team.createdAt });
    if (def.dept === 'Product' || def.dept === 'Design') team.members.push({ userId: extraManager._id, role: 'viewer', joinedAt: team.createdAt });
    teams.push(team);

    def.projects.forEach((name, i) => {
      projects.push({
        _id: new ObjectId(),
        teamId: team._id,
        name,
        description: `${name} initiative`,
        status: i === 0 && def.key === 'DSGN' ? 'completed' : 'active',
        ownerId: members[0]._id,
        startDate: new Date(START - rng.int(0, 30) * DAY),
        targetDate: new Date(NOW + rng.int(15, 120) * DAY),
        color: rng.pick(['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#db2777', '#7c3aed']),
        createdAt: new Date(START - 30 * DAY),
        updatedAt: new Date(START),
      });
    });
  }

  const PRIORITY_MIX = [['low', 20], ['medium', 45], ['high', 25], ['urgent', 10]];
  const WAIT_MEDIAN_H = { urgent: 6, high: 40, medium: 110, low: 260 }; // queue time before start
  const ESTIMATES = [[1, 10], [2, 18], [3, 22], [5, 24], [8, 16], [13, 7], [21, 3]];

  for (const team of teams) {
    const def = team._def;
    const teamProjects = projects.filter((p) => p.teamId.equals(team._id));
    const memberWeights = team._members.map((u) => [u, traits.get(String(u._id)).share]);

    for (let day = 0; day < days; day += 1) {
      const dayStart = START + day * DAY;
      const dow = istDow(dayStart + 12 * HOUR);
      const weekendFactor = dow === 0 || dow === 6 ? 0.12 : 1;
      const growth = 0.8 + 0.4 * (day / days); // slight upward trend in demand
      const n = rng.poisson(def.arrivals * weekendFactor * growth);

      for (let k = 0; k < n; k += 1) {
        const created = toWorkTime(dayStart + rng.next() * DAY, rng);
        if (created >= NOW) continue;
        simulateTask({ team, def, created, teamProjects, memberWeights });
      }
    }
  }

  function emit(task, type, at, extra = {}) {
    if (at > NOW) return false;
    events.push({
      _id: new ObjectId(),
      taskId: task._id,
      teamId: task.teamId,
      projectId: task.projectId,
      actorId: extra.actorId ?? task.assigneeId ?? task.creatorId,
      type,
      fromStatus: extra.fromStatus ?? null,
      toStatus: extra.toStatus ?? null,
      fromAssigneeId: extra.fromAssigneeId ?? null,
      toAssigneeId: extra.toAssigneeId ?? null,
      fromValue: extra.fromValue ?? null,
      toValue: extra.toValue ?? null,
      priority: task.priority,
      assigneeId: task.assigneeId,
      at: new Date(at),
    });
    return true;
  }

  function simulateTask({ team, def, created, teamProjects, memberWeights }) {
    team.taskSeq += 1;
    const priority = rng.weighted(PRIORITY_MIX);
    const estimate = rng.weighted(ESTIMATES);
    const creator = rng.chance(0.6) ? team._members[0] : rng.pick(team._members);
    const assignNow = rng.chance(0.8);
    const assignee = rng.weighted(memberWeights);
    const hasDue = rng.chance(priority === 'low' ? 0.4 : 0.75);
    const dueDays = { urgent: 2, high: 5, medium: 9, low: 16 }[priority] + Math.ceil(estimate / 4);

    const task = {
      _id: new ObjectId(),
      teamId: team._id,
      projectId: rng.pick(teamProjects)._id,
      number: team.taskSeq,
      title: `${rng.pick(VERBS)} ${rng.pick(NOUNS)}`,
      description: '',
      status: 'todo',
      priority,
      labels: [...new Set([rng.pick(LABELS), ...(rng.chance(0.4) ? [rng.pick(LABELS)] : [])])],
      creatorId: creator._id,
      assigneeId: assignNow ? assignee._id : null,
      estimateHours: rng.chance(0.85) ? estimate : null,
      dueDate: hasDue ? new Date(created + dueDays * DAY) : null,
      position: team.taskSeq,
      startedAt: null,
      completedAt: null,
      reopenCount: 0,
      commentCount: 0,
      deletedAt: null,
      version: 0,
      createdAt: new Date(created),
      updatedAt: new Date(created),
    };
    tasks.push(task);
    emit(task, 'created', created, { actorId: creator._id, toStatus: 'todo' });
    if (task.assigneeId) emit(task, 'assigned', created, { actorId: creator._id, toAssigneeId: task.assigneeId });

    const person = () => traits.get(String(task.assigneeId ?? assignee._id));
    let t = created;
    let status = 'todo';
    const move = (to, at) => {
      if (!emit(task, 'status_changed', at, { fromStatus: status, toStatus: to })) return false;
      if (status === 'todo' && !task.startedAt) task.startedAt = new Date(at);
      if (to === 'done') task.completedAt = new Date(at);
      if (status === 'done' && to !== 'done') {
        task.completedAt = null;
        task.reopenCount += 1;
      }
      status = to;
      task.status = to;
      task.updatedAt = new Date(at);
      task.version += 1;
      return true;
    };
    const step = (hours) => {
      t = toWorkTime(t + Math.max(0.2, hours) * HOUR, rng);
      return t;
    };

    // Late assignment for the 20% created unassigned
    if (!task.assigneeId) {
      const at = step(rng.lognormal(10, 0.8));
      const prevAssignee = task.assigneeId;
      task.assigneeId = assignee._id;
      if (!emit(task, 'assigned', at, { actorId: team._members[0]._id, fromAssigneeId: prevAssignee, toAssigneeId: assignee._id })) {
        task.assigneeId = null;
        return;
      }
    }

    // ~7% never get picked up (stale backlog)
    if (rng.chance(0.07)) return finalize();

    // Queue wait (Friday-created work waits longer)
    const fridayPenalty = istDow(created) === 5 ? 1.8 : 1;
    if (!move('in_progress', step(rng.lognormal(WAIT_MEDIAN_H[priority] * fridayPenalty, 0.7)))) return finalize();

    // Occasional mid-flight priority escalation
    if (rng.chance(0.06) && priority !== 'urgent') {
      const at = step(rng.lognormal(6));
      const from = task.priority;
      task.priority = from === 'low' ? 'medium' : from === 'medium' ? 'high' : 'urgent';
      if (!emit(task, 'priority_changed', at, { fromValue: from, toValue: task.priority, actorId: team._members[0]._id })) return finalize();
    }

    // Occasional reassignment
    if (rng.chance(0.07)) {
      const next = rng.pick(team._members);
      if (!next._id.equals(task.assigneeId)) {
        const at = step(rng.lognormal(8));
        const from = task.assigneeId;
        task.assigneeId = next._id;
        if (!emit(task, 'assigned', at, { actorId: team._members[0]._id, fromAssigneeId: from, toAssigneeId: next._id })) return finalize();
      }
    }

    // Work -> (blocked) -> review loop -> done
    const workHours = () => rng.lognormal(estimate * 4.5 * def.speed * person().speed, 0.55);
    let rounds = 0;
    for (;;) {
      if (rng.chance(def.blocked)) {
        if (!move('blocked', step(workHours() * 0.4))) return finalize();
        if (!move('in_progress', step(rng.lognormal(30, 0.8)))) return finalize();
      }
      if (!move('in_review', step(workHours() * (rounds ? 0.35 : 1)))) return finalize();
      const reviewWait = step(rng.lognormal(20, 0.7));
      rounds += 1;
      if (rounds < 4 && rng.chance(def.bounce)) {
        if (!move('in_progress', reviewWait)) return finalize();
        continue;
      }
      if (!move('done', reviewWait)) return finalize();
      break;
    }

    // Reopen after done
    if (rng.chance(def.reopen)) {
      if (move('in_progress', step(rng.lognormal(60, 0.8)))) {
        if (move('in_review', step(workHours() * 0.4))) move('done', step(rng.lognormal(10, 0.6)));
      }
    }
    return finalize();

    function finalize() {
      // Comments sprinkled through the task's life
      const end = task.completedAt ? task.completedAt.getTime() : NOW;
      const nComments = rng.poisson(1.3);
      for (let i = 0; i < nComments; i += 1) {
        const at = toWorkTime(created + rng.next() * Math.max(HOUR, end - created), rng);
        if (at > NOW) continue;
        const author = rng.chance(0.6) && task.assigneeId ? task.assigneeId : rng.pick(team._members)._id;
        comments.push({ _id: new ObjectId(), taskId: task._id, teamId: task.teamId, authorId: author, body: rng.pick(COMMENTS), mentions: [], editedAt: null, createdAt: new Date(at), updatedAt: new Date(at) });
        emit(task, 'commented', at, { actorId: author });
        task.commentCount += 1;
      }
      // ~1% soft-deleted
      if (rng.chance(0.01) && task.status === 'todo') {
        const at = toWorkTime(created + rng.lognormal(48) * HOUR, rng);
        if (at <= NOW) {
          task.deletedAt = new Date(at);
          emit(task, 'deleted', at, { actorId: team._members[0]._id });
        }
      }
    }
  }

  // Events must be in time order (comment events were appended out of order)
  events.sort((a, b) => a.at - b.at || (a.type === 'created' ? -1 : 0));

  // Notifications: last 30 days of assignments to their recipients
  for (const e of events) {
    if (e.type === 'assigned' && e.at.getTime() > NOW - 30 * DAY && !e.toAssigneeId.equals(e.actorId)) {
      const readAt = rng.chance(0.75) ? new Date(e.at.getTime() + rng.lognormal(5) * HOUR) : null;
      notifications.push({ _id: new ObjectId(), userId: e.toAssigneeId, type: 'task_assigned', taskId: e.taskId, actorId: e.actorId, message: 'You were assigned a task', readAt: readAt && readAt.getTime() < NOW ? readAt : null, createdAt: e.at });
    }
  }

  const cleanTeams = teams.map(({ _def, _members, ...rest }) => rest);
  return { users, teams: cleanTeams, projects, tasks, events, comments, notifications };
}
