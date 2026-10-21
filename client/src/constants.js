export const STATUSES = [
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'in_review', label: 'In review' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done', label: 'Done' },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
export const PRIORITIES = ['urgent', 'high', 'medium', 'low'];

export const fmtHours = (h) => {
  if (h === null || h === undefined) return '–';
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
};

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

export const isOverdue = (t) => Boolean(t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date());

export const initials = (name = '') =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
