import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * daily_team_stats — periodic snapshot fact table, one row per team per day.
 * Built by an aggregation pipeline ending in $merge (see analytics/pipelines.js
 * `dailyTeamSnapshot`). Dashboards read this instead of re-scanning tasks.
 * Idempotent: re-running a day overwrites that day's row.
 */
const dailyTeamStatSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    day: { type: Date, required: true }, // local midnight in ANALYTICS_TZ, stored as UTC instant
    created: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    reopened: { type: Number, default: 0 },
    statusChanges: { type: Number, default: 0 },
    activeUsers: { type: Number, default: 0 },
    computedAt: { type: Date, default: Date.now },
  },
  { collection: 'daily_team_stats', versionKey: false },
);

dailyTeamStatSchema.index({ teamId: 1, day: 1 }, { unique: true }); // also required by $merge `on`

export const DailyTeamStat = mongoose.model('DailyTeamStat', dailyTeamStatSchema);
