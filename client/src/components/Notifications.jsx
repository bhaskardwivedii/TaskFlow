import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useSocketEvent } from '../auth.jsx';

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    api('/notifications').then((r) => {
      setItems(r.notifications);
      setUnread(r.unread);
    });
  }, []);

  useSocketEvent(
    'notification:new',
    useCallback((n) => {
      setItems((prev) => [n, ...prev].slice(0, 50));
      setUnread((u) => u + 1);
      setFlash(n.message);
      setTimeout(() => setFlash(null), 4000);
    }, []),
  );

  async function readAll() {
    await api('/notifications/read-all', { method: 'POST' });
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }

  return (
    <div className="notif">
      <button className="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
        Notifications {unread > 0 && <span className="badge">{unread}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="link" onClick={readAll}>
                Mark all read
              </button>
            )}
          </div>
          <ul>
            {items.map((n) => (
              <li key={n._id} className={n.readAt ? '' : 'unread'}>
                {n.message}
                <time className="muted small">{new Date(n.createdAt).toLocaleString()}</time>
              </li>
            ))}
            {items.length === 0 && <li className="muted">You're all caught up.</li>}
          </ul>
        </div>
      )}
      {flash && (
        <div className="toast" role="status">
          {flash}
        </div>
      )}
    </div>
  );
}
