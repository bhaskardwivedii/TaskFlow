import { useState } from 'react';
import { api } from '../api.js';

// Create a team. The creator becomes its lead automatically (server-side).
export default function NewTeam({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', key: '', description: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    try {
      const { team } = await api('/teams', { method: 'POST', body: { ...form, key: form.key.toUpperCase() } });
      onCreated(team);
    } catch (err) {
      setError(err.details ? Object.values(err.details.fieldErrors ?? {}).flat().join('. ') : err.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>New team</h2>
        <label>
          Team name
          <input autoFocus value={form.name} onChange={set('name')} required minLength={2} maxLength={80} placeholder="e.g. Platform" />
        </label>
        <label>
          Key (2–6 letters, used in task IDs like PLAT-142)
          <input value={form.key} onChange={set('key')} required pattern="[A-Za-z]{2,6}" placeholder="PLAT" style={{ textTransform: 'uppercase' }} />
        </label>
        <label>
          Description (optional)
          <input value={form.description} onChange={set('description')} maxLength={500} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Create team</button>
        </div>
      </form>
    </div>
  );
}
