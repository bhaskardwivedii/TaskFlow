-- =====================================================================
-- TaskFlow — analysis queries
-- Each block starts with "-- name:" (used by run_analysis.py) and a
-- "-- question:" line stating the business question it answers.
-- =====================================================================

-- name: 01_kpi_overview
-- question: What does delivery look like per team over the last 90 days?
WITH params AS (SELECT (SELECT MAX(event_at) FROM fact_task_event) AS as_of),
done AS (
    SELECT t.*
    FROM fact_task t, params p
    WHERE t.completed_at >= p.as_of - INTERVAL 90 DAY AND NOT t.is_deleted
)
SELECT
    tm.team_name,
    COUNT(*)                                                         AS completed_90d,
    ROUND(COUNT(*) / 13.0, 1)                                        AS per_week,
    ROUND(PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY d.cycle_time_hours) / 24, 1) AS median_cycle_days,
    ROUND(PERCENTILE_CONT(0.85) WITHIN GROUP (ORDER BY d.cycle_time_hours) / 24, 1) AS p85_cycle_days,
    ROUND(AVG(CASE WHEN d.completed_on_time THEN 1.0 WHEN d.completed_on_time = FALSE THEN 0.0 END), 3) AS on_time_rate,
    ROUND(AVG(CASE WHEN d.reopen_count > 0 THEN 1.0 ELSE 0.0 END), 3) AS reopen_rate
FROM done d
JOIN dim_team tm USING (team_id)
GROUP BY tm.team_name
ORDER BY completed_90d DESC;

-- name: 02_weekly_throughput_trend
-- question: Is throughput keeping up with demand? (rolling average + week-over-week change)
WITH weeks AS (
    SELECT DATE_TRUNC('week', created_at) AS week, COUNT(*) AS created, 0 AS completed
    FROM fact_task GROUP BY 1
    UNION ALL
    SELECT DATE_TRUNC('week', completed_at), 0, COUNT(*)
    FROM fact_task WHERE completed_at IS NOT NULL GROUP BY 1
),
agg AS (
    SELECT week, SUM(created) AS created, SUM(completed) AS completed
    FROM weeks GROUP BY week
)
SELECT
    CAST(week AS DATE)                                                     AS week,
    created,
    completed,
    created - completed                                                    AS net_backlog_change,
    SUM(created - completed) OVER (ORDER BY week)                          AS backlog_running,
    ROUND(AVG(completed) OVER (ORDER BY week ROWS BETWEEN 3 PRECEDING AND CURRENT ROW), 1) AS completed_4wk_avg,
    ROUND(100.0 * (completed - LAG(completed) OVER (ORDER BY week)) / NULLIF(LAG(completed) OVER (ORDER BY week), 0), 1) AS completed_wow_pct
FROM agg
ORDER BY week DESC
LIMIT 12;

-- name: 03_cycle_time_by_priority
-- question: Do urgent tasks actually finish faster, or do they only START faster?
SELECT
    priority,
    COUNT(*)                                                                    AS n,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wait_time_hours), 1)      AS median_wait_h,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cycle_time_hours), 1)     AS median_cycle_h,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lead_time_hours), 1)      AS median_lead_h,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wait_time_hours)
          / PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lead_time_hours), 2)    AS wait_share_of_lead
FROM fact_task
WHERE status = 'done' AND NOT is_deleted
GROUP BY priority
ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END;

-- name: 04_bottleneck_time_in_status
-- question: Where does work sit idle? Time spent per status, per team.
SELECT
    tm.team_name,
    i.status,
    COUNT(*)                                                               AS stints,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY i.duration_hours), 1) AS median_h,
    ROUND(SUM(i.duration_hours) / SUM(SUM(i.duration_hours)) OVER (PARTITION BY tm.team_name), 3) AS share_of_team_time
