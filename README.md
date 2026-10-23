# TaskFlow — Smart Task Management System

A full-stack task board (React, Node.js, Express, MongoDB, Socket.io, JWT) built around a database designed for analysis: every change to a task is recorded in an append-only event log, so delivery metrics like cycle time, bottlenecks and rework are measured from data rather than estimated.

- **Board:** teams, projects, drag-and-drop kanban, comments, live updates across browsers, notifications
- **Access control:** JWT auth, global roles (admin, manager, member) plus per-team roles (lead, member, viewer)
- **Analytics:** a live dashboard computed with MongoDB aggregation pipelines, plus a star-schema export with 12 SQL analyses

The database design is documented in [docs/SCHEMA.md](docs/SCHEMA.md). Start there if you are reviewing this for a data role.

## Architecture

```
React (Vite) ──REST /api──►  Express (MVC)  ──►  MongoDB
     ▲                         │  controllers → services → models
     └──── Socket.io ◄─────────┘  (one write path: tasks + task_events in a transaction)
                                         │
                       aggregation pipelines ──► dashboard
                       $merge nightly        ──► daily_team_stats
                       export script         ──► star schema CSV ──► DuckDB / Power BI
```

## Run it

### Option A — Docker (everything in one command)

```bash
docker compose up --build
docker compose exec app node server/scripts/seed.js --force
```

Open http://localhost:4000 and sign in as `admin@taskflow.dev` / `Password@123`.

### Option B — local development

Requires Node 20+ and MongoDB (run `docker compose up mongo` for a replica-set Mongo, or use an Atlas URI).

```bash
cp .env.example server/.env          # edit MONGODB_URI if needed
cd server && npm install && npm run seed && npm run dev
cd client && npm install && npm run dev      # http://localhost:5173
```

Demo accounts (all `Password@123`): `admin@taskflow.dev`, `manager@taskflow.dev`, and every seeded team member. The seed script prints a team lead's email; leads see analytics for their own team, members do not.

### Tests

```bash
cd server
npm test        # analytics pipelines checked against independent JS calculations (no DB needed)
npm run smoke   # end-to-end: auth, RBAC, task lifecycle, 409 on stale edits, sockets, analytics (needs a running seeded server)
```

## Deploy (free tier: Render + MongoDB Atlas)

1. Create a free M0 cluster on MongoDB Atlas, add a database user, allow network access from `0.0.0.0/0`, and copy the connection string (append `/taskflow` before the `?`).
2. Push this repo to GitHub.
3. In Render, choose **New → Blueprint** and select the repo. `render.yaml` creates the web service. The nightly snapshot runs from GitHub Actions; add `MONGODB_URI` as a repository secret to enable it.
4. Set `MONGODB_URI` and `CLIENT_ORIGIN` (your Render URL) in the dashboard. `JWT_SECRET` is generated for you.
5. Seed once from your machine: `cd server && MONGODB_URI="<atlas uri>" npm run seed`.

Atlas clusters are replica sets, so transactions are on automatically.

## The analysis

```bash
cd server && npm run export                  # MongoDB → analytics/data/*.csv  (or --generated, no DB needed)
pip install duckdb && python ../analytics/run_analysis.py
```

`run_analysis.py` loads the CSVs into DuckDB with primary and foreign keys enforced, runs every query in `analytics/sql/queries.sql`, and writes [analytics/REPORT.md](analytics/REPORT.md).

The seeded data is synthetic. The generator (`server/src/seed/generator.js`) simulates six months of a five-team organisation and deliberately plants patterns so the analysis has something real to find. Findings from the current report:

| Question | Finding |
|---|---|
| Where does time go? | About 60% of task-hours are spent waiting in **To do**, not being worked on |
| Do urgent tasks finish faster? | They **start** faster (median wait 21h vs 315h for low), but median cycle time is about 4 days at every priority |
| Which team has quality issues in review? | **Mobile** bounces 35% of reviews back to in progress, three times Growth's 11% |
| Who ships fast but reopens? | **Growth**: lowest bounce rate, highest reopen-after-done rate (12% vs 4% for Platform) |
| Who is blocked most? | **Data**: 0.37 blocks per completion, about 3× other teams |
| Is work concentrated? | One engineer in Growth closes 30% of the team's tasks against a fair share of 14% |
| Does weekday matter? | Friday-created tasks wait a median 142h before starting, vs 96h on Monday |
| Are due dates realistic? | Urgent tasks miss their due date ~70% of the time — the deadlines are too tight, not the work too slow |

Be upfront in interviews that the data is simulated and the patterns were planted. The point being demonstrated is that the schema and queries can surface them.

## Project structure

```
server/
  src/models/          Mongoose schemas — users, teams, projects, tasks, task_events, comments, notifications, daily_team_stats
  src/services/        taskService: the single write path (task + event in one transaction, then socket + notifications)
  src/controllers/     thin HTTP handlers with zod validation schemas
  src/middleware/      JWT auth, team-scoped RBAC, validation, error handling
  src/sockets/         Socket.io gateway (JWT handshake, team and user rooms)
  src/analytics/       aggregation pipelines + star-schema transform
  src/seed/            deterministic synthetic data generator
  scripts/             seed, $jsonSchema validators, nightly snapshot, CSV export, smoke test
  tests/               pipeline tests (mingo in-process engine)
client/                React + Vite: board, task drawer, my work, analytics dashboard
analytics/             DDL, 12 SQL analyses, DuckDB runner, generated report
docs/SCHEMA.md         database design, indexes, metric definitions, trade-offs
```

## API

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | public (rate limited) |
| GET | `/api/auth/me`, `/api/me/tasks`, `/api/teams` | signed in |
| POST | `/api/teams` | admin, manager |
| GET | `/api/teams/:teamId`, `/api/teams/:teamId/projects`, `/api/teams/:teamId/tasks` | team viewer+ |
| POST/PATCH/DELETE | `/api/teams/:teamId/members[/:userId]`, `POST /api/teams/:teamId/projects` | team lead |
| POST | `/api/teams/:teamId/tasks` | team member+ |
| GET/PATCH/DELETE | `/api/tasks/:taskId` | viewer / member / creator or lead |
| GET | `/api/tasks/:taskId/events`, `/api/tasks/:taskId/comments` | team viewer+ |
| POST | `/api/tasks/:taskId/comments` | team member+ |
| GET/POST/PATCH | `/api/notifications`, `/read-all`, `/:id/read` | signed in |
| GET | `/api/analytics/dashboard?days=&teamId=` | team lead (own teams), manager, admin |
| POST | `/api/analytics/snapshots/refresh` | manager, admin |
| GET | `/api/analytics/explain` | admin |

Socket events: `task:created`, `task:updated`, `task:deleted`, `comment:created` (team room), `notification:new` (user room).

## Resume lines

> **Smart Task Management System** — React, Node.js, Express, MongoDB, Socket.io, JWT
> - Designed an event-sourced MongoDB schema (current-state `tasks` plus an append-only `task_events` log written in the same transaction), with 22 query-driven indexes (compound, partial, multikey, text and TTL) and `$jsonSchema` validation at the database layer.
> - Built delivery analytics with aggregation pipelines — cycle-time percentiles, time-in-status via `$setWindowFields`, WIP via running sums — and an idempotent `$merge` daily snapshot table.
> - Exported the data as a star schema (4 dimensions, 3 fact tables) and wrote 12 SQL analyses in DuckDB that identified review bottlenecks, rework hot spots and workload concentration.
> - Implemented JWT auth with global and team-level RBAC, optimistic concurrency for simultaneous edits, and real-time board updates and notifications over Socket.io.
