/**
 * Transform the document model into a relational STAR SCHEMA for BI tools
 * (Power BI, Tableau, Looker Studio) and SQL engines (DuckDB, Postgres).
 *
 *   dimensions : dim_date, dim_user, dim_team, dim_project
 *   facts      : fact_task (accumulating snapshot, one row per task)
 *                fact_task_event (transaction grain, one row per change)
 *                fact_status_interval (derived, one row per status stint)
 *   bridge     : bridge_task_label (many-to-many tasks <-> labels)
 *
 * Pure function over arrays so it works on a live DB export or on generated data.
 */

const HOUR = 3_600_000;
const id = (v) => (v == null ? null : String(v));
const iso = (d) => (d ? new Date(d).toISOString() : null);
const hours = (a, b) => (a && b ? Math.round(((new Date(b) - new Date(a)) / HOUR) * 100) / 100 : null);

function localDateParts(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (d) => fmt.format(new Date(d)); // "2026-10-21"
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 864e5 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export function toStarSchema({ users, teams, projects, tasks, events }, { now = new Date(), tz = 'Asia/Kolkata' } = {}) {
  const localDate = localDateParts(tz);
  const dateKey = (d) => (d ? Number(localDate(d).replaceAll('-', '')) : null);

  // ---- dim_date: continuous calendar covering all activity ----
  const minTs = Math.min(...tasks.map((t) => new Date(t.createdAt).getTime()));
  const dim_date = [];
  for (let t = minTs - 864e5; t <= now.getTime() + 120 * 864e5; t += 864e5) {
    const ds = localDate(t);
    if (dim_date.length && dim_date[dim_date.length - 1].date === ds) continue;
    const d = new Date(`${ds}T00:00:00Z`);
    const dow = d.getUTCDay();
    dim_date.push({
      date_key: Number(ds.replaceAll('-', '')),
      date: ds,
      year: d.getUTCFullYear(),
      quarter: Math.floor(d.getUTCMonth() / 3) + 1,
      month: d.getUTCMonth() + 1,
      month_name: MONTHS[d.getUTCMonth()],
      iso_week: isoWeek(ds),
      day_of_week: dow === 0 ? 7 : dow, // ISO: Mon=1 .. Sun=7
      day_name: DAYS[dow],
      is_weekend: dow === 0 || dow === 6,
    });
  }

  // ---- dimensions ----
  const primaryTeam = new Map();
  for (const t of teams) {
    for (const m of t.members) {
      if (m.role === 'viewer') continue;
      if (!primaryTeam.has(id(m.userId))) primaryTeam.set(id(m.userId), { team_id: id(t._id), team_role: m.role });
    }
  }
  const dim_user = users.map((u) => ({
    user_id: id(u._id),
    name: u.name,
    global_role: u.role,
    title: u.title ?? null,
    department: u.department ?? null,
    team_id: primaryTeam.get(id(u._id))?.team_id ?? null,
    team_role: primaryTeam.get(id(u._id))?.team_role ?? null,
    is_active: u.isActive !== false,
    joined_at: iso(u.createdAt),
  }));
  const dim_team = teams.map((t) => ({
    team_id: id(t._id),
    team_key: t.key,
    team_name: t.name,
    member_count: t.members.filter((m) => m.role !== 'viewer').length,
    created_at: iso(t.createdAt),
  }));
  const dim_project = projects.map((p) => ({
    project_id: id(p._id),
    team_id: id(p.teamId),
    project_name: p.name,
    status: p.status,
    owner_id: id(p.ownerId),
    start_date: iso(p.startDate),
    target_date: iso(p.targetDate),
  }));

  // ---- fact_task_event + fact_status_interval ----
  const sorted = [...events].sort((a, b) => new Date(a.at) - new Date(b.at));
  const fact_task_event = sorted.map((e) => ({
    event_id: id(e._id),
    task_id: id(e.taskId),
    team_id: id(e.teamId),
    project_id: id(e.projectId),
    actor_id: id(e.actorId),
    event_type: e.type,
    from_status: e.fromStatus ?? null,
    to_status: e.toStatus ?? null,
    from_assignee_id: id(e.fromAssigneeId),
    to_assignee_id: id(e.toAssigneeId),
    from_value: e.fromValue ?? null,
    to_value: e.toValue ?? null,
    priority_at_event: e.priority ?? null,
    assignee_at_event: id(e.assigneeId),
    event_at: iso(e.at),
    event_date_key: dateKey(e.at),
  }));

  const statusEvents = new Map();
  for (const e of sorted) {
    if (e.type !== 'created' && e.type !== 'status_changed') continue;
    const k = id(e.taskId);
    if (!statusEvents.has(k)) statusEvents.set(k, []);
    statusEvents.get(k).push(e);
  }
  const fact_status_interval = [];
  const perTask = new Map();
  for (const [taskId, evs] of statusEvents) {
    let reviewRounds = 0;
    let blockedCount = 0;
    evs.forEach((e, i) => {
      const next = evs[i + 1];
      if (e.toStatus === 'in_review') reviewRounds += 1;
      if (e.toStatus === 'blocked') blockedCount += 1;
      if (e.toStatus === 'done' && !next) return; // terminal state has no duration
      const exited = next ? next.at : null;
      fact_status_interval.push({
        task_id: taskId,
        team_id: id(e.teamId),
        seq: i + 1,
        status: e.toStatus,
        priority_at_entry: e.priority ?? null,
        assignee_at_entry: id(e.assigneeId),
        entered_at: iso(e.at),
        exited_at: iso(exited),
        entered_date_key: dateKey(e.at),
        duration_hours: hours(e.at, exited ?? now),
        is_current: !next,
      });
    });
    perTask.set(taskId, { reviewRounds, blockedCount });
  }

  // ---- fact_task (accumulating snapshot) ----
  const teamKey = new Map(teams.map((t) => [id(t._id), t.key]));
  const bridge_task_label = [];
  const fact_task = tasks.map((t) => {
    const tid = id(t._id);
    (t.labels ?? []).forEach((label) => bridge_task_label.push({ task_id: tid, label }));
    const isOpen = t.status !== 'done' && !t.deletedAt;
    return {
      task_id: tid,
      task_key: `${teamKey.get(id(t.teamId))}-${t.number}`,
      team_id: id(t.teamId),
      project_id: id(t.projectId),
      creator_id: id(t.creatorId),
      assignee_id: id(t.assigneeId),
      status: t.status,
      priority: t.priority,
      estimate_hours: t.estimateHours ?? null,
      created_at: iso(t.createdAt),
      created_date_key: dateKey(t.createdAt),
      started_at: iso(t.startedAt),
      completed_at: iso(t.completedAt),
      completed_date_key: dateKey(t.completedAt),
      due_date: iso(t.dueDate),
      is_open: isOpen,
      is_overdue: Boolean(isOpen && t.dueDate && new Date(t.dueDate) < now),
      is_deleted: Boolean(t.deletedAt),
      wait_time_hours: hours(t.createdAt, t.startedAt),
      cycle_time_hours: hours(t.startedAt, t.completedAt),
      lead_time_hours: hours(t.createdAt, t.completedAt),
      completed_on_time: t.completedAt && t.dueDate ? new Date(t.completedAt) <= new Date(t.dueDate) : null,
      reopen_count: t.reopenCount ?? 0,
      comment_count: t.commentCount ?? 0,
      review_rounds: perTask.get(tid)?.reviewRounds ?? 0,
      blocked_count: perTask.get(tid)?.blockedCount ?? 0,
    };
  });

  return { dim_date, dim_user, dim_team, dim_project, fact_task, fact_task_event, fact_status_interval, bridge_task_label };
}

/** RFC-4180 CSV serialisation. */
export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
