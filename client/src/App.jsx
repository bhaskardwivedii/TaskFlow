import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Board from './pages/Board.jsx';
import MyWork from './pages/MyWork.jsx';
import Notifications from './components/Notifications.jsx';

// Charts are heavy; load the analytics bundle only when it is opened.
const Analytics = lazy(() => import('./pages/Analytics.jsx'));

function Shell() {
  const { user, logout } = useAuth();
  const [teams, setTeams] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api('/teams').then((r) => setTeams(r.teams));
  }, []);

  const canAnalyse = user.role !== 'member' || teams.some((t) => t.myRole === 'lead');

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand" onClick={() => navigate('/')}>
          <span className="brand-mark" aria-hidden>
            <i className="s-todo" />
            <i className="s-in_progress" />
            <i className="s-in_review" />
            <i className="s-done" />
          </span>
          TaskFlow
        </div>
        <nav>
          <NavLink to="/" end>
            My work
          </NavLink>
          {canAnalyse && <NavLink to="/analytics">Analytics</NavLink>}
          <p className="nav-group">Teams</p>
          {teams.map((t) => (
            <NavLink key={t.id} to={`/teams/${t.id}`}>
              <span className="team-key">{t.key}</span> {t.name}
            </NavLink>
          ))}
          {teams.length === 0 && <p className="muted small">Ask a team lead to add you to a team.</p>}
        </nav>
        <div className="me">
          <div>
            <strong>{user.name}</strong>
            <span className="muted small">{user.role}</span>
          </div>
          <button className="link" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <Notifications />
        </header>
        <Routes>
          <Route path="/" element={<MyWork />} />
          <Route path="/teams/:teamId" element={<BoardRoute />} />
          <Route
            path="/analytics"
            element={
              <Suspense fallback={<div className="page muted">Loading analytics…</div>}>
                <Analytics teams={teams} />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function BoardRoute() {
  const { teamId } = useParams();
  return <Board key={teamId} teamId={teamId} />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/*" element={user ? <Shell /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
