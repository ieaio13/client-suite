/**
 * Client Operations & Content Suite — Backend
 * Port of Code.gs. Single RPC entry point: dispatch(action, auth, payload).
 */
import { db, q, all, publicUrl, BUCKET } from './db.js';
import {
  AppError, fail, nowIso, todayStr, addDaysStr, newId, randomToken, sha256Hex, safeEqual,
  hashPassword, verifyPassword, escapeHtml
} from './util.js';
import { sendEmail } from './email.js';
import { buildInvoicePdf } from './pdf.js';

const STATUSES = ['Draft', 'In Review', 'Approved', 'Scheduled', 'Published'];
const PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'X'];
const ROLES = ['Admin', 'Account Manager', 'Designer'];
const BILLING = ['Admin', 'Account Manager'];
const EDITORS = ['Admin', 'Account Manager', 'Designer'];
const DEFAULT_NAME = 'Client Operations & Content Suite';
const SESSION_DAYS = 30;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_LOGIN_FAILS = 8;

const ACTIONS = {
  boot: (auth) => handleBoot(auth),
  setupAdmin: (auth, p) => handleSetupAdmin(p),
  login: (auth, p) => handleLogin(p),
  logout: (auth) => handleLogout(auth),
  changePassword: handleChangePassword,
  saveClient: handleSaveClient,
  archiveClient: handleArchiveClient,
  deleteClient: handleDeleteClient,
  manageClientToken: handleManageClientToken,
  savePost: handleSavePost,
  movePost: handleMovePost,
  deletePost: handleDeletePost,
  createUpload: handleCreateUpload,
  resolveDriveLink: handleResolveDriveLink,
  addComment: handleAddComment,
  clientDecision: handleClientDecision,
  saveInvoice: handleSaveInvoice,
  setInvoiceStatus: handleSetInvoiceStatus,
  deleteInvoice: handleDeleteInvoice,
  generateInvoicePdf: (auth, p) => handleInvoicePdf(auth, p, false),
  sendInvoice: (auth, p) => handleInvoicePdf(auth, p, true),
  saveTeamAndSettings: handleSaveTeamAndSettings
};

export async function dispatch(action, auth, payload) {
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  if (!fn) return { ok: false, error: 'Unknown action: ' + action, code: 'BAD_ACTION' };
  try {
    return { ok: true, data: await fn(auth || {}, payload || {}) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message, code: err.code };
    console.error('[' + action + ']', err);
    return { ok: false, error: 'Something went wrong on the server. Please try again.', code: 'ERROR' };
  }
}

/* ==========================================================================
   CORE HELPERS
   ========================================================================== */

function appUrl() {
  return String(process.env.APP_URL || '').replace(/\/+$/, '');
}

function portalLink(token) {
  return appUrl() + '/?t=' + token;
}

const SETTINGS_DEFAULTS = {
  agencyName: DEFAULT_NAME,
  agencyEmail: '',
  defaultCurrency: 'USD',
  dueDays: '14'
};

async function getSettings() {
  const rows = q(await db().from('settings').select('key,value'));
  const map = { ...SETTINGS_DEFAULTS };
  for (const r of rows) {
    if (r.key in map) map[r.key] = r.value || '';
  }
  return map;
}

async function saveSettings(map) {
  const rows = Object.keys(SETTINGS_DEFAULTS).map((k) => ({
    key: k,
    value: map[k] !== undefined ? String(map[k]) : ''
  }));
  q(await db().from('settings').upsert(rows, { onConflict: 'key' }));
}

async function teamCount() {
  const res = await db().from('team').select('email', { count: 'exact', head: true });
  if (res.error) throw res.error;
  return res.count || 0;
}

async function getClientRow(id) {
  if (!id) return null;
  return q(await db().from('clients').select('*').eq('id', id).maybeSingle());
}

async function getPostRow(id) {
  if (!id) return null;
  return q(await db().from('posts').select('*').eq('id', id).maybeSingle());
}

async function getInvoiceRow(id) {
  if (!id) return null;
  return q(await db().from('invoices').select('*').eq('id', id).maybeSingle());
}

function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

/* ---------- Assets ---------- */

// Stored asset shape: { id, type, name, src } where src is 'storage' (Supabase
// Storage path) or 'drive' (Google Drive file id, from the old app or a pasted link).
function sanitizeAssets(raw) {
  const out = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    if (!a || !a.id) continue;
    const id = String(a.id).trim();
    const type = a.type === 'video' ? 'video' : (a.type === 'link' ? 'link' : 'image');
    const name = String(a.name || 'Asset').slice(0, 200);
    if (a.src === 'storage') {
      if (!/^posts\/[\w-]+\/[\w.-]+$/.test(id)) continue;
      out.push({ id, type, name, src: 'storage' });
    } else {
      if (!/^[-\w]{10,}$/.test(id)) continue;
      out.push({ id, type, name, src: 'drive' });
    }
  }
  return out;
}

function enrichAsset(a) {
  if (!a || !a.id) return null;
  const id = String(a.id).trim();
  const type = a.type === 'video' ? 'video' : (a.type === 'link' ? 'link' : 'image');
  const name = a.name || 'File';
  if (a.src === 'storage') {
    const url = publicUrl(id);
    return { id, type, name, src: 'storage', thumbUrl: type === 'image' ? url : '', viewUrl: url, previewUrl: url };
  }
  const enc = encodeURIComponent(id);
  return {
    id, type, name, src: 'drive',
    thumbUrl: 'https://drive.google.com/thumbnail?id=' + enc + '&sz=w1200',
    viewUrl: 'https://drive.google.com/file/d/' + enc + '/view',
    previewUrl: 'https://drive.google.com/file/d/' + enc + '/preview'
  };
}

function normalizeMetrics(m) {
  m = m || {};
  return { reach: str(m.reach), likes: str(m.likes), comments: str(m.comments), shares: str(m.shares) };
}

