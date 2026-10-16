// Shared helpers for projects, tasks and time tracking.
import { addDays, parseYmd, ymd } from '../lib/util.js';

export const PROJECT_STATUSES = ['Planning', 'Active', 'On hold', 'Done'];
export const TASK_STATUSES = ['To do', 'In progress', 'Review', 'Done'];
export const PROJECT_COLOR = {
  Planning: 'var(--st-draft)', Active: 'var(--st-approved)', 'On hold': 'var(--st-review)', Done: 'var(--st-published)'
};
export const TASK_COLOR = {
  'To do': 'var(--st-draft)', 'In progress': 'var(--st-approved)', Review: 'var(--st-review)', Done: 'var(--st-published)'
};

// 95 → "1h 35m", 0 → "0h"
export function fmtMinutes(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h && !r) return '0h';
  return (h ? h + 'h' : '') + (h && r ? ' ' : '') + (r ? r + 'm' : '');
}

// Hours as a short decimal: 95 → "1.58"
export function hoursDecimal(min) {
  return String(Math.round(((Number(min) || 0) / 60) * 100) / 100);
}

// Accepts "1:30", "1.5", "90m", "2h", "1h 30m", "45" (minutes if no unit and over 12).
export function parseDuration(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return 0;
  let m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/.exec(t);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] || 0) * 60) + Number(m[2] || 0);
  const n = Number(t);
  if (n > 0) return n > 12 ? Math.round(n) : Math.round(n * 60);
  return 0;
}

export function durationText(min) {
  const m = Math.round(Number(min) || 0);
  return m ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : '';
}

export function elapsedSeconds(startedAt, now) {
  return Math.max(0, Math.floor(((now || Date.now()) - new Date(startedAt).getTime()) / 1000));
}

export function clock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

export function entryMinutes(e, now) {
  return e.startedAt ? Math.floor(elapsedSeconds(e.startedAt, now) / 60) : e.minutes;
}

export function personName(team, email) {
  if (!email) return '';
  const t = (team || []).find((x) => x.email === email);
  return t ? t.name : email;
}

export function weekStart(day) {
  const d = parseYmd(day);
  const shift = (d.getDay() + 6) % 7; // Monday first
  d.setDate(d.getDate() - shift);
  return ymd(d);
}

export function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function projectStats(project, tasks, entries, today) {
  const ts = tasks.filter((t) => t.projectId === project.id);
  const es = entries.filter((e) => e.projectId === project.id);
  const done = ts.filter((t) => t.status === 'Done').length;
  const minutes = es.reduce((n, e) => n + (e.startedAt ? 0 : e.minutes), 0);
  const unbilled = es.filter((e) => e.billable && !e.invoiceId && !e.startedAt).reduce((n, e) => n + e.minutes, 0);
  const estimate = ts.reduce((n, t) => n + (Number(t.estimateHours) || 0), 0);
  const overdueTasks = ts.filter((t) => t.status !== 'Done' && t.dueDate && t.dueDate < today).length;
  return {
    total: ts.length, done, pct: ts.length ? Math.round((done / ts.length) * 100) : 0,
    minutes, unbilled, estimateHours: estimate, overdueTasks,
    overdue: project.status !== 'Done' && Boolean(project.dueDate) && project.dueDate < today
  };
}

// Time tracking is switched on per client in Client settings.
export function trackingOn(clientsById, clientId) {
  const c = clientsById[clientId];
  return Boolean(c && c.timeTracking);
}

// The client a project belongs to, plus its main client for display.
export function clientLabel(clientsById, clientId) {
  const c = clientsById[clientId];
  if (!c) return { name: 'Unknown client', color: '' };
  const parent = c.parentId ? clientsById[c.parentId] : null;
  return { name: parent ? parent.name + ' / ' + c.name : c.name, color: c.color, client: c };
}
