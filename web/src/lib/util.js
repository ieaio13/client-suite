export const STATUSES = ['Draft', 'In Review', 'Approved', 'Scheduled', 'Published'];
export const PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'X'];
export const LOCKED_FOR_CLIENTS = ['Scheduled', 'Published'];
export const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b'];
export const STATUS_VAR = {
  Draft: 'var(--st-draft)', 'In Review': 'var(--st-review)', Approved: 'var(--st-approved)',
  Scheduled: 'var(--st-scheduled)', Published: 'var(--st-published)'
};

export const cx = (...a) => a.filter(Boolean).join(' ');
export const statusClass = (s) => 'st-' + String(s || 'Draft').replace(/\s+/g, '-');

/* ---------- Dates (all yyyy-MM-dd strings, local) ---------- */
export function parseYmd(s) {
  const p = String(s || '').split('-').map(Number);
  return p.length === 3 && p[0] ? new Date(p[0], p[1] - 1, p[2], 12) : new Date();
}
export function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function todayYmd() { return ymd(new Date()); }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(s) { const d = parseYmd(s); return MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
export function prettyDate(s) {
  if (!s) return 'No date';
  const d = parseYmd(s);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function shortDate(s) {
  if (!s) return '—';
  return parseYmd(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export function stamp(v) {
  if (!v) return '';
  const [d, t] = String(v).split('T');
  return shortDate(d) + (t ? ' · ' + t.slice(0, 5) : '');
}
export function relDay(s, today) {
  if (!s) return 'No date';
  const diff = Math.round((parseYmd(s) - parseYmd(today)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return prettyDate(s);
}

/* ---------- Money ---------- */
export function money(amount, currency) {
  const n = Number(amount || 0);
  return (currency || 'USD') + ' ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function invoiceTotals(inv) {
  const items = inv.items || [];
  let subtotal = 0;
  for (const it of items) subtotal += Number(it.qty || 0) * Number(it.rate || 0);
  const discount = Number(inv.discount || 0);
  const after = Math.max(0, subtotal - discount);
  const tax = after * (Number(inv.taxPct || 0) / 100);
  return { subtotal, discount, tax, total: after + tax };
}
export function isOverdue(inv, today) {
  return inv.status !== 'Paid' && Boolean(inv.dueDate) && inv.dueDate < today;
}
export function sumByCurrency(list, pick) {
  const m = {};
  for (const x of list) {
    const cur = x.currency || 'USD';
    m[cur] = (m[cur] || 0) + pick(x);
  }
  const keys = Object.keys(m);
  return keys.length ? keys.map((k) => money(m[k], k)).join(' · ') : money(0, 'USD');
}

/* ---------- Posts ---------- */
export function postCover(p) {
  if (p.assets && p.assets.length) return { asset: p.assets[0], isRef: false, count: p.assets.length };
  if (p.refAssets && p.refAssets.length) return { asset: p.refAssets[0], isRef: true, count: p.refAssets.length };
  return null;
}
export function sortClients(list) {
  return list.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.name.localeCompare(b.name));
}
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts[0] || '').charAt(0) + (parts[1] || '').charAt(0)).toUpperCase() || '?';
}
export function formatBytes(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}
export function filterPosts(posts, f, { portal } = {}) {
  const q = String(f.search || '').trim().toLowerCase();
  return posts.filter((p) => {
    if (f.status && p.status !== f.status) return false;
    if (f.platform && !p.platforms.includes(f.platform)) return false;
    if (f.tag && !p.tags.includes(f.tag)) return false;
    if (!portal && f.assignee) {
      if (f.assignee === '__none__' ? p.assignee : p.assignee !== f.assignee) return false;
    }
    if (q && ((p.text || '') + ' ' + p.tags.join(' ')).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}
