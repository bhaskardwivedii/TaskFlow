import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const GLOBAL_ROLES = ['member', 'manager', 'admin'];

/**
 * Admin-only directory. Change a person's GLOBAL role here:
 *   member  — normal user, works inside teams they're added to
 *   manager — can create teams and see analytics across all teams
 *   admin   — full access to everything
 * Team-level roles (lead/member/viewer) are set per team in Manage team.
 */
export default function People() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => api('/users').then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function changeRole(id, role) {
    setBusy(id);
    setError('');
    try {
      await api(`/users/${id}/role`, { method: 'PATCH', body: { role } });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted">Everyone who has an account. Set each person's global role.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!users ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Global role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="muted">{u.email}</td>
                <td style={{ width: 160 }}>
                  {u.id === user.id ? (
                    <span className="pill s-bg-done">{u.role} (you)</span>
                  ) : (
                    <select value={u.role} disabled={busy === u.id} onChange={(e) => changeRole(u.id, e.target.value)}>
                      {GLOBAL_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