FROM fact_status_interval i
JOIN dim_team tm USING (team_id)
WHERE NOT i.is_current
GROUP BY tm.team_name, i.status
QUALIFY RANK() OVER (PARTITION BY tm.team_name ORDER BY SUM(i.duration_hours) DESC) <= 2
ORDER BY tm.team_name, share_of_team_time DESC;

-- name: 05_rework_and_quality
-- question: Which teams produce rework — review bounce-backs, reopens, blockers?
SELECT
    tm.team_name,
    COUNT(*) FILTER (WHERE e.to_status = 'done')                                            AS completions,
    ROUND(COUNT(*) FILTER (WHERE e.from_status = 'in_review' AND e.to_status = 'in_progress')
        * 1.0 / NULLIF(COUNT(*) FILTER (WHERE e.from_status = 'in_review'), 0), 3)            AS review_bounce_rate,
    ROUND(COUNT(*) FILTER (WHERE e.from_status = 'done')
        * 1.0 / NULLIF(COUNT(*) FILTER (WHERE e.to_status = 'done'), 0), 3)                   AS reopen_rate,
    ROUND(COUNT(*) FILTER (WHERE e.to_status = 'blocked')
        * 1.0 / NULLIF(COUNT(*) FILTER (WHERE e.to_status = 'done'), 0), 3)                   AS blocks_per_completion
FROM fact_task_event e
JOIN dim_team tm USING (team_id)
WHERE e.event_type = 'status_changed'
GROUP BY tm.team_name
ORDER BY review_bounce_rate DESC;

-- name: 06_workload_concentration
-- question: Is work concentrated on a few people? (share of team completions, rank within team)
WITH per_person AS (
    SELECT t.team_id, t.assignee_id, COUNT(*) AS completed
    FROM fact_task t
    WHERE t.status = 'done' AND t.assignee_id IS NOT NULL
    GROUP BY 1, 2
)
SELECT
    tm.team_name,
    u.name,
    p.completed,
    ROUND(p.completed * 1.0 / SUM(p.completed) OVER (PARTITION BY p.team_id), 3) AS share_of_team,
    ROUND(1.0 / COUNT(*) OVER (PARTITION BY p.team_id), 3)                         AS fair_share,
    RANK() OVER (PARTITION BY p.team_id ORDER BY p.completed DESC)                  AS rank_in_team
FROM per_person p
JOIN dim_team tm ON tm.team_id = p.team_id
JOIN dim_user u ON u.user_id = p.assignee_id
QUALIFY rank_in_team = 1
ORDER BY share_of_team DESC;

-- name: 07_friday_effect
-- question: Does the weekday a task is created on change how long it waits before work starts?
SELECT
    d.day_name                                                               AS created_on,
    COUNT(*)                                                                 AS tasks,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.wait_time_hours), 1) AS median_wait_h,
    ROUND(AVG(t.wait_time_hours), 1)                                         AS avg_wait_h
FROM fact_task t
JOIN dim_date d ON d.date_key = t.created_date_key
WHERE t.started_at IS NOT NULL AND NOT d.is_weekend
GROUP BY d.day_name, d.day_of_week
ORDER BY d.day_of_week;

-- name: 08_creation_cohorts
-- question: Of tasks created each month, what share was done within 7 / 14 / 30 days?
SELECT
    d.year || '-' || LPAD(CAST(d.month AS VARCHAR), 2, '0')                  AS cohort_month,
    COUNT(*)                                                                  AS created,
    ROUND(AVG(CASE WHEN t.lead_time_hours <= 7 * 24  THEN 1.0 ELSE 0 END), 3) AS done_within_7d,
    ROUND(AVG(CASE WHEN t.lead_time_hours <= 14 * 24 THEN 1.0 ELSE 0 END), 3) AS done_within_14d,
    ROUND(AVG(CASE WHEN t.lead_time_hours <= 30 * 24 THEN 1.0 ELSE 0 END), 3) AS done_within_30d
FROM fact_task t
JOIN dim_date d ON d.date_key = t.created_date_key
WHERE NOT t.is_deleted
GROUP BY d.year, d.month
ORDER BY d.year, d.month;