/* ---------- Row → API shapes (same field names the old frontend used) ---------- */

function clientOut(c, isBilling) {
  return {
    id: c.id,
    name: c.name,
    parentId: c.parent_id || '',
    token: isBilling ? (c.token || '') : '',
    hasToken: Boolean(c.token),
    notifyEmail: c.notify_email || '',
    currency: c.currency || '',
    archived: Boolean(c.archived),
    createdAt: c.created_at || ''
  };
}

function postOut(p, isClientPortal) {
  const out = {
    id: p.id,
    clientId: p.client_id,
    text: p.text || '',
    status: p.status || 'Draft',
    tags: p.tags || [],
    platforms: p.platforms || [],
    date: p.date || '',
    time: p.time || '',
    assets: (p.assets || []).map(enrichAsset).filter(Boolean),
    liveUrl: p.live_url || '',
    createdAt: p.created_at || '',
    updatedAt: p.updated_at || ''
  };
  if (!isClientPortal) {
    out.assignee = p.assignee || '';
    out.metrics = normalizeMetrics(p.metrics);
  }
  return out;
}

function commentOut(c) {
  return {
    id: c.id, postId: c.post_id, clientId: c.client_id,
    author: c.author, role: c.role, text: c.text, createdAt: c.created_at
  };
}

function activityOut(a) {
  return {
    id: a.id, postId: a.post_id, clientId: a.client_id,
    actor: a.actor, action: a.action, details: a.details, createdAt: a.created_at
  };
}

function invoiceOut(inv, settings) {
  return {
    id: inv.id,
    clientId: inv.client_id,
    number: inv.number,
    issueDate: inv.issue_date,
    dueDate: inv.due_date,
    status: inv.status || 'Pending',
    currency: inv.currency || settings.defaultCurrency || 'USD',
    items: inv.items || [],
    taxPct: inv.tax_pct || '',
    discount: inv.discount || '',
    notes: inv.notes || '',
    pdfFileId: inv.pdf_file_id || '',
    pdfUrl: inv.pdf_url || '',
    sentAt: inv.sent_at || '',
    createdAt: inv.created_at || '',
    updatedAt: inv.updated_at || ''
  };
}

/* ==========================================================================
   AUTHENTICATION & PERMISSION HELPERS
   ========================================================================== */

async function requireAgencyAuth(auth, allowedRoles) {
  const raw = auth && auth.sessionToken ? String(auth.sessionToken) : '';
  if (!raw) fail('Your session has expired. Please sign in again.', 'AUTH');
  const tokenHash = sha256Hex(raw);

  const session = q(await db().from('sessions').select('email,expires_at').eq('token_hash', tokenHash).maybeSingle());
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    fail('Your session has expired. Please sign in again.', 'AUTH');
  }
  const user = q(await db().from('team').select('email,name,role').eq('email', session.email).maybeSingle());
  if (!user) fail('Your account is no longer active.', 'AUTH');

  if (allowedRoles && allowedRoles.length > 0 && allowedRoles.indexOf(user.role) === -1) {
    fail('You do not have permission to perform this action.', 'FORBIDDEN');
  }
  return { email: user.email, name: user.name, role: user.role, tokenHash };
}

async function requireClientTokenAuth(auth, targetClientId) {
  const token = auth && auth.clientToken ? String(auth.clientToken).trim() : '';
  if (!token) fail('Invalid or missing share link.', 'PORTAL_INVALID');

  const root = q(await db().from('clients').select('*').eq('token', token).maybeSingle());
  if (!root) fail('This share link is invalid or has been turned off.', 'PORTAL_INVALID');
  if (root.archived) fail('This client workspace is archived.', 'PORTAL_ARCHIVED');

  if (root.parent_id) {
    const parent = await getClientRow(root.parent_id);
    if (parent && parent.archived) fail('This client workspace is archived.', 'PORTAL_ARCHIVED');
  }

  // A parent token opens all active sub-clients; a sub-client token opens only itself.
  const allowed = root.parent_id
    ? [root]
    : q(await db().from('clients').select('*').eq('parent_id', root.id).eq('archived', false));

  if (targetClientId && !allowed.some((c) => c.id === targetClientId)) {
    fail('You do not have access to this client.', 'FORBIDDEN');
  }

  const clientMap = {};
  for (const c of allowed) clientMap[c.id] = c;
  clientMap[root.id] = root;
  return { root, allowed, clientMap };
}

async function createSession(email) {
  const raw = randomToken(48);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  q(await db().from('sessions').insert({ token_hash: sha256Hex(raw), email, expires_at: expiresAt }));
  // Housekeeping: drop expired sessions.
  await db().from('sessions').delete().lt('expires_at', new Date().toISOString());
  return raw;
}

/* ==========================================================================
   BOOT & AUTH HANDLERS
   ========================================================================== */

async function handleBoot(auth) {
  const settings = await getSettings();

  // 1. Client portal visit (?t=...)
  if (auth.clientToken) {
    const ctx = await requireClientTokenAuth(auth, null);
    const ids = ctx.allowed.map((c) => c.id);
    const [posts, comments] = ids.length
      ? await Promise.all([
        all('posts', (b) => b.in('client_id', ids)),
        all('comments', (b) => b.in('client_id', ids), ['seq'])
      ])
      : [[], []];

    return {
      mode: 'portal',
      agencyName: settings.agencyName,
      rootClient: { id: ctx.root.id, name: ctx.root.name, isParent: !ctx.root.parent_id },
      clients: ctx.allowed.map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id || '' })),
      posts: posts.map((p) => postOut(p, true)),
      comments: comments.map(commentOut)
    };
  }

  // 2. First run: no team yet
  if ((await teamCount()) === 0) {
    return { mode: 'setup', agencyName: settings.agencyName };
  }

  // 3. Agency session
  if (auth.sessionToken) {
    try {
      const user = await requireAgencyAuth(auth, null);
      return await buildAgencyState(user, settings);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return { mode: 'login', agencyName: settings.agencyName, authError: e.message };
    }
  }

  return { mode: 'login', agencyName: settings.agencyName };
}

