import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useSocketEvent } from '../auth.jsx';
import { STATUSES, STATUS_LABEL, PRIORITIES, isOverdue } from '../constants.js';

const toInputDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function describe(e) {
  switch (e.type) {
    case 'created':
      return 'created the task';
    case 'status_changed':
      return (
        <>
          moved it from <b>{STATUS_LABEL[e.fromStatus]}</b> to <b>{STATUS_LABEL[e.toStatus]}</b>
        </>
      );
    case 'assigned':
      return e.toAssigneeId ? <>assigned it to <b>{e.toAssigneeId.name}</b></> : 'unassigned it';
    case 'priority_changed':
      return `changed priority from ${e.fromValue} to ${e.toValue}`;
    case 'due_date_changed':
      return e.toValue ? `set the due date to ${new Date(e.toValue).toLocaleDateString()}` : 'removed the due date';
    case 'estimate_changed':
      return `changed the estimate to ${e.toValue ?? 'none'}h`;
    case 'commented':
      return 'commented';
    default:
      return e.type;
  }
}

export default function TaskDrawer({ taskId, team, onClose, onChanged }) {
  const [task, setTask] = useState(null);
  const [events, setEvents] = useState([]);
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const canEdit = team.myRole !== 'viewer';

  const loadAll = useCallback(async () => {
    const [t, ev, c] = await Promise.all([api(`/tasks/${taskId}`), api(`/tasks/${taskId}/events`), api(`/tasks/${taskId}/comments`)]);
    setTask(t.task);
    setEvents(ev.events);
    setComments(c.comments);
  }, [taskId]);

  useEffect(() => {
    loadAll().catch((e) => setError(e.message));
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loadAll, onClose]);

  // Someone else edited this task -> refresh drawer
  useSocketEvent(
    'task:updated',
    useCallback((t) => t._id === taskId && loadAll(), [taskId, loadAll]),
  );
  useSocketEvent(
    'comment:created',
    useCallback(
      ({ taskId: id, comment }) => {
        if (id === taskId) setComments((prev) => (prev.some((c) => c._id === comment._id) ? prev : [...prev, comment]));
      },
      [taskId],
    ),
  );

  async function patch(changes) {
    setError('');
    try {
      const { task: saved } = await api(`/tasks/${taskId}`, { method: 'PATCH', body: { ...changes, version: task.version } });
      onChanged(saved);
      await loadAll();
    } catch (e) {
      setError(e.status === 409 ? 'This task changed while you were editing. Showing the latest version.' : e.message);
      loadAll();
    }
  }

  async function comment(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    try {
      const { comment: c } = await api(`/tasks/${taskId}/comments`, { method: 'POST', body: { body: draft } });
      setComments((prev) => (prev.some((x) => x._id === c._id) ? prev : [...prev, c]));
      setDraft('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this task? Its history is kept for reporting.')) return;
    try {
      await api(`/tasks/${taskId}`, { method: 'DELETE' });
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Task details">
        {!task ? (
          <p className="muted">{error || 'Loading…'}</p>
        ) : (
          <>
            <div className="drawer-head">
              <span className="task-key">{task.key}</span>
              <button className="ghost" onClick={onClose} aria-label="Close">
                Close
              </button>
            </div>
            <h2 className="drawer-title">{task.title}</h2>
            <p className="muted small">
              {task.projectId?.name} — created by {task.creatorId?.name} on {new Date(task.createdAt).toLocaleDateString()}
            </p>

            <div className="fields">
              <label>
                Status
                <select value={task.status} disabled={!canEdit} onChange={(e) => patch({ status: e.target.value })}>
                  {STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select value={task.priority} disabled={!canEdit} onChange={(e) => patch({ priority: e.target.value })}>
                  {PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                Assignee
                <select value={task.assigneeId?._id ?? ''} disabled={!canEdit} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {team.members
                    .filter((m) => m.teamRole !== 'viewer')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Due date
                <input
                  type="date"
                  className={isOverdue(task) ? 'overdue' : ''}
                  value={toInputDate(task.dueDate)}
                  disabled={!canEdit}
                  onChange={(e) => patch({ dueDate: e.target.value || null })}
                />
              </label>
            </div>
            {error && <p className="error">{error}</p>}

            <h3>Comments</h3>
            <ul className="comments">
              {comments.map((c) => (
                <li key={c._id}>
                  <strong>{c.authorId?.name}</strong> <span className="muted small">{new Date(c.createdAt).toLocaleString()}</span>
                  <p>{c.body}</p>
                </li>
              ))}
              {comments.length === 0 && <li className="muted">No comments yet.</li>}
            </ul>
            {canEdit && (
              <form className="comment-form" onSubmit={comment}>
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a comment" rows={2} />
                <button className="primary">Comment</button>
              </form>
            )}

            <h3>History</h3>
            <ol className="timeline">
              {events
                .filter((e) => e.type !== 'commented')
                .map((e) => (
                  <li key={e._id} className={e.toStatus ? `s-dot-${e.toStatus}` : ''}>
                    <span>
                      <b>{e.actorId?.name}</b> {describe(e)}
                    </span>
                    <time className="muted small">{new Date(e.at).toLocaleString()}</time>
                  </li>
                ))}
            </ol>

            {canEdit && (
              <button className="danger link" onClick={remove}>
                Delete task
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
