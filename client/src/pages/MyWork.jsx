import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { STATUS_LABEL, fmtDate, isOverdue } from '../constants.js';

export default function MyWork() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState(null);

  useEffect(() => {
    api('/me/tasks').then((r) => setTasks(r.tasks));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Good to see you, {user.name.split(' ')[0]}</h1>
          <p className="muted">{tasks ? `${tasks.length} open tasks assigned to you, soonest due first` : 'Loading…'}</p>
        </div>
      </div>
      {tasks && tasks.length === 0 && <p className="empty-state">Nothing assigned to you. Pick a team on the left to see its board.</p>}
      {tasks && tasks.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t._id}>
                <td>
                  <Link to={`/teams/${t.teamId._id}`}>
                    <span className="task-key">
                      {t.teamId.key}-{t.number}
                    </span>{' '}
                    {t.title}
                  </Link>
                </td>
                <td>
                  <span className={`pill s-bg-${t.status}`}>{STATUS_LABEL[t.status]}</span>
                </td>
                <td>
                  <span className={`prio prio-${t.priority}`}>{t.priority}</span>
                </td>
                <td className={isOverdue(t) ? 'overdue' : ''}>{fmtDate(t.dueDate) || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