async function buildAgencyState(user, settings) {
  const isBilling = BILLING.includes(user.role);
  const isAdmin = user.role === 'Admin';

  const [clients, posts, comments, activity, invoices, team] = await Promise.all([
    all('clients'),
    all('posts'),
    all('comments', null, ['seq']),
    all('activity', null, ['seq']),
    isBilling ? all('invoices') : [],
    all('team', null, ['email'])
  ]);

  return {
    mode: 'agency',
    user: { email: user.email, name: user.name, role: user.role },
    webAppUrl: appUrl(),
    today: todayStr(),
    settings,
    team: team.map((t) => ({ email: t.email, name: t.name, role: t.role })),
    clients: clients.map((c) => clientOut(c, isBilling)),
    posts: posts.map((p) => postOut(p, false)),
    comments: comments.map(commentOut),
    activity: activity.map(activityOut),
    invoices: invoices.map((inv) => invoiceOut(inv, settings)),
    isAdmin,
    isBilling
  };
}

async function handleSetupAdmin(payload) {
  if ((await teamCount()) > 0) {
    fail('Workspace has already been set up. Please sign in.', 'ALREADY_SETUP');
  }
  const stored = String(process.env.SETUP_CODE || '').trim();
  if (!stored) {
    fail('No setup code is configured. Set the SETUP_CODE environment variable on the server and redeploy.', 'NO_SETUP_CODE');
  }
  const input = String(payload.setupCode || '').trim();
  if (!safeEqual(input.toUpperCase(), stored.toUpperCase())) {
    fail('Invalid setup code.', 'BAD_CODE');
  }

  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!name) fail('Please enter your name.', 'VALIDATION');
  if (!email || email.indexOf('@') === -1) fail('Please enter a valid email address.', 'VALIDATION');
  if (password.length < 8) fail('Password must be at least 8 characters.', 'VALIDATION');

  const { salt, passHash } = await hashPassword(password);
  q(await db().from('team').insert({ email, name, role: 'Admin', pass_hash: passHash, salt }));

  const sessionToken = await createSession(email);
  const settings = await getSettings();
  if (!settings.agencyEmail) {
    settings.agencyEmail = email;
    await saveSettings(settings);
  }

  const state = await buildAgencyState({ email, name, role: 'Admin' }, settings);
  state.sessionToken = sessionToken;
  return state;
}

async function handleLogin(payload) {
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!email || !password) fail('Please enter both email and password.', 'VALIDATION');

  const key = 'login_' + sha256Hex(email).substring(0, 24);
  const attempts = q(await db().from('login_attempts').select('count,reset_at').eq('key', key).maybeSingle());
  const windowActive = Boolean(attempts) && new Date(attempts.reset_at).getTime() > Date.now();
  if (windowActive && attempts.count >= MAX_LOGIN_FAILS) {
    fail('Too many failed sign-in attempts for this email. Try again in 15 minutes.', 'LOCKED');
  }

  const member = q(await db().from('team').select('*').eq('email', email).maybeSingle());
  let check = { ok: false, legacy: false };
  if (member) {
    check = await verifyPassword(password, member.salt, member.pass_hash);
  } else {
    await hashPassword(password); // equalize timing for unknown emails
  }

  if (!check.ok) {
    const next = (windowActive ? attempts.count : 0) + 1;
    const resetAt = windowActive ? attempts.reset_at : new Date(Date.now() + 15 * 60000).toISOString();
    q(await db().from('login_attempts').upsert({ key, count: next, reset_at: resetAt }, { onConflict: 'key' }));
    if (next >= MAX_LOGIN_FAILS) {
      fail('Too many failed sign-in attempts. This account is locked for 15 minutes.', 'LOCKED');
    }
    fail('Incorrect email or password.', 'BAD_CREDENTIALS');
  }

  await db().from('login_attempts').delete().eq('key', key);

  // Upgrade passwords imported from the Apps Script version to scrypt.
  if (check.legacy) {
    const h = await hashPassword(password);
    q(await db().from('team').update({ pass_hash: h.passHash, salt: h.salt }).eq('email', email));
  }

  const sessionToken = await createSession(member.email);
  const settings = await getSettings();
  const state = await buildAgencyState({ email: member.email, name: member.name, role: member.role }, settings);
  state.sessionToken = sessionToken;
  return state;
}

async function handleLogout(auth) {
  if (!auth || !auth.sessionToken) return { loggedOut: true };
  q(await db().from('sessions').delete().eq('token_hash', sha256Hex(String(auth.sessionToken))));
  return { loggedOut: true };
}

async function handleChangePassword(auth, payload) {
  const user = await requireAgencyAuth(auth, null);
  const currentPass = String(payload.currentPassword || '');
  const newPass = String(payload.newPassword || '');
  if (newPass.length < 8) fail('New password must be at least 8 characters.', 'VALIDATION');

  const member = q(await db().from('team').select('*').eq('email', user.email).maybeSingle());
  if (!member) fail('Account not found.', 'AUTH');
  const check = await verifyPassword(currentPass, member.salt, member.pass_hash);
  if (!check.ok) fail('Your current password is incorrect.', 'VALIDATION');

  const h = await hashPassword(newPass);
  q(await db().from('team').update({ pass_hash: h.passHash, salt: h.salt }).eq('email', user.email));

  // Sign out all other devices (keep the current session only)
  q(await db().from('sessions').delete().eq('email', user.email).neq('token_hash', user.tokenHash));
  return { changed: true };
}