-- name: 09_sla_breach_drivers
-- question: Which kinds of work miss their due date? (priority x estimate size)
SELECT
    priority,
    CASE WHEN estimate_hours IS NULL THEN 'unestimated'
         WHEN estimate_hours <= 3 THEN 'small (<=3h)'
         WHEN estimate_hours <= 8 THEN 'medium (5-8h)'
         ELSE 'large (13h+)' END                                     AS size,
    COUNT(*)                                                         AS tasks_with_due_date,
    ROUND(1 - AVG(CASE WHEN completed_on_time THEN 1.0 ELSE 0 END), 3) AS breach_rate
FROM fact_task
WHERE completed_on_time IS NOT NULL
GROUP BY 1, 2
HAVING COUNT(*) >= 15
ORDER BY breach_rate DESC
LIMIT 10;

-- name: 10_reassignment_impact
-- question: Do tasks that change hands take longer?
WITH reassigned AS (
    SELECT task_id, COUNT(*) AS handoffs
    FROM fact_task_event
    WHERE event_type = 'assigned' AND from_assignee_id IS NOT NULL
    GROUP BY task_id
)
SELECT
    CASE WHEN r.task_id IS NULL THEN 'single owner' ELSE 'reassigned' END    AS ownership,
    COUNT(*)                                                                 AS tasks,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.cycle_time_hours), 1) AS median_cycle_h,
    ROUND(AVG(t.review_rounds), 2)                                           AS avg_review_rounds
FROM fact_task t
LEFT JOIN reassigned r USING (task_id)
WHERE t.status = 'done'
GROUP BY 1;

-- name: 11_label_mix
-- question: What kind of work is each team doing? (bridge table, pivoted)
SELECT
    tm.team_name,
    COUNT(*) FILTER (WHERE b.label = 'bug')        AS bug,
    COUNT(*) FILTER (WHERE b.label = 'feature')    AS feature,
    COUNT(*) FILTER (WHERE b.label = 'tech-debt')  AS tech_debt,
    COUNT(*) FILTER (WHERE b.label = 'security')   AS security,
    COUNT(*) FILTER (WHERE b.label = 'performance') AS performance,
    COUNT(*)                                       AS total_labels
FROM bridge_task_label b
JOIN fact_task t USING (task_id)
JOIN dim_team tm USING (team_id)
GROUP BY tm.team_name
ORDER BY total_labels DESC;

-- name: 12_data_quality_checks
-- question: Is the data trustworthy? Every check should return 0.
SELECT 'done task without completed_at' AS check_name, COUNT(*) AS violations FROM fact_task WHERE status = 'done' AND completed_at IS NULL
UNION ALL SELECT 'completed before started', COUNT(*) FROM fact_task WHERE completed_at < started_at
UNION ALL SELECT 'started before created', COUNT(*) FROM fact_task WHERE started_at < created_at
UNION ALL SELECT 'task status != last status event', COUNT(*) FROM (
    SELECT t.task_id
    FROM fact_task t
    JOIN (
        SELECT task_id, to_status,
               ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY event_at DESC, event_type = 'created') AS rn
        FROM fact_task_event WHERE to_status IS NOT NULL
    ) last ON last.task_id = t.task_id AND last.rn = 1
    WHERE last.to_status <> t.status
)
UNION ALL SELECT 'task without created event', COUNT(*) FROM fact_task t
    WHERE NOT EXISTS (SELECT 1 FROM fact_task_event e WHERE e.task_id = t.task_id AND e.event_type = 'created')
UNION ALL SELECT 'assignee not in task team', COUNT(*) FROM fact_task t JOIN dim_user u ON u.user_id = t.assignee_id
    WHERE u.team_id IS DISTINCT FROM t.team_id
UNION ALL SELECT 'duplicate task keys', COUNT(*) - COUNT(DISTINCT task_key) FROM fact_task;
