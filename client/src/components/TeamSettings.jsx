import { useEffect, useState } from 'react';
import { api } from '../api.js';

const TEAM_ROLES = ['lead', 'member', 'viewer'];

/**
 * Manage a team: add/remove members, change their team role, and create
 * projects. Team leads and admins only. `team` is the full team object from
 * GET /teams/:id (with members). Calls onChanged after any successful edit.
 */
export default function TeamSettings({ team, onClose, onChanged }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const addMember = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`/teams/${team.id}/members`, { method: 'POST', body: { email: email.trim().toLowerCase(), role } });
      setEmail('');
    });
  };

  const changeRole = (userId, newRole) => run(() => api(`/teams/${team.id}/members/${userId}`, { method: 'PATCH', body: { role: newRole } }));
  const removeMember = (userId) => run(() => api(`/teams/${team.id}/members/${userId}`, { method: 'DELETE' }));

  const addProject = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`/teams/${team.id}/projects`, { method: 'POST', body: { name: projectName.trim() } });
      setProjectName('');
    });
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Team settings">
        <div className="drawer-head">
          <span className="task-key">{team.key}</span>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <h2 className="drawer-title">Manage {team.name}</h2>
        {error && <p className="error">{error}</p>}

        <h3>Add a member</h3>
        <p className="muted small">The person must have registered an account first. Enter their email, pick a role.</p>
        <form className="comment-form" onSubmit={addMember} style={{ gridTemplateColumns: '1fr auto auto' }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@email.com" required />
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 'auto' }}>
            {TEAM_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button className="primary" disabled={busy}>
            Add
          </button>
        </form>
        <p className="muted small">lead: full control · member: create and edit tasks · viewer: read-only</p>

        <h3>Members ({team.members.length})</h3>
        <table className="table">
          <tbody>
            {team.members.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.name}
                  <br />
                  <span className="muted small">{m.email}</span>
                </td>
                <td style={{ width: 120 }}>
                  <select value={m.teamRole} disabled={busy} onChange={(e) => changeRole(m.id, e.target.value)}>
                    {TEAM_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ width: 70 }}>
                  <button className="danger link" disabled={busy} onClick={() => removeMember(m.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Create a project</h3>
        <p className="muted small">Tasks belong to a project, so add one before creating tasks.</p>
        <form className="comment-form" onSubmit={addProject}>
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name" required minLength={2} />
          <button className="primary" disabled={busy}>
            Add project
          </button>
        </form>
      </aside>
    </div>
  );
}