/* ==========================================================================
   CLIENTS & SHARE LINKS
   ========================================================================== */

async function handleSaveClient(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const id = String(payload.id || '').trim();
  const name = String(payload.name || '').trim();
  const parentId = String(payload.parentId || '').trim();
  const notifyEmail = String(payload.notifyEmail || '').trim();
  const currency = String(payload.currency || '').trim().toUpperCase();
  if (!name) fail('Client name is required.', 'VALIDATION');

  if (id) {
    const updated = q(await db().from('clients')
      .update({ name, notify_email: notifyEmail, currency })
      .eq('id', id).select().maybeSingle());
    if (!updated) fail('Client not found.', 'NOT_FOUND');
    return { client: clientOut(updated, true) };
  }

  if (parentId) {
    const parent = await getClientRow(parentId);
    if (!parent) fail('Parent client not found.', 'VALIDATION');
    if (parent.parent_id) fail('Only one level of client nesting is allowed.', 'VALIDATION');
  }

  const saved = q(await db().from('clients').insert({
    id: newId('cli'),
    name,
    parent_id: parentId || null,
    token: null,
    notify_email: notifyEmail,
    currency,
    archived: false,
    created_at: nowIso()
  }).select().single());
  return { client: clientOut(saved, true) };
}

async function handleArchiveClient(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const clientId = String(payload.clientId || '');
  const archive = Boolean(payload.archive);

  const target = await getClientRow(clientId);
  if (!target) fail('Client not found.', 'NOT_FOUND');

  if (!archive && target.parent_id) {
    const parent = await getClientRow(target.parent_id);
    if (parent && parent.archived) {
      fail('Restore the parent client (' + parent.name + ') before restoring this sub-client.', 'VALIDATION');
    }
  }

  q(await db().from('clients').update({ archived: archive }).eq('id', clientId));
  if (archive && !target.parent_id) {
    // Archiving a parent archives its sub-clients
    q(await db().from('clients').update({ archived: true }).eq('parent_id', clientId));
  }
  return { updated: true };
}

async function handleDeleteClient(auth, payload) {
  await requireAgencyAuth(auth, ['Admin']);
  const clientId = String(payload.clientId || '');
  const confirmName = String(payload.confirmName || '').trim();

  const target = await getClientRow(clientId);
  if (!target) fail('Client not found.', 'NOT_FOUND');
  if (confirmName !== target.name) fail('Typed name does not match "' + target.name + '".', 'VALIDATION');

  const children = q(await db().from('clients').select('id').eq('parent_id', clientId));
  // Foreign keys cascade: sub-clients, posts, comments, activity and invoices go with it.
  q(await db().from('clients').delete().eq('id', clientId));
  return { deletedIds: [clientId].concat(children.map((c) => c.id)) };
}

async function handleManageClientToken(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const clientId = String(payload.clientId || '');
  const mode = String(payload.mode || 'create'); // 'create' | 'rotate' | 'disable'
  const newToken = mode === 'disable' ? null : randomToken(64);

  const updated = q(await db().from('clients').update({ token: newToken }).eq('id', clientId).select('id').maybeSingle());
  if (!updated) fail('Client not found.', 'NOT_FOUND');
  return { clientId, token: newToken || '', webAppUrl: appUrl() };
}

/* ==========================================================================
   POSTS, UPLOADS, COMMENTS, PORTAL DECISIONS
   ========================================================================== */

async function logActivity(postId, clientId, actor, action, details) {
  const row = q(await db().from('activity').insert({
    id: newId('act'),
    post_id: postId,
    client_id: clientId,
    actor,
    action,
    details: details || '',
    created_at: nowIso()
  }).select().single());
  return activityOut(row);
}

async function getEffectiveClientEmail(client) {
  if (!client) return '';
  if (client.notify_email) return client.notify_email;
  if (client.parent_id) {
    const parent = await getClientRow(client.parent_id);
    if (parent && parent.notify_email) return parent.notify_email;
  }
  return '';
}

async function ensureClientShareLink(client) {
  if (!client.token) {
    client.token = randomToken(64);
    q(await db().from('clients').update({ token: client.token }).eq('id', client.id));
  }
  return portalLink(client.token);
}

function snippetOf(text) {
  return text ? (text.length > 140 ? text.substring(0, 140) + '…' : text) : '(No copy)';
}

async function notifyInReview(client, postText, verbHtml) {
  try {
    const notifyTo = await getEffectiveClientEmail(client);
    const link = await ensureClientShareLink(client);
    if (!notifyTo) return;
    const settings = await getSettings();
    const html = '<div style="font-family:sans-serif;color:#1e293b;max-width:560px">' +
      '<h2 style="font-size:18px;margin-bottom:8px">A post is ready for your review</h2>' +
      '<p style="color:#475569;font-size:14px;line-height:1.5"><strong>' + escapeHtml(settings.agencyName) + '</strong> ' + verbHtml + ' <strong>In Review</strong> for <strong>' + escapeHtml(client.name) + '</strong>.</p>' +
      '<div style="background:#f8fafc;border-left:4px solid #d4880b;padding:12px 16px;margin:16px 0;font-size:14px">' + escapeHtml(snippetOf(postText)) + '</div>' +
      '<p><a href="' + escapeHtml(link) + '" style="display:inline-block;background:#1f5fd6;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px">Open client portal</a></p>' +
      '</div>';
    await sendEmail({
      to: notifyTo,
      subject: '[' + settings.agencyName + '] Content ready for review — ' + client.name,
      html
    });
  } catch (e) {
    console.error('Review notification failed:', e);
  }
}

