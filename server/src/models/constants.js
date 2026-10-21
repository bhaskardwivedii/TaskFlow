// Single source of truth for enumerations. Shared by Mongoose models, the
// $jsonSchema validators, the seed generator and the analytics pipelines.

export const GLOBAL_ROLES = ['admin', 'manager', 'member'];
export const TEAM_ROLES = ['lead', 'member', 'viewer'];

export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
export const OPEN_STATUSES = ['todo', 'in_progress', 'in_review', 'blocked'];
export const ACTIVE_STATUSES = ['in_progress', 'in_review', 'blocked']; // work has started

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const PRIORITY_WEIGHT = { low: 1, medium: 2, high: 3, urgent: 5 };

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'archived'];

export const EVENT_TYPES = [
  'created',
  'status_changed',
  'assigned',
  'priority_changed',
  'due_date_changed',
  'estimate_changed',
  'commented',
  'deleted',
  'restored',
];

export const NOTIFICATION_TYPES = ['task_assigned', 'task_status', 'task_comment', 'task_due_soon', 'mention'];
