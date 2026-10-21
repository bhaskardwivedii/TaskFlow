-- =====================================================================
-- TaskFlow analytics warehouse — star schema DDL
-- Portable ANSI SQL (tested on DuckDB; runs on Postgres with minor edits).
-- Grain of each fact table is stated explicitly; that is the first thing
-- to agree on before writing any metric.
-- =====================================================================

-- ---------- Dimensions ----------
CREATE TABLE dim_date (
    date_key      INTEGER PRIMARY KEY,          -- YYYYMMDD, local (Asia/Kolkata) calendar
    date          DATE    NOT NULL UNIQUE,
    year          SMALLINT NOT NULL,
    quarter       SMALLINT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    month         SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    month_name    VARCHAR NOT NULL,
    iso_week      SMALLINT NOT NULL,
    day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),  -- ISO: Mon=1
    day_name      VARCHAR NOT NULL,
    is_weekend    BOOLEAN NOT NULL
);

CREATE TABLE dim_team (
    team_id       VARCHAR PRIMARY KEY,
    team_key      VARCHAR NOT NULL UNIQUE,
    team_name     VARCHAR NOT NULL,
    member_count  INTEGER NOT NULL,
    created_at    TIMESTAMPTZ
);

CREATE TABLE dim_user (
    user_id       VARCHAR PRIMARY KEY,
    name          VARCHAR NOT NULL,
    global_role   VARCHAR NOT NULL CHECK (global_role IN ('admin','manager','member')),
    title         VARCHAR,
    department    VARCHAR,
    team_id       VARCHAR REFERENCES dim_team(team_id),   -- primary team (NULL for managers/admins)
    team_role     VARCHAR,
    is_active     BOOLEAN NOT NULL,
    joined_at     TIMESTAMPTZ
);

CREATE TABLE dim_project (
    project_id    VARCHAR PRIMARY KEY,
    team_id       VARCHAR NOT NULL REFERENCES dim_team(team_id),
    project_name  VARCHAR NOT NULL,
    status        VARCHAR NOT NULL,
    owner_id      VARCHAR REFERENCES dim_user(user_id),
    start_date    TIMESTAMPTZ,
    target_date   TIMESTAMPTZ
);

-- ---------- Facts ----------
-- Grain: one row per task (accumulating snapshot — milestones filled in as they happen)
CREATE TABLE fact_task (
    task_id            VARCHAR PRIMARY KEY,
    task_key           VARCHAR NOT NULL UNIQUE,              -- e.g. PLAT-142
    team_id            VARCHAR NOT NULL REFERENCES dim_team(team_id),
    project_id         VARCHAR NOT NULL REFERENCES dim_project(project_id),
    creator_id         VARCHAR NOT NULL REFERENCES dim_user(user_id),
    assignee_id        VARCHAR REFERENCES dim_user(user_id),
    status             VARCHAR NOT NULL,
    priority           VARCHAR NOT NULL,
    estimate_hours     DOUBLE,
    created_at         TIMESTAMPTZ NOT NULL,
    created_date_key   INTEGER NOT NULL REFERENCES dim_date(date_key),
    started_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    completed_date_key INTEGER REFERENCES dim_date(date_key),
    due_date           TIMESTAMPTZ,
    is_open            BOOLEAN NOT NULL,
    is_overdue         BOOLEAN NOT NULL,
    is_deleted         BOOLEAN NOT NULL,
    wait_time_hours    DOUBLE,     -- created -> started
    cycle_time_hours   DOUBLE,     -- started -> completed
    lead_time_hours    DOUBLE,     -- created -> completed
    completed_on_time  BOOLEAN,    -- NULL when no due date or not done
    reopen_count       INTEGER NOT NULL,
    comment_count      INTEGER NOT NULL,
    review_rounds      INTEGER NOT NULL,
    blocked_count      INTEGER NOT NULL
);

-- Grain: one row per change to a task (transaction fact, append-only source)
CREATE TABLE fact_task_event (
    event_id          VARCHAR PRIMARY KEY,
    task_id           VARCHAR NOT NULL REFERENCES fact_task(task_id),
    team_id           VARCHAR NOT NULL REFERENCES dim_team(team_id),
    project_id        VARCHAR NOT NULL REFERENCES dim_project(project_id),
    actor_id          VARCHAR NOT NULL REFERENCES dim_user(user_id),
    event_type        VARCHAR NOT NULL,
    from_status       VARCHAR,
    to_status         VARCHAR,
    from_assignee_id  VARCHAR,
    to_assignee_id    VARCHAR,
    from_value        VARCHAR,
    to_value          VARCHAR,
    priority_at_event VARCHAR,
    assignee_at_event VARCHAR,
    event_at          TIMESTAMPTZ NOT NULL,
    event_date_key    INTEGER NOT NULL REFERENCES dim_date(date_key)
);

-- Grain: one row per continuous stint of a task in a status (derived with LEAD())
CREATE TABLE fact_status_interval (
    task_id           VARCHAR NOT NULL REFERENCES fact_task(task_id),
    team_id           VARCHAR NOT NULL REFERENCES dim_team(team_id),
    seq               INTEGER NOT NULL,
    status            VARCHAR NOT NULL,
    priority_at_entry VARCHAR,
    assignee_at_entry VARCHAR,
    entered_at        TIMESTAMPTZ NOT NULL,
    exited_at         TIMESTAMPTZ,              -- NULL = still in this status
    entered_date_key  INTEGER NOT NULL REFERENCES dim_date(date_key),
    duration_hours    DOUBLE NOT NULL CHECK (duration_hours >= 0),
    is_current        BOOLEAN NOT NULL,
    PRIMARY KEY (task_id, seq)
);

-- Many-to-many: tasks <-> labels
CREATE TABLE bridge_task_label (
    task_id  VARCHAR NOT NULL REFERENCES fact_task(task_id),
    label    VARCHAR NOT NULL,
    PRIMARY KEY (task_id, label)
);