async function handleSavePost(auth, payload) {
  const user = await requireAgencyAuth(auth, EDITORS);
  const id = String(payload.id || '').trim();
  const clientId = String(payload.clientId || '').trim();
  if (!clientId) fail('Please select a sub-client for this post.', 'VALIDATION');

  const client = await getClientRow(clientId);
  if (!client) fail('Client not found.', 'NOT_FOUND');

  const status = STATUSES.includes(payload.status) ? payload.status : 'Draft';
  const text = String(payload.text || '');
  const tags = (Array.isArray(payload.tags) ? payload.tags : String(payload.tags || '').split(','))
    .map((t) => String(t).trim()).filter(Boolean);
  const platforms = (Array.isArray(payload.platforms) ? payload.platforms : [])
    .filter((pl) => PLATFORMS.includes(pl));
  const dateStr = String(payload.date || '').trim();
  const timeStr = String(payload.time || '').trim();
  const assignee = String(payload.assignee || '').trim();
  const liveUrl = String(payload.liveUrl || '').trim();
  const assets = sanitizeAssets(payload.assets);
  const metrics = normalizeMetrics(payload.metrics);

  const now = nowIso();
  let saved;
  let oldStatus = null;
  let activity = null;

  if (id) {
    const existing = await getPostRow(id);
    if (!existing) fail('Post not found.', 'NOT_FOUND');
    oldStatus = existing.status;

    const exPlats = (existing.platforms || []).join(', ');
    const newPlats = platforms.join(', ');
    const changes = [];
    if (existing.status !== status) changes.push('Status: ' + existing.status + ' → ' + status);
    if ((existing.text || '') !== text) changes.push('Copy updated');
    if ((existing.date || '') !== dateStr || (existing.time || '') !== timeStr) {
      changes.push('Schedule: ' + ((existing.date || 'Unscheduled') + ' ' + (existing.time || '')).trim() +
        ' → ' + ((dateStr || 'Unscheduled') + ' ' + timeStr).trim());
    }
    if (exPlats !== newPlats) changes.push('Platforms: ' + (exPlats || 'None') + ' → ' + (newPlats || 'None'));
    if ((existing.tags || []).join(', ') !== tags.join(', ')) changes.push('Tags updated');
    if ((existing.assignee || '') !== assignee) {
      changes.push('Assignee: ' + (existing.assignee || 'Unassigned') + ' → ' + (assignee || 'Unassigned'));
    }
    if (JSON.stringify(sanitizeAssets(existing.assets)) !== JSON.stringify(assets)) changes.push('Assets updated');
    if ((existing.live_url || '') !== liveUrl) changes.push('Live URL updated');
    if (JSON.stringify(normalizeMetrics(existing.metrics)) !== JSON.stringify(metrics) && status === 'Published') {
      changes.push('Metrics updated');
    }

    saved = q(await db().from('posts').update({
      text, status, tags, platforms, date: dateStr, time: timeStr, assets,
      live_url: liveUrl, metrics, assignee, updated_at: now
    }).eq('id', id).select().single());

    if (changes.length > 0) {
      activity = await logActivity(id, saved.client_id, user.name, 'updated', changes.join('; '));
    }
  } else {
    saved = q(await db().from('posts').insert({
      id: newId('pst'),
      client_id: clientId,
      text, status, tags, platforms, date: dateStr, time: timeStr, assets,
      live_url: liveUrl, metrics, assignee, created_at: now, updated_at: now
    }).select().single());
    activity = await logActivity(saved.id, clientId, user.name, 'created', 'Created in ' + status);
  }

  const postClient = saved.client_id === client.id ? client : await getClientRow(saved.client_id);
  if (status === 'In Review' && oldStatus !== 'In Review' && postClient) {
    await notifyInReview(postClient, text, 'marked a post as');
  }

  return {
    post: postOut(saved, false),
    activity,
    clientToken: postClient && BILLING.includes(user.role) ? (postClient.token || '') : ''
  };
}

async function handleMovePost(auth, payload) {
  const user = await requireAgencyAuth(auth, EDITORS);
  const target = await getPostRow(String(payload.postId || ''));
  if (!target) fail('Post not found.', 'NOT_FOUND');

  const oldStatus = target.status;
  const update = {};
  const changes = [];
  if (payload.status !== undefined && STATUSES.includes(payload.status) && payload.status !== target.status) {
    changes.push('Status: ' + target.status + ' → ' + payload.status);
    update.status = payload.status;
  }
  if (payload.date !== undefined && String(payload.date) !== (target.date || '')) {
    changes.push('Date: ' + (target.date || 'Unscheduled') + ' → ' + (payload.date || 'Unscheduled'));
    update.date = String(payload.date);
  }
  if (changes.length === 0) {
    return { post: postOut(target, false), activity: null };
  }

  update.updated_at = nowIso();
  const saved = q(await db().from('posts').update(update).eq('id', target.id).select().single());
  const activity = await logActivity(saved.id, saved.client_id, user.name, 'updated', changes.join('; '));

  if (saved.status === 'In Review' && oldStatus !== 'In Review') {
    const client = await getClientRow(saved.client_id);
    if (client) await notifyInReview(client, saved.text, 'moved a post to');
  }

  return { post: postOut(saved, false), activity };
}

async function handleDeletePost(auth, payload) {
  const user = await requireAgencyAuth(auth, EDITORS);
  const postId = String(payload.postId || '');
  const target = await getPostRow(postId);
  if (!target) fail('Post not found.', 'NOT_FOUND');

  q(await db().from('posts').delete().eq('id', postId)); // comments cascade
  const snippet = (target.text || '').substring(0, 50);
  const activity = await logActivity(postId, target.client_id, user.name, 'deleted',
    'Deleted post' + (snippet ? ': "' + snippet + '"' : ''));
  return { deletedId: postId, activity };
}

