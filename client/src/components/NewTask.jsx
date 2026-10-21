import { useState } from 'react';
import { api } from '../api.js';
import { PRIORITIES } from '../constants.js';

export default function NewTask({ team, projects, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '',
    projectId: projects.find((p) => p.status === 'active')?._id ?? projects[0]?._id ?? '',
    priority: 'medium',
    assigneeId: '',
    dueDate: '',
    estimateHours: '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    try {
      const body = {
        title: form.title,
        projectId: form.projectId,
        priority: form.priority,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
        estimateHours: form.estimateHours ? Number(form.estimateHours) : null,
      };
      const { task } = await api(`/teams/${team.id}/tasks`, { method: 'POST', body });
      onCreated(task);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>New task</h2>
        <label>
          Title
          <input autoFocus value={form.title} onChange={set('title')} required maxLength={200} />
        </label>
        <div className="row">
          <label>
            Project
            <select value={form.projectId} onChange={set('projectId')} required>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label>
            Assignee
            <select value={form.assigneeId} onChange={set('assigneeId')}>
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
            <input type="date" value={form.dueDate} onChange={set('dueDate')} />
          </label>
          <label>
            Estimate (h)
            <input type="number" min="0" max="400" value={form.estimateHours} onChange={set('estimateHours')} />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Create task</button>
        </div>
      </form>
    </div>
  );
}
