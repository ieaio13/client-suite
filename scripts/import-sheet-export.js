// Imports the JSON produced by exportForMigration() (Apps Script) into Supabase.
// Usage: node scripts/import-sheet-export.js path/to/client-suite-export.json
// Safe to re-run: rows are upserted by primary key.
import fs from 'node:fs';
import { db, q } from '../lib/db.js';

try {
  process.loadEnvFile('.env');
} catch (e) {}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import-sheet-export.js path/to/export.json');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const STATUSES = ['Draft', 'In Review', 'Approved', 'Scheduled', 'Published'];

const rows = (tab) => (Array.isArray(data[tab]) ? data[tab] : []);
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const json = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch (e) {
    return fallback;
  }
};
const driveView = (id) => 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view';

async function upsert(table, items, onConflict) {
  for (let i = 0; i < items.length; i += 500) {
    q(await db().from(table).upsert(items.slice(i, i + 500), { onConflict }));
  }
  console.log(table.padEnd(10) + items.length + ' rows');
}

// Settings
await upsert('settings', rows('Settings').filter((r) => r.key).map((r) => ({
  key: r.key, value: r.value || ''
})), 'key');

// Team (old SHA-256 hashes keep working and are upgraded to scrypt on first sign-in)
await upsert('team', rows('Team').filter((r) => r.email).map((r) => ({
  email: r.email.trim().toLowerCase(),
  name: r.name || r.email,
  role: ['Admin', 'Account Manager', 'Designer'].includes(r.role) ? r.role : 'Designer',
  pass_hash: r.passHash,
  salt: r.salt
})), 'email');

// Clients — parents before sub-clients so the parent_id foreign key is satisfied
const clientRow = (r) => ({
  id: r.id,
  name: r.name || 'Client',
  parent_id: r.parentId || null,
  token: r.token || null,
  notify_email: r.notifyEmail || '',
  currency: r.currency || '',
  archived: r.archived === 'true',
  created_at: r.createdAt || ''
});
const clients = rows('Clients').filter((r) => r.id);
const clientIds = new Set(clients.map((r) => r.id));
await upsert('clients', clients.filter((r) => !r.parentId).map(clientRow), 'id');
await upsert('clients', clients.filter((r) => r.parentId && clientIds.has(r.parentId)).map(clientRow), 'id');

// Posts — existing media stays on Google Drive (src: 'drive')
const posts = rows('Posts').filter((r) => r.id && clientIds.has(r.clientId));
const postIds = new Set(posts.map((r) => r.id));
await upsert('posts', posts.map((r) => ({
  id: r.id,
  client_id: r.clientId,
  text: r.text || '',
  status: STATUSES.includes(r.status) ? r.status : 'Draft',
  tags: list(r.tags),
  platforms: list(r.platforms),
  date: r.date || '',
  time: r.time || '',
  assets: json(r.assets, []).filter((a) => a && a.id).map((a) => ({
    id: String(a.id),
    type: a.type === 'video' ? 'video' : (a.type === 'link' ? 'link' : 'image'),
    name: a.name || 'Asset',
    src: 'drive'
  })),
  live_url: r.liveUrl || '',
  metrics: json(r.metrics, {}),
  assignee: r.assignee || '',
  created_at: r.createdAt || '',
  updated_at: r.updatedAt || ''
})), 'id');

await upsert('comments', rows('Comments').filter((r) => r.id && postIds.has(r.postId) && clientIds.has(r.clientId)).map((r) => ({
  id: r.id,
  post_id: r.postId,
  client_id: r.clientId,
  author: r.author || '',
  role: r.role || '',
  text: r.text || '',
  created_at: r.createdAt || ''
})), 'id');

await upsert('activity', rows('Activity').filter((r) => r.id && clientIds.has(r.clientId)).map((r) => ({
  id: r.id,
  post_id: r.postId || '',
  client_id: r.clientId,
  actor: r.actor || '',
  action: r.action || '',
  details: r.details || '',
  created_at: r.createdAt || ''
})), 'id');

// Invoices — previously generated PDFs keep pointing at their Drive copies
await upsert('invoices', rows('Invoices').filter((r) => r.id && r.number && clientIds.has(r.clientId)).map((r) => ({
  id: r.id,
  client_id: r.clientId,
  number: r.number,
  issue_date: r.issueDate || '',
  due_date: r.dueDate || '',
  status: r.status === 'Paid' ? 'Paid' : 'Pending',
  currency: r.currency || 'USD',
  items: json(r.items, []),
  tax_pct: r.taxPct || '',
  discount: r.discount || '',
  notes: r.notes || '',
  pdf_file_id: r.pdfFileId || '',
  pdf_url: r.pdfFileId ? driveView(r.pdfFileId) : '',
  sent_at: r.sentAt || '',
  created_at: r.createdAt || '',
  updated_at: r.updatedAt || ''
})), 'id');

const skippedPosts = rows('Posts').length - posts.length;
console.log('Done.' + (skippedPosts ? ' Skipped ' + skippedPosts + ' posts whose client no longer exists.' : ''));