// Replaces uploadAsset: the browser uploads the file straight to Supabase Storage
// using this one-time signed URL, so large files never pass through the API.
async function handleCreateUpload(auth, payload) {
  await requireAgencyAuth(auth, EDITORS);
  const clientId = String(payload.clientId || '');
  const name = String(payload.name || 'upload');
  const mimeType = String(payload.mimeType || '').toLowerCase();
  const size = Number(payload.size || 0);

  if (!clientId) fail('Select a client before uploading files.', 'VALIDATION');
  if (mimeType.indexOf('image/') !== 0 && mimeType.indexOf('video/') !== 0) {
    fail('Only image and video files are allowed.', 'VALIDATION');
  }
  if (!(size > 0)) fail('Empty file data.', 'VALIDATION');
  if (size > MAX_UPLOAD_BYTES) fail('File exceeds the 20 MB maximum size limit.', 'VALIDATION');
  if (!(await getClientRow(clientId))) fail('Client not found.', 'NOT_FOUND');

  const safeName = name.replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(-80) || 'upload';
  const path = 'posts/' + clientId + '/' + newId('') + '-' + safeName;
  const res = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (res.error) throw res.error;

  return {
    uploadUrl: res.data.signedUrl,
    asset: enrichAsset({
      id: path,
      type: mimeType.indexOf('video/') === 0 ? 'video' : 'image',
      name: name.slice(0, 200),
      src: 'storage'
    })
  };
}

// The server can no longer open Drive files, so a pasted Drive link is stored as a
// 'link' asset shown through Drive's own preview. The file must be shared
// "Anyone with the link".
async function handleResolveDriveLink(auth, payload) {
  await requireAgencyAuth(auth, EDITORS);
  const input = String(payload.url || '').trim();
  if (!input) fail('Please paste a Google Drive file link or ID.', 'VALIDATION');
  const match = input.match(/[-\w]{25,}/);
  if (!match) fail('That does not look like a Google Drive file link.', 'VALIDATION');
  return { asset: enrichAsset({ id: match[0], type: 'link', name: 'Google Drive file', src: 'drive' }) };
}

async function handleAddComment(auth, payload) {
  const postId = String(payload.postId || '');
  const text = String(payload.text || '').trim();
  if (!postId) fail('Post ID is required.', 'VALIDATION');
  if (!text) fail('Please write a comment before posting.', 'VALIDATION');

  const post = await getPostRow(postId);
  if (!post) fail('Post not found.', 'NOT_FOUND');

  let authorName;
  let authorRole;
  let activityActor;
  let isClient = false;

  if (auth && auth.clientToken) {
    const ctx = await requireClientTokenAuth(auth, post.client_id);
    const c = ctx.clientMap[post.client_id];
    authorName = c ? c.name : ctx.root.name;
    authorRole = 'Client';
    activityActor = authorName + ' (client)';
    isClient = true;
  } else {
    const user = await requireAgencyAuth(auth, EDITORS);
    authorName = user.name;
    authorRole = user.role;
    activityActor = user.name;
  }

  const comment = q(await db().from('comments').insert({
    id: newId('cmt'),
    post_id: post.id,
    client_id: post.client_id,
    author: authorName,
    role: authorRole,
    text,
    created_at: nowIso()
  }).select().single());
  const act = await logActivity(post.id, post.client_id, activityActor, 'commented', text.substring(0, 120));

  if (isClient) {
    const settings = await getSettings();
    if (settings.agencyEmail) {
      const html = '<div style="font-family:sans-serif;color:#1e293b;max-width:560px">' +
        '<h2 style="font-size:18px;margin-bottom:8px">New client comment from ' + escapeHtml(authorName) + '</h2>' +
        '<p style="font-size:14px;color:#475569">On post scheduled for <strong>' + escapeHtml(post.date || 'Unscheduled') + '</strong>:</p>' +
        '<div style="background:#f8fafc;border-left:4px solid #1f5fd6;padding:12px 16px;margin:12px 0;font-size:14px">' + escapeHtml(text) + '</div>' +
        '</div>';
      await sendEmail({ to: settings.agencyEmail, subject: '[' + settings.agencyName + '] New comment from ' + authorName, html });
    }
  }

  return { comment: commentOut(comment), activity: isClient ? null : act };
}

async function handleClientDecision(auth, payload) {
  const postId = String(payload.postId || '');
  const decision = String(payload.decision || ''); // 'approve' | 'changes'
  const commentText = String(payload.comment || '').trim();

  const post = await getPostRow(postId);
  if (!post) fail('Post not found.', 'NOT_FOUND');

  const ctx = await requireClientTokenAuth(auth, post.client_id);
  if (post.status !== 'In Review') fail('This post is not currently awaiting review.', 'VALIDATION');
  if (decision !== 'approve' && decision !== 'changes') fail('Unknown decision.', 'VALIDATION');
  if (decision === 'changes' && !commentText) {
    fail('Please include a comment explaining the changes needed.', 'VALIDATION');
  }

  const c = ctx.clientMap[post.client_id];
  const cName = c ? c.name : ctx.root.name;
  const newStatus = decision === 'approve' ? 'Approved' : 'Draft';

  const saved = q(await db().from('posts')
    .update({ status: newStatus, updated_at: nowIso() })
    .eq('id', post.id).select().single());

  let addedComment = null;
  if (commentText) {
    addedComment = commentOut(q(await db().from('comments').insert({
      id: newId('cmt'),
      post_id: post.id,
      client_id: post.client_id,
      author: cName,
      role: 'Client',
      text: commentText,
      created_at: nowIso()
    }).select().single()));
  }

  const actionType = decision === 'approve' ? 'approved' : 'requested changes';
  const details = 'Status: In Review → ' + newStatus + (commentText ? ' ("' + commentText.substring(0, 100) + '")' : '');
  await logActivity(post.id, post.client_id, cName + ' (client)', actionType, details);

  const settings = await getSettings();
  if (settings.agencyEmail) {
    const headline = decision === 'approve'
      ? cName + ' approved a post'
      : cName + ' requested changes on a post';
    const color = decision === 'approve' ? '#17834a' : '#d4880b';
    const html = '<div style="font-family:sans-serif;color:#1e293b;max-width:560px">' +
      '<h2 style="font-size:18px;margin-bottom:8px">' + escapeHtml(headline) + '</h2>' +
      '<div style="background:#f8fafc;border-left:4px solid ' + color + ';padding:12px 16px;margin:12px 0;font-size:14px">' +
      '<div><strong>Post copy:</strong> ' + escapeHtml(snippetOf(post.text)) + '</div>' +
      (commentText ? '<div style="margin-top:8px"><strong>Client feedback:</strong> ' + escapeHtml(commentText) + '</div>' : '') +
      '</div></div>';
    await sendEmail({ to: settings.agencyEmail, subject: '[' + settings.agencyName + '] ' + headline, html });
  }

  return { post: postOut(saved, true), comment: addedComment };
}

