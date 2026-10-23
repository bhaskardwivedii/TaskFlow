import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Board from './pages/Board.jsx';
import MyWork from './pages/MyWork.jsx';
import People from './pages/People.jsx';
import Notifications from './components/Notifications.jsx';
import NewTeam from './components/NewTeam.jsx';

// Charts are heavy; load the analytics bundle only when it is opened.
const Analytics = lazy(() => import('./pages/Analytics.jsx'));

function Shell() {
  const { user, logout } = useAuth();
  const [teams, setTeams] = useState([]);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const navigate = useNavigate();

  const loadTeams = () => api('/teams').then((r) => setTeams(r.teams));
  useEffect(() => {
    loadTeams();
  }, []);

  const canAnalyse = user.role !== 'member' || teams.some((t) => t.myRole === 'lead');
  const canCreateTeam = user.role === 'admin' || user.role === 'manager';

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
          {user.role === 'admin' && <NavLink to="/people">People</NavLink>}
          <div className="nav-group-row">
            <span className="nav-group">Teams</span>
            {canCreateTeam && (
              <button className="link" onClick={() => setCreatingTeam(true)} title="Create a team">
                + New
              </button>
            )}
          </div>
          {teams.map((t) => (
            <NavLink key={t.id} to={`/teams/${t.id}`}>
              <span className="team-key">{t.key}</span> {t.name}
            </NavLink>
          ))}
          {teams.length === 0 && !canCreateTeam && <p className="muted small">Ask a team lead to add you to a team.</p>}
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
        <p className="proto-footer">
          Prototype · <a href="mailto:bhaskardwivedi.24112004@gmail.com?subject=TaskFlow%20enquiry">contact owner</a>
        </p>
      </aside>
      <main className="main">
        <header className="topbar">
          <Notifications />
        </header>
        <Routes>
          <Route path="/" element={<MyWork />} />
          <Route path="/teams/:teamId" element={<BoardRoute />} />
          {user.role === 'admin' && <Route path="/people" element={<People />} />}
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
      {creatingTeam && (
        <NewTeam
          onClose={() => setCreatingTeam(false)}
          onCreated={async (team) => {
            await loadTeams();
            setCreatingTeam(false);
            navigate(`/teams/${team._id}`);
          }}
        />
      )}
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
