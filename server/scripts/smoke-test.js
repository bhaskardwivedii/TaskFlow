/**
 * End-to-end smoke test against a RUNNING, SEEDED server.
 *
 *   npm run seed && npm start      # in one terminal
 *   npm run smoke                  # in another (BASE_URL defaults to http://localhost:4000)
 *
 * Exercises auth, RBAC, task lifecycle + event log, optimistic concurrency,
 * comments, realtime broadcast over Socket.io, and the analytics endpoint.
 */
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

const health = await call('/health');
assert.equal(health.status, 200);
assert.equal(health.data.db, true);
ok('health check, database connected');

const bad = await call('/auth/login', { method: 'POST', body: { email: 'admin@taskflow.dev', password: 'wrong-password' } });
assert.equal(bad.status, 401);
ok('wrong password rejected');

const { data: adminLogin } = await call('/auth/login', { method: 'POST', body: { email: 'admin@taskflow.dev', password: 'Password@123' } });
const admin = adminLogin.token;
ok('admin login returns JWT');

const { data: teamsRes } = await call('/teams', { token: admin });
const teamId = teamsRes.teams[0].id;
const { data: teamRes } = await call(`/teams/${teamId}`, { token: admin });
const { data: projRes } = await call(`/teams/${teamId}/projects`, { token: admin });
const member = teamRes.team.members.find((m) => m.teamRole === 'member');
ok(`loaded team ${teamRes.team.name} with ${teamRes.team.members.length} members`);

// realtime listener
const socket = io(BASE, { auth: { token: admin }, transports: ['websocket'] });
await new Promise((resolve, reject) => {
  socket.on('connect', resolve);
  socket.on('connect_error', reject);
});
const received = [];
socket.on('task:updated', (t) => received.push(t));
ok('socket connected with JWT handshake');

const { status: cs, data: created } = await call(`/teams/${teamId}/tasks`, {
  token: admin,
  method: 'POST',
  body: { title: 'Smoke test task', projectId: projRes.projects[0]._id, priority: 'high', assigneeId: member.id },
});
assert.equal(cs, 201);
const task = created.task;
assert.equal(task.status, 'todo');
ok(`created task #${task.number}`);

const { data: moved } = await call(`/tasks/${task._id}`, { token: admin, method: 'PATCH', body: { status: 'in_progress', version: task.version } });
assert.equal(moved.task.status, 'in_progress');
assert.ok(moved.task.startedAt, 'startedAt is set on first move out of todo');
ok('moved to in_progress, startedAt recorded');

const stale = await call(`/tasks/${task._id}`, { token: admin, method: 'PATCH', body: { status: 'done', version: task.version } });
assert.equal(stale.status, 409);
ok('stale version rejected with 409 (optimistic concurrency)');

await call(`/tasks/${task._id}`, { token: admin, method: 'PATCH', body: { status: 'done', version: moved.task.version } });
const { data: done } = await call(`/tasks/${task._id}`, { token: admin });
assert.ok(done.task.completedAt);
ok('moved to done, completedAt recorded');

await call(`/tasks/${task._id}/comments`, { token: admin, method: 'POST', body: { body: 'Looks good' } });
const { data: hist } = await call(`/tasks/${task._id}/events`, { token: admin });
const types = hist.events.map((e) => e.type);
assert.deepEqual(types, ['created', 'assigned', 'status_changed', 'status_changed', 'commented']);
ok(`event log: ${types.join(' -> ')}`);

await new Promise((r) => setTimeout(r, 300));
assert.ok(received.some((t) => t._id === task._id), 'socket received task:updated');
ok('Socket.io broadcast task:updated to the team room');

const email = `smoke.${Date.now()}@example.com`;
const { data: reg } = await call('/auth/register', { method: 'POST', body: { name: 'Smoke Outsider', email, password: 'Password123' } });
assert.equal(reg.user.role, 'member');
const outsider = reg.token;
assert.equal((await call(`/teams/${teamId}/tasks`, { token: outsider })).status, 403);
assert.equal((await call(`/tasks/${task._id}`, { token: outsider })).status, 403);
assert.equal((await call('/analytics/dashboard', { token: outsider })).status, 403);
ok('non-member blocked from team tasks and analytics (RBAC)');

const { status: as, data: dash } = await call('/analytics/dashboard?days=90', { token: admin });
assert.equal(as, 200);
for (const k of ['summary', 'throughput', 'cycleTime', 'timeInStatus', 'workload', 'rework', 'wip', 'heatmap', 'sla', 'scorecard']) assert.ok(k in dash, k);
assert.ok(dash.summary.kpis.completedInRange > 0);
ok(`analytics dashboard: ${dash.summary.kpis.completedInRange} completed in 90 days, median cycle ${dash.summary.kpis.medianCycleHours}h`);

assert.equal((await call(`/tasks/${task._id}`, { token: admin, method: 'DELETE' })).status, 204);
assert.equal((await call(`/tasks/${task._id}`, { token: admin })).status, 404);
ok('soft delete hides the task (history retained)');

socket.disconnect();
console.log(`\nAll ${step} checks passed.`);
