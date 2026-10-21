import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { STATUS_LABEL, fmtHours } from '../constants.js';

// Must match the --s-* tokens in styles.css
const C = { todo: '#7d8799', in_progress: '#2f5bea', in_review: '#7a4fd6', blocked: '#c2410c', done: '#0f8b6f', grid: '#e1e5ec', ink: '#1d2433' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function Kpi({ label, value, note }) {
  return (
    <div className="kpi">
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

function FlowRibbon({ rows }) {
  const total = rows.reduce((s, r) => s + r.totalHours, 0) || 1;
  return (
    <section className="panel ribbon-panel">
      <h2>Where the time goes</h2>
      <p className="muted">Share of all task-hours spent in each status before completion. Work waiting in To do is time nobody is working on it.</p>
      <div className="ribbon" role="img" aria-label="Share of time by status">
        {rows.map((r) => (
          <div key={r.status} className={`ribbon-seg s-bg-${r.status}`} style={{ flex: r.totalHours }}>
            <strong>{Math.round((r.totalHours / total) * 100)}%</strong>
            <span>{STATUS_LABEL[r.status]}</span>
          </div>
        ))}
      </div>
      <div className="ribbon-stats">
        {rows.map((r) => (
          <div key={r.status}>
            <span className={`dot s-bg-${r.status}`} />
            {STATUS_LABEL[r.status]}: median {fmtHours(r.medianHours)}, p85 {fmtHours(r.p85Hours)} per stint
          </div>
        ))}
      </div>
    </section>
  );
}

function Heatmap({ cells }) {
  const max = Math.max(1, ...cells.map((c) => c.events));
  const get = (d, h) => cells.find((c) => c.dow === d && c.hour === h)?.events ?? 0;
  return (
    <div className="heatmap" role="table" aria-label="Activity by weekday and hour">
      <div />
      {Array.from({ length: 24 }, (_, h) => (
        <span key={h} className="heat-h">
          {h % 3 === 0 ? h : ''}
        </span>
      ))}
      {DOW.map((d, i) => (
        <div key={d} className="heat-row">
          <span className="heat-d">{d}</span>
          {Array.from({ length: 24 }, (_, h) => {
            const v = get(i + 1, h);
            return <span key={h} className="heat-cell" title={`${d} ${h}:00 — ${v} events`} style={{ opacity: 0.08 + 0.92 * (v / max) }} />;
          })}
        </div>
      ))}
    </div>
  );
}

export default function Analytics({ teams }) {
  const [days, setDays] = useState(90);
  const [teamId, setTeamId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api('/analytics/dashboard', { query: { days, teamId } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [days, teamId]);

  const k = data?.summary?.kpis ?? {};
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Delivery analytics</h1>
          <p className="muted">Computed live from the task event log with MongoDB aggregation pipelines.</p>
        </div>
        <div className="filters inline">
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
            <option value="">All teams I can see</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
          </select>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Crunching the event log…</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label="Completed" value={k.completedInRange ?? 0} note={`${k.createdInRange ?? 0} created`} />
            <Kpi label="Median cycle time" value={fmtHours(k.medianCycleHours)} note={`mean ${fmtHours(k.avgCycleHours)}`} />
            <Kpi label="Mean lead time" value={fmtHours(k.avgLeadHours)} note="created to done" />
            <Kpi label="On time" value={pct(k.onTimeRate)} note="of tasks with a due date" />
            <Kpi label="Open" value={k.open ?? 0} note={`${k.overdue ?? 0} overdue, ${k.unassignedOpen ?? 0} unassigned`} />
          </div>

          <FlowRibbon rows={data.timeInStatus} />

          <div className="grid-2">
            <section className="panel">
              <h2>Arrivals vs throughput per week</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.throughput.map((r) => ({ ...r, week: shortDate(r.week) }))}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="created" name="Created" fill={C.todo} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="completed" name="Completed" fill={C.done} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
            <section className="panel">
              <h2>Work in progress over time</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.wip.map((r) => ({ ...r, day: shortDate(r.day) }))}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={30} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line dataKey="wip" name="Open tasks" stroke={C.in_progress} dot={false} strokeWidth={2} />
                  <Line dataKey="completed7d" name="Completed, trailing 7 days" stroke={C.done} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          </div>

          <div className="grid-2">
            <section className="panel">
              <h2>Cycle time by priority</h2>
              <p className="muted small">From first start to done. p85 means 85% of tasks finished within this time.</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.cycleTime} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid stroke={C.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="h" />
                  <YAxis type="category" dataKey="priority" tick={{ fontSize: 12 }} width={60} />
                  <Tooltip formatter={(v) => fmtHours(v)} />
                  <Legend />
                  <Bar dataKey="p50Hours" name="Median" fill={C.in_progress} radius={[0, 3, 3, 0]} />
                  <Bar dataKey="p85Hours" name="p85" fill={C.in_review} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
            <section className="panel">
              <h2>When the team works</h2>
              <p className="muted small">Task activity by local weekday and hour.</p>
              <Heatmap cells={data.heatmap} />
            </section>
          </div>

          <section className="panel">
            <h2>Rework by team</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th className="num">Completions</th>
                  <th className="num">Passed review first time</th>
                  <th className="num">Reopened after done</th>
                  <th className="num">Times blocked</th>
                </tr>
              </thead>
              <tbody>
                {data.rework.map((r) => (
                  <tr key={r.teamId}>
                    <td>{r.team}</td>
                    <td className="num">{r.toDone}</td>
                    <td className="num">{pct(r.firstPassReviewRate)}</td>
                    <td className="num">{pct(r.reopenRate)}</td>
                    <td className="num">{r.blockedEntries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="grid-2">
            <section className="panel">
              <h2>Open work per person</h2>
              <p className="muted small">Load weights priority: urgent 5, high 3, medium 2, low 1.</p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th className="num">Open</th>
                    <th className="num">Overdue</th>
                    <th className="num">Load</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workload.slice(0, 12).map((r) => (
                    <tr key={r.assigneeId ?? 'none'}>
                      <td>{r.name}</td>
                      <td className="num">{r.open}</td>
                      <td className={`num ${r.overdue ? 'overdue' : ''}`}>{r.overdue}</td>
                      <td className="num">
                        <span className="bar" style={{ width: `${Math.min(100, (r.weightedLoad / (data.workload[0]?.weightedLoad || 1)) * 100)}%` }} />
                        {r.weightedLoad}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="panel">
              <h2>Teams side by side</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th className="num">Done</th>
                    <th className="num">Avg cycle</th>
                    <th className="num">Open</th>
                    <th className="num">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.scorecard.map((r) => (
                    <tr key={r.teamId}>
                      <td>{r.team}</td>
                      <td className="num">{r.completed}</td>
                      <td className="num">{fmtHours(r.avgCycleHours)}</td>
                      <td className="num">{r.open}</td>
                      <td className="num">{pct(r.overdueRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h2 className="mt">Missed due dates</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Priority</th>
                    <th className="num">With due date</th>
                    <th className="num">Missed</th>
                    <th className="num">Avg days late</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sla.map((r) => (
                    <tr key={r.priority}>
                      <td>{r.priority}</td>
                      <td className="num">{r.n}</td>
                      <td className="num">{pct(r.breachRate)}</td>
                      <td className="num">{r.avgLateHours ? (r.avgLateHours / 24).toFixed(1) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
