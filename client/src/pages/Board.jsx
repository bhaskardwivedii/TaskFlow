import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useSocketEvent } from '../auth.jsx';
import { STATUSES, fmtDate, isOverdue, initials } from '../constants.js';
import TaskDrawer from '../components/TaskDrawer.jsx';
import NewTask from '../components/NewTask.jsx';

const sameTeam = (teamId) => (t) => String(t.teamId) === String(teamId);

export default function Board({ teamId }) {
  const [team, setTeam] = useState(null);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [filters, setFilters] = useState({ projectId: '', assigneeId: '', q: '' });
  const [openTask, setOpenTask] = useState(null);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const query = { ...filters, limit: 500 };
      const [open, done] = await Promise.all([
        api(`/teams/${teamId}/tasks`, { query: { ...query, status: 'todo,in_progress,in_review,blocked' } }),
        api(`/teams/${teamId}/tasks`, { query: { ...query, status: 'done', sort: '-updatedAt', limit: 25 } }),
      ]);
      setTasks([...open.tasks, ...done.tasks]);
    } catch (e) {
      setError(e.message);
    }
  }, [teamId, filters]);

  useEffect(() => {
    Promise.all([api(`/teams/${teamId}`), api(`/teams/${teamId}/projects`)])
      .then(([t, p]) => {
        setTeam(t.team);
        setProjects(p.projects);
      })
      .catch((e) => setError(e.message));
  }, [teamId]);

  useEffect(() => {
    load();
  }, [load]);

  const members = useMemo(() => Object.fromEntries((team?.members ?? []).map((m) => [m.id, m])), [team]);
  const canEdit = team && team.myRole !== 'viewer';

  // ---- realtime: merge server pushes into local state ----
  const upsert = useCallback(
    (task) => {
      if (!sameTeam(teamId)(task)) return;
      setTasks((prev) => {
        const i = prev.findIndex((t) => t._id === task._id);
        const withAssignee = { ...task, assigneeId: task.assigneeId?._id ? task.assigneeId : members[task.assigneeId] ? { _id: task.assigneeId, name: members[task.assigneeId].name } : null };
        if (i === -1) return [withAssignee, ...prev];
        const next = [...prev];
        next[i] = withAssignee;
        return next;
      });
    },
    [teamId, members],
  );
  useSocketEvent('task:created', upsert);
  useSocketEvent('task:updated', upsert);
  useSocketEvent(
    'task:deleted',
    useCallback(({ id }) => setTasks((prev) => prev.filter((t) => t._id !== id)), []),
  );

  async function move(task, status) {
    if (task.status === status || !canEdit) return;
    const before = tasks;
    setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, status } : t))); // optimistic
    try {
      const { task: saved } = await api(`/tasks/${task._id}`, { method: 'PATCH', body: { status, version: task.version } });
      upsert(saved);
    } catch (e) {
      setTasks(before);
      setToast(e.status === 409 ? 'Someone else just changed this task. The board has been refreshed.' : e.message);
      if (e.status === 409) load();
    }
  }

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!team) return <div className="page muted">Loading board…</div>;

  const columns = STATUSES.map((s) => ({ ...s, tasks: tasks.filter((t) => t.status === s.id) }));

  return (
    <div className="page board-page">
      <div className="page-head">
        <div>
          <h1>{team.name}</h1>
          <p className="muted">
            {tasks.filter((t) => t.status !== 'done').length} open tasks, {team.members.length} people
            {team.myRole === 'viewer' && ' — you have view-only access'}
          </p>
        </div>
        {canEdit && (
          <button className="primary" onClick={() => setCreating(true)}>
            New task
          </button>
        )}
      </div>

      <div className="filters">
        <input placeholder="Search titles" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.projectId} onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={filters.assigneeId} onChange={(e) => setFilters({ ...filters, assigneeId: e.target.value })}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {team.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="board">
        {columns.map((col) => (
          <section
            key={col.id}
            className={`column ${dragging ? 'droppable' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging) move(dragging, col.id);
              setDragging(null);
            }}
          >
            <header className={`column-head s-line-${col.id}`}>
              <span>{col.label}</span>
              <span className="count">{col.tasks.length}</span>
            </header>
            <div className="column-body">
              {col.tasks.map((t) => (
                <article
                  key={t._id}
                  className={`card s-edge-${t.status}`}
                  draggable={canEdit}
                  onDragStart={() => setDragging(t)}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => setOpenTask(t._id)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpenTask(t._id)}
                  tabIndex={0}
                >
                  <div className="card-top">
                    <span className="task-key">
                      {team.key}-{t.number}
                    </span>
                    <span className={`prio prio-${t.priority}`}>{t.priority}</span>
                  </div>
                  <p className="card-title">{t.title}</p>
                  <div className="card-meta">
                    {t.dueDate && <span className={isOverdue(t) ? 'overdue' : ''}>Due {fmtDate(t.dueDate)}</span>}
                    {t.commentCount > 0 && <span>{t.commentCount} comments</span>}
                    <span className="avatar" title={t.assigneeId?.name ?? 'Unassigned'}>
                      {t.assigneeId ? initials(t.assigneeId.name) : '–'}
                    </span>
                  </div>
                </article>
              ))}
              {col.tasks.length === 0 && <p className="empty">Drag a task here</p>}
            </div>
          </section>
        ))}
      </div>

      {openTask && <TaskDrawer taskId={openTask} team={team} onClose={() => setOpenTask(null)} onChanged={upsert} />}
      {creating && (
        <NewTask
          team={team}
          projects={projects}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            upsert(t);
            setCreating(false);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast('')}>
          {toast}
        </div>
      )}
    </div>
  );
}