/* ==========================================================================
   INVOICES & PDF GENERATION
   ========================================================================== */

function computeNextInvoiceNumber(existing) {
  const prefix = 'INV-' + todayStr().slice(0, 4) + '-';
  let maxSeq = 0;
  for (const inv of existing) {
    if (String(inv.number || '').indexOf(prefix) === 0) {
      const n = parseInt(String(inv.number).substring(prefix.length), 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    }
  }
  const next = maxSeq + 1;
  return prefix + ('000' + next).slice(-Math.max(3, String(next).length));
}

async function getEffectiveClientCurrency(client, settings) {
  if (client.currency) return client.currency;
  if (client.parent_id) {
    const parent = await getClientRow(client.parent_id);
    if (parent && parent.currency) return parent.currency;
  }
  return settings.defaultCurrency || 'USD';
}

function cleanItems(raw) {
  const out = [];
  for (const row0 of Array.isArray(raw) ? raw : []) {
    const row = row0 || {};
    const description = String(row.description || '').trim();
    const qty = row.qty !== undefined && row.qty !== null && row.qty !== '' ? String(row.qty) : '';
    const rate = row.rate !== undefined && row.rate !== null && row.rate !== '' ? String(row.rate) : '';
    if (description || qty || rate) out.push({ description, qty, rate });
  }
  return out;
}

async function handleSaveInvoice(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const id = String(payload.id || '').trim();
  const clientId = String(payload.clientId || '').trim();
  if (!clientId) fail('Client is required for an invoice.', 'VALIDATION');

  const settings = await getSettings();
  const client = await getClientRow(clientId);
  if (!client) fail('Client not found.', 'NOT_FOUND');
  const existing = q(await db().from('invoices').select('id,number').eq('client_id', clientId));

  let number = String(payload.number || '').trim();
  const duplicateMsg = () => 'Invoice number "' + number + '" already exists for this client.';
  if (!number) {
    number = computeNextInvoiceNumber(existing);
  } else if (existing.some((inv) => inv.number.toLowerCase() === number.toLowerCase() && inv.id !== id)) {
    fail(duplicateMsg(), 'VALIDATION');
  }

  const issueDate = String(payload.issueDate || todayStr()).trim();
  const dueDate = String(payload.dueDate || addDaysStr(issueDate, settings.dueDays || 14)).trim();
  const status = payload.status === 'Paid' ? 'Paid' : 'Pending';
  const currency = String(payload.currency || await getEffectiveClientCurrency(client, settings)).trim().toUpperCase();
  const taxPct = payload.taxPct !== undefined && payload.taxPct !== null && payload.taxPct !== '' ? String(payload.taxPct) : '';
  const discount = payload.discount !== undefined && payload.discount !== null && payload.discount !== '' ? String(payload.discount) : '';
  const notes = String(payload.notes || '');
  const items = cleanItems(payload.items);
  if (items.length === 0) fail('Add at least one line item to save the invoice.', 'VALIDATION');

  const now = nowIso();
  const fields = {
    number, issue_date: issueDate, due_date: dueDate, status, currency, items,
    tax_pct: taxPct, discount, notes, updated_at: now
  };

  let saved;
  try {
    if (id) {
      saved = q(await db().from('invoices').update(fields).eq('id', id).eq('client_id', clientId).select().maybeSingle());
      if (!saved) fail('Invoice not found.', 'NOT_FOUND');
    } else {
      saved = q(await db().from('invoices').insert({
        id: newId('inv'),
        client_id: clientId,
        ...fields,
        pdf_file_id: '',
        pdf_url: '',
        sent_at: '',
        created_at: now
      }).select().single());
    }
  } catch (e) {
    if (e && e.code === '23505') fail(duplicateMsg(), 'VALIDATION'); // unique (client, number)
    throw e;
  }

  return { invoice: invoiceOut(saved, settings) };
}

async function handleSetInvoiceStatus(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const invoiceId = String(payload.invoiceId || '');
  const status = payload.status === 'Paid' ? 'Paid' : 'Pending';
  const updated = q(await db().from('invoices')
    .update({ status, updated_at: nowIso() })
    .eq('id', invoiceId).select('id').maybeSingle());
  if (!updated) fail('Invoice not found.', 'NOT_FOUND');
  return { invoiceId, status };
}

async function removeStoredPdf(fileId) {
  if (!fileId || fileId.indexOf('invoices/') !== 0) return; // old Drive PDFs are left alone
  const res = await db().storage.from(BUCKET).remove([fileId]);
  if (res.error) console.error('Could not remove old PDF:', res.error);
}

async function handleDeleteInvoice(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const invoiceId = String(payload.invoiceId || '');
  const target = await getInvoiceRow(invoiceId);
  if (!target) fail('Invoice not found.', 'NOT_FOUND');

  await removeStoredPdf(target.pdf_file_id);
  q(await db().from('invoices').delete().eq('id', invoiceId));
  return { deletedId: invoiceId };
}

async function handleInvoicePdf(auth, payload, alsoSendEmail) {
  await requireAgencyAuth(auth, BILLING);
  const target = await getInvoiceRow(String(payload.invoiceId || ''));
  if (!target) fail('Invoice not found.', 'NOT_FOUND');

  const client = await getClientRow(target.client_id);
  const settings = await getSettings();

  const bytes = await buildInvoicePdf(target, client, settings);
  const safeNumber = String(target.number).replace(/[^\w.-]+/g, '_');
  const path = 'invoices/' + target.client_id + '/' + safeNumber + '-' + randomToken(10) + '.pdf';
  const up = await db().storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw up.error;
  await removeStoredPdf(target.pdf_file_id);

  const update = { pdf_file_id: path, pdf_url: publicUrl(path), updated_at: nowIso() };

  if (alsoSendEmail) {
    const recipient = await getEffectiveClientEmail(client);
    if (!recipient) {
      q(await db().from('invoices').update(update).eq('id', target.id));
      fail('PDF was generated, but no notification email is set for this client or its parent.', 'NO_EMAIL');
    }
    const html = '<div style="font-family:sans-serif;color:#1e293b;max-width:560px">' +
      '<h2 style="font-size:18px;margin-bottom:8px">Invoice ' + escapeHtml(target.number) + ' from ' + escapeHtml(settings.agencyName) + '</h2>' +
      '<p style="font-size:14px;color:#475569;line-height:1.5">Please find attached invoice <strong>' + escapeHtml(target.number) + '</strong> due on <strong>' + escapeHtml(target.due_date) + '</strong>.</p>' +
      '</div>';
    const sent = await sendEmail({
      to: recipient,
      subject: 'Invoice ' + target.number + ' from ' + settings.agencyName,
      html,
      attachments: [{ filename: safeNumber + '.pdf', content: Buffer.from(bytes).toString('base64') }]
    });
    if (!sent) {
      q(await db().from('invoices').update(update).eq('id', target.id));
      fail('PDF was generated, but the email could not be sent. Check RESEND_API_KEY and MAIL_FROM.', 'EMAIL_FAILED');
    }
    update.sent_at = nowIso();
  }

  q(await db().from('invoices').update(update).eq('id', target.id));

  return {
    invoiceId: target.id,
    pdfFileId: path,
    pdfUrl: update.pdf_url,
    sentAt: update.sent_at || target.sent_at || ''
  };
}

/* ==========================================================================
   TEAM & SETTINGS (ADMIN)
   ========================================================================== */

async function handleSaveTeamAndSettings(auth, payload) {
  const currentUser = await requireAgencyAuth(auth, ['Admin']);

  const sInput = payload.settings || {};
  const settingsMap = {
    agencyName: String(sInput.agencyName || '').trim() || DEFAULT_NAME,
    agencyEmail: String(sInput.agencyEmail || '').trim(),
    defaultCurrency: String(sInput.defaultCurrency || 'USD').trim().toUpperCase(),
    dueDays: String(Math.max(0, parseInt(sInput.dueDays || '14', 10) || 14))
  };

  const incoming = Array.isArray(payload.team) ? payload.team : [];
  if (incoming.length === 0) fail('At least one Admin must remain on the team.', 'VALIDATION');

  const existingTeam = await all('team', null, ['email']);
  const existingByEmail = {};
  for (const t of existingTeam) existingByEmail[t.email.toLowerCase()] = t;

  let currentUserStillAdmin = false;
  const seen = {};
  const nextRows = [];
  const passwordResetEmails = [];

  for (const row0 of incoming) {
    const row = row0 || {};
    const name = String(row.name || '').trim();
    const email = String(row.email || '').trim().toLowerCase();
    const role = ROLES.includes(row.role) ? row.role : 'Designer';
    const newPass = String(row.password || '');

    if (!name || !email || email.indexOf('@') === -1) {
      fail('Every team member must have a valid name and email address.', 'VALIDATION');
    }
    if (seen[email]) fail('Duplicate team email: ' + email, 'VALIDATION');
    seen[email] = true;

    if (email === currentUser.email.toLowerCase() && role === 'Admin') currentUserStillAdmin = true;

    const prev = existingByEmail[email];
    if (!prev) {
      if (newPass.length < 8) {
        fail('New team member "' + name + '" requires a password of at least 8 characters.', 'VALIDATION');
      }
      const h = await hashPassword(newPass);
      nextRows.push({ email, name, role, pass_hash: h.passHash, salt: h.salt });
    } else if (newPass) {
      if (newPass.length < 8) fail('Password for "' + name + '" must be at least 8 characters.', 'VALIDATION');
      const h = await hashPassword(newPass);
      nextRows.push({ email, name, role, pass_hash: h.passHash, salt: h.salt });
      passwordResetEmails.push(email);
    } else {
      nextRows.push({ email, name, role, pass_hash: prev.pass_hash, salt: prev.salt });
    }
  }

  if (!currentUserStillAdmin) {
    fail('You cannot remove your own Admin role or delete your own account.', 'VALIDATION');
  }

  // Removed members: deleting the team row cascades to their sessions.
  const removed = Object.keys(existingByEmail).filter((e) => !seen[e]);
  if (removed.length) q(await db().from('team').delete().in('email', removed));

  q(await db().from('team').upsert(nextRows, { onConflict: 'email' }));

  // Password resets sign that person out everywhere (except the Admin's own current session).
  for (const email of passwordResetEmails) {
    q(await db().from('sessions').delete().eq('email', email).neq('token_hash', currentUser.tokenHash));
  }

  await saveSettings(settingsMap);

  return {
    settings: settingsMap,
    team: nextRows.map((t) => ({ email: t.email, name: t.name, role: t.role }))
  };
}
