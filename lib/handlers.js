/**
 * Flokey — Backend
 * Port of Code.gs. Single RPC entry point: dispatch(action, auth, payload).
 */
import { db, rawDb, q, all, publicUrl, BUCKET, withScope, setWorkspace, currentWorkspace, requestContext } from './db.js';
import {
  AppError, fail, nowIso, todayStr, addDaysStr, newId, randomToken, randomDigits, sha256Hex, safeEqual,
  hashPassword, verifyPassword, escapeHtml
} from './util.js';
import { sendEmail } from './email.js';
import { buildInvoicePdf } from './pdf.js';
import { publish, liveConfig } from './realtime.js';
import { PLANS, TRIAL_DAYS, planState, publicPlans } from './plans.js';
import { googleClientId, verifyGoogleCredential } from './google.js';

const STATUSES = ['Draft', 'In Review', 'Approved', 'Scheduled', 'Published'];
const PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'X'];
const ROLES = ['Admin', 'Account Manager', 'Designer'];
const BILLING = ['Admin', 'Account Manager'];
const EDITORS = ['Admin', 'Account Manager', 'Designer'];
const LOCKED_FOR_CLIENTS = ['Scheduled', 'Published'];
const DEFAULT_NAME = 'Flokey';
const SESSION_DAYS = 30;
const TRUSTED_DEVICE_DAYS = 30;
const LOGIN_CODE_MINUTES = 10;
const LOGIN_CODE_MAX_TRIES = 5;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_LOGIN_FAILS = 8;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const ACTIONS = {
  boot: (auth) => handleBoot(auth),
  setupAdmin: (auth, p) => handleSetupAdmin(p),
  login: (auth, p) => handleLogin(p),
  verifyLoginCode: (auth, p) => handleVerifyLoginCode(p),
  resendLoginCode: (auth, p) => handleResendLoginCode(p),
  logout: (auth) => handleLogout(auth),
  changePassword: handleChangePassword,
  saveProfile: handleSaveProfile,
  createAvatarUpload: handleCreateAvatarUpload,
  signOutEverywhere: handleSignOutEverywhere,
  saveClient: handleSaveClient,
  reorderClients: handleReorderClients,
  setPortalAccess: handleSetPortalAccess,
  saveTags: handleSaveTags,
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
  saveTeamAndSettings: handleSaveTeamAndSettings,
  saveBoardColumn: handleSaveBoardColumn,
  deleteBoardColumn: handleDeleteBoardColumn,
  saveProject: handleSaveProject,
  deleteProject: handleDeleteProject,
  saveTask: handleSaveTask,
  moveTask: handleMoveTask,
  deleteTask: handleDeleteTask,
  startTimer: handleStartTimer,
  stopTimer: handleStopTimer,
  saveTimeEntry: handleSaveTimeEntry,
  deleteTimeEntry: handleDeleteTimeEntry,
  invoiceFromTime: handleInvoiceFromTime,
  signup: (auth, p, meta) => handleSignup(p, meta),
  googleAuth: (auth, p, meta) => handleGoogleAuth(p, meta),
  requestUpgrade: handleRequestUpgrade
};

// Actions that never change data, so they don't trigger live updates.
const READ_ONLY = new Set(['boot', 'login', 'verifyLoginCode', 'resendLoginCode', 'logout', 'createUpload',
  'createAvatarUpload', 'resolveDriveLink', 'generateInvoicePdf', 'signup', 'googleAuth', 'requestUpgrade']);

// Still allowed once a free trial has ended (everything else is read-only until a plan is chosen).
const ALLOWED_WHEN_EXPIRED = new Set(['boot', 'login', 'verifyLoginCode', 'resendLoginCode', 'logout',
  'changePassword', 'saveProfile', 'createAvatarUpload', 'signOutEverywhere', 'resolveDriveLink',
  'generateInvoicePdf', 'requestUpgrade', 'googleAuth', 'signup', 'stopTimer']);

export async function dispatch(action, auth, payload, meta) {
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  if (!fn) return { ok: false, error: 'Unknown action: ' + action, code: 'BAD_ACTION' };
  // Each request runs in its own workspace scope (see lib/db.js).
  return withScope(async () => {
    requestContext().action = action;
    try {
      const data = await fn(auth || {}, payload || {}, meta || {});
      if (!READ_ONLY.has(action) && currentWorkspace()) {
        notifyChange(payload || {}, data).catch((e) => console.error('Live update failed:', e.message));
      }
      return { ok: true, data };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: err.message, code: err.code };
      console.error('[' + action + ']', err);
      return { ok: false, error: 'Something went wrong on the server. Please try again.', code: 'ERROR' };
    }
  });
}

/* ---------- Workspaces & plans ---------- */

async function getWorkspaceRow(id) {
  if (!id) return null;
  return q(await rawDb().from('workspaces').select('*').eq('id', id).maybeSingle());
}

// Points this request at one agency's workspace, and stops changes once its trial has ended.
async function enterWorkspace(id, who) {
  // undefined: the workspace_id column doesn't exist yet, so the database update wasn't run.
  if (id === undefined) {
    fail('The database needs an update before you can sign in. In Supabase → SQL Editor, run supabase/005_workspaces.sql, then try again.', 'DB_UPDATE_NEEDED');
  }
  if (!id) fail('This account is not linked to a workspace.', 'AUTH');
  setWorkspace(id);
  const ctx = requestContext();
  if (!ctx.workspace) {
    ctx.workspace = (await getWorkspaceRow(id)) || { id, plan: 'trial', trial_ends_at: '' };
  }
  const state = planState(ctx.workspace);
  if (state.expired && !ALLOWED_WHEN_EXPIRED.has(ctx.action)) {
    if (who === 'client') fail('This workspace is paused right now, so changes can\'t be saved. Please contact your agency.', 'PLAN_EXPIRED');
    fail(state.plan === 'paused'
      ? 'This workspace is paused. Choose a plan in Settings → Plan to keep making changes.'
      : 'Your free trial has ended. Choose a plan in Settings → Plan to keep making changes. Your data is safe.', 'PLAN_EXPIRED');
  }
  return ctx.workspace;
}

function currentPlan() {
  const ctx = requestContext();
  return planState(ctx.workspace || { plan: 'trial' });
}

async function activeClientCount() {
  const res = await db().from('clients').select('id', { count: 'exact', head: true }).eq('archived', false);
  if (res.error) throw res.error;
  return res.count || 0;
}

async function checkClientLimit(adding) {
  const plan = currentPlan();
  const max = plan.limits.clients;
  if (max === null || max === undefined) return;
  if ((await activeClientCount()) + adding > max) {
    fail('Your ' + plan.planName + ' plan includes up to ' + max + ' active clients (main clients and sub-clients). ' +
      'Archive a client or upgrade in Settings → Plan.', 'PLAN_LIMIT');
  }
}

function signupsEnabled() {
  return String(process.env.SIGNUPS || 'on').toLowerCase() !== 'off';
}

/* ==========================================================================
   CORE HELPERS
   ========================================================================== */

function appUrl() {
  return String(process.env.APP_URL || '').replace(/\/+$/, '');
}

function portalLink(token) {
  return appUrl() + '/app?t=' + token;
}

// Email is needed to send sign-in codes; without it, codes are skipped so nobody is locked out.
function loginCodesEnabled() {
  if (String(process.env.DISABLE_LOGIN_CODES || '').toLowerCase() === 'true') return false;
  return Boolean(process.env.SMTP_HOST || process.env.RESEND_API_KEY);
}

const CLIENT_ORDER = ['sort_order', 'created_at', 'id'];

/* ---------- Live updates ---------- */

const realtimeSecrets = new Map();
async function getRealtimeSecret() {
  const ws = currentWorkspace();
  if (realtimeSecrets.has(ws)) return realtimeSecrets.get(ws);
  let secret;
  const row = q(await db().from('settings').select('value').eq('key', 'realtime_key').maybeSingle());
  if (row && row.value) {
    secret = row.value;
  } else {
    secret = randomToken(40);
    q(await db().from('settings').upsert({ key: 'realtime_key', value: secret }, { onConflict: 'key' }));
  }
  realtimeSecrets.set(ws, secret);
  return secret;
}

async function teamTopic() {
  return 'cf-team-' + sha256Hex('team:' + (await getRealtimeSecret())).slice(0, 32);
}

function portalTopic(token) {
  return 'cf-portal-' + sha256Hex('portal:' + token).slice(0, 32);
}

// After a change: signal the team, plus every client portal that can see the changed client.
async function notifyChange(payload, data) {
  const ids = new Set();
  const add = (v) => { if (v) ids.add(String(v)); };
  add(payload.clientId);
  if (data) {
    add(data.clientId);
    if (data.post) add(data.post.clientId);
    if (data.invoice) add(data.invoice.clientId);
    if (data.comment) add(data.comment.clientId);
    if (data.activity) add(data.activity.clientId);
    if (data.column) add(data.column.clientId);
    if (data.project) add(data.project.clientId);
  }
  if (payload.postId && !ids.size) {
    const post = await getPostRow(String(payload.postId));
    if (post) add(post.client_id);
  }
  if (payload.invoiceId && !ids.size) {
    const inv = await getInvoiceRow(String(payload.invoiceId));
    if (inv) add(inv.client_id);
  }
  const topics = [await teamTopic()];
  for (const id of ids) {
    const c = await getClientRow(id);
    if (!c) continue;
    if (c.token) topics.push(portalTopic(c.token));
    if (c.parent_id) {
      const parent = await getClientRow(c.parent_id);
      if (parent && parent.token) topics.push(portalTopic(parent.token));
    }
  }
  publish(topics);
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
  // Workspaces still on the old default name pick up the new product name.
  if (map.agencyName === 'Clientflow' || !map.agencyName) map.agencyName = DEFAULT_NAME;
  return map;
}

async function saveSettings(map) {
  const rows = Object.keys(SETTINGS_DEFAULTS).map((k) => ({
    key: k,
    value: map[k] !== undefined ? String(map[k]) : ''
  }));
  q(await db().from('settings').upsert(rows, { onConflict: 'key' }));
}

// Team members across every workspace: 0 means a brand-new install.
async function teamCount() {
  const res = await rawDb().from('team').select('email', { count: 'exact', head: true });
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
      if (!/^(posts|comments)\/[\w-]+\/[\w.-]+$/.test(id)) continue;
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
    color: c.color || '',
    sortOrder: c.sort_order || 0,
    portalAccess: c.portal_access === 'edit' ? 'edit' : 'view',
    timeTracking: Boolean(c.time_tracking),
    createdAt: c.created_at || ''
  };
}

function teamOut(t) {
  return {
    email: t.email,
    name: t.name,
    role: t.role,
    title: t.title || '',
    phone: t.phone || '',
    avatarUrl: t.avatar_url || ''
  };
}

function tagOut(t) {
  return { id: t.id, name: t.name, color: t.color || '' };
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
    refAssets: (p.ref_assets || []).map(enrichAsset).filter(Boolean),
    liveUrl: p.live_url || '',
    createdAt: p.created_at || '',
    updatedAt: p.updated_at || '',
    createdBy: p.created_by || '',
    createdByType: p.created_by_type === 'client' ? 'client' : 'team',
    updatedBy: p.updated_by || '',
    columnId: p.column_id || ''
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
    author: c.author, role: c.role, text: c.text, createdAt: c.created_at,
    attachments: (c.attachments || []).map(enrichAsset).filter(Boolean)
  };
}

function columnOut(c) {
  return {
    id: c.id, clientId: c.client_id, name: c.name, color: c.color || '',
    afterStatus: STATUSES.includes(c.after_status) ? c.after_status : 'Draft', sortOrder: c.sort_order || 0
  };
}

// Invoice as a client sees it in the portal (no internal ids).
function portalInvoiceOut(inv, settings) {
  const full = invoiceOut(inv, settings);
  return {
    id: full.id, clientId: full.clientId, number: full.number, issueDate: full.issueDate, dueDate: full.dueDate,
    status: full.status, currency: full.currency, items: full.items, taxPct: full.taxPct, discount: full.discount,
    notes: full.notes, pdfUrl: full.pdfUrl, sentAt: full.sentAt
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
  const user = q(await rawDb().from('team').select('*').eq('email', session.email).maybeSingle());
  if (!user) fail('Your account is no longer active.', 'AUTH');
  await enterWorkspace(user.workspace_id, 'team');

  if (allowedRoles && allowedRoles.length > 0 && allowedRoles.indexOf(user.role) === -1) {
    fail('You do not have permission to perform this action.', 'FORBIDDEN');
  }
  return { ...teamOut(user), tokenHash };
}

async function requireClientTokenAuth(auth, targetClientId) {
  const token = auth && auth.clientToken ? String(auth.clientToken).trim() : '';
  if (!token) fail('Invalid or missing share link.', 'PORTAL_INVALID');

  const root = q(await rawDb().from('clients').select('*').eq('token', token).maybeSingle());
  if (!root) fail('This share link is invalid or has been turned off.', 'PORTAL_INVALID');
  await enterWorkspace(root.workspace_id, 'client');
  if (root.archived) fail('This client workspace is archived.', 'PORTAL_ARCHIVED');

  if (root.parent_id) {
    const parent = await getClientRow(root.parent_id);
    if (parent && parent.archived) fail('This client workspace is archived.', 'PORTAL_ARCHIVED');
  }

  // A parent token opens all active sub-clients; a sub-client token opens only itself.
  const allowed = root.parent_id
    ? [root]
    : await all('clients', (b) => b.eq('parent_id', root.id).eq('archived', false), CLIENT_ORDER);

  if (targetClientId && !allowed.some((c) => c.id === targetClientId)) {
    fail('You do not have access to this client.', 'FORBIDDEN');
  }

  const clientMap = {};
  for (const c of allowed) clientMap[c.id] = c;
  clientMap[root.id] = root;
  // What the link allows is set on the client the link belongs to.
  const access = root.portal_access === 'edit' ? 'edit' : 'view';
  return { root, allowed, clientMap, access };
}

async function requireClientEditAuth(auth, targetClientId) {
  const ctx = await requireClientTokenAuth(auth, targetClientId);
  if (ctx.access !== 'edit') {
    fail('This share link can view and approve posts, but not add or edit them.', 'FORBIDDEN');
  }
  return ctx;
}

// For actions that look up a post before deciding which permission check applies:
// work out the caller's workspace first, so the lookup only sees that workspace.
async function enterFromAuth(auth) {
  if (auth && auth.clientToken) await requireClientTokenAuth(auth, null);
  else await requireAgencyAuth(auth, null);
}

function clientDisplayName(ctx, clientId) {
  const c = ctx.clientMap[clientId];
  return c ? c.name : ctx.root.name;
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

function publicAuthConfig() {
  return { googleClientId: googleClientId(), signupsEnabled: signupsEnabled(), trialDays: TRIAL_DAYS };
}

async function handleBoot(auth) {
  // 1. Client portal visit (?t=...)
  if (auth.clientToken) {
    const ctx = await requireClientTokenAuth(auth, null);
    const settings = await getSettings();
    const ids = ctx.allowed.map((c) => c.id);
    const billingIds = [...new Set(ids.concat([ctx.root.id]))];
    const [posts, comments, tags, columns, invoices] = await Promise.all([
      ids.length ? all('posts', (b) => b.in('client_id', ids)) : [],
      ids.length ? all('comments', (b) => b.in('client_id', ids), ['seq']) : [],
      all('tags', null, ['sort_order', 'name']),
      ids.length ? all('board_columns', (b) => b.in('client_id', ids), ['sort_order', 'created_at']) : [],
      all('invoices', (b) => b.in('client_id', billingIds))
    ]);

    return {
      mode: 'portal',
      agencyName: settings.agencyName,
      today: todayStr(),
      rootClient: {
        id: ctx.root.id, name: ctx.root.name, color: ctx.root.color || '',
        isParent: !ctx.root.parent_id, access: ctx.access
      },
      clients: ctx.allowed.map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id || '', color: c.color || '' })),
      posts: posts.map((p) => postOut(p, true)),
      comments: comments.map(commentOut),
      tags: tags.map(tagOut),
      boardColumns: columns.map(columnOut),
      // Only invoices the agency has sent are visible to the client.
      invoices: invoices.filter((inv) => inv.sent_at).map((inv) => portalInvoiceOut(inv, settings)),
      live: liveConfig(portalTopic(ctx.root.token))
    };
  }

  // 2. First run: no team yet
  if ((await teamCount()) === 0) {
    return { mode: 'setup', agencyName: DEFAULT_NAME };
  }

  // 3. Agency session
  if (auth.sessionToken) {
    try {
      const user = await requireAgencyAuth(auth, null);
      return await buildAgencyState(user, await getSettings());
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return { mode: 'login', agencyName: DEFAULT_NAME, authError: e.message, ...publicAuthConfig() };
    }
  }

  return { mode: 'login', agencyName: DEFAULT_NAME, ...publicAuthConfig() };
}

async function buildAgencyState(user, settings) {
  const isBilling = BILLING.includes(user.role);
  const isAdmin = user.role === 'Admin';

  const [clients, posts, comments, activity, invoices, team, tags, columns, projects, tasks, timeEntries] = await Promise.all([
    all('clients', null, CLIENT_ORDER),
    all('posts'),
    all('comments', null, ['seq']),
    all('activity', null, ['seq']),
    isBilling ? all('invoices') : [],
    all('team', null, ['email']),
    all('tags', null, ['sort_order', 'name']),
    all('board_columns', null, ['sort_order', 'created_at']),
    all('projects', null, ['sort_order', 'created_at']),
    all('tasks', null, ['sort_order', 'created_at']),
    all('time_entries', null, ['date', 'created_at'])
  ]);
  const me = team.find((t) => t.email === user.email);

  return {
    mode: 'agency',
    user: me ? teamOut(me) : { email: user.email, name: user.name, role: user.role, title: '', phone: '', avatarUrl: '' },
    webAppUrl: appUrl(),
    today: todayStr(),
    settings,
    team: team.map(teamOut),
    tags: tags.map(tagOut),
    clients: clients.map((c) => clientOut(c, isBilling)),
    posts: posts.map((p) => postOut(p, false)),
    comments: comments.map(commentOut),
    activity: activity.map(activityOut),
    invoices: invoices.map((inv) => invoiceOut(inv, settings)),
    boardColumns: columns.map(columnOut),
    projects: projects.map((p) => projectOut(p, isBilling)),
    tasks: tasks.map(taskOut),
    timeEntries: timeEntries.map(timeOut),
    live: liveConfig(await teamTopic()),
    workspace: { id: currentWorkspace(), ...currentPlan(), usage: { clients: clients.filter((c) => !c.archived).length, seats: team.length } },
    plans: publicPlans(),
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

  // The person who installs Flokey owns the first workspace (unlimited).
  if (!(await getWorkspaceRow('ws_main'))) {
    q(await rawDb().from('workspaces').insert({ id: 'ws_main', name: 'Main workspace', plan: 'owner', owner_email: email, created_at: nowIso() }));
  }
  await enterWorkspace('ws_main', 'team');

  const { salt, passHash } = await hashPassword(password);
  q(await db().from('team').insert({ email, name, role: 'Admin', pass_hash: passHash, salt }));

  const sessionToken = await createSession(email);
  // Knowing the setup code proves who this is, so this browser starts out trusted.
  const deviceToken = await trustDevice(email, payload.deviceLabel);
  const settings = await getSettings();
  if (!settings.agencyEmail) {
    settings.agencyEmail = email;
    await saveSettings(settings);
  }

  const state = await buildAgencyState({ email, name, role: 'Admin' }, settings);
  state.sessionToken = sessionToken;
  state.deviceToken = deviceToken;
  return state;
}

/* ---------- Trusted devices & emailed sign-in codes ---------- */

async function trustDevice(email, label) {
  const raw = randomToken(48);
  q(await db().from('trusted_devices').insert({
    token_hash: sha256Hex(raw),
    email,
    label: String(label || '').slice(0, 120),
    expires_at: new Date(Date.now() + TRUSTED_DEVICE_DAYS * 86400000).toISOString()
  }));
  return raw;
}

async function isTrustedDevice(email, rawToken) {
  if (!rawToken) return false;
  const row = q(await db().from('trusted_devices').select('email,expires_at')
    .eq('token_hash', sha256Hex(String(rawToken))).maybeSingle());
  return Boolean(row) && row.email === email && new Date(row.expires_at).getTime() > Date.now();
}

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return email;
  const shown = user.length <= 2 ? user.charAt(0) : user.slice(0, 2);
  return shown + '•••@' + domain;
}

async function emailLoginCode(member, code) {
  const settings = await getSettings();
  const html = '<div style="font-family:sans-serif;color:#1e293b;max-width:480px">' +
    '<h2 style="font-size:18px;margin-bottom:8px">Your sign-in code</h2>' +
    '<p style="color:#475569;font-size:14px;line-height:1.5">Hi ' + escapeHtml(member.name) + ', use this code to finish signing in to <strong>' + escapeHtml(settings.agencyName) + '</strong> on a new device:</p>' +
    '<div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f1f5f9;border-radius:10px;padding:16px 20px;text-align:center;margin:16px 0">' + code + '</div>' +
    '<p style="color:#64748b;font-size:13px">It expires in ' + LOGIN_CODE_MINUTES + ' minutes. If this wasn\'t you, change your password — someone knows it.</p>' +
    '</div>';
  return sendEmail({ to: member.email, subject: code + ' is your ' + settings.agencyName + ' sign-in code', html });
}

async function startLoginChallenge(member) {
  await db().from('login_codes').delete().eq('email', member.email);
  const id = newId('lc') + randomToken(16);
  const code = randomDigits(6);
  q(await db().from('login_codes').insert({
    id,
    email: member.email,
    code_hash: sha256Hex(id + ':' + code),
    attempts: 0,
    sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + LOGIN_CODE_MINUTES * 60000).toISOString()
  }));
  if (!(await emailLoginCode(member, code))) {
    await db().from('login_codes').delete().eq('id', id);
    fail('We could not email your sign-in code. Ask your admin to check the email settings.', 'EMAIL_FAILED');
  }
  return { needsCode: true, challengeId: id, emailHint: maskEmail(member.email) };
}

async function finishLogin(member, deviceLabel, rememberDevice) {
  const sessionToken = await createSession(member.email);
  const deviceToken = rememberDevice ? await trustDevice(member.email, deviceLabel) : '';
  const settings = await getSettings();
  const state = await buildAgencyState(teamOut(member), settings);
  state.sessionToken = sessionToken;
  if (deviceToken) state.deviceToken = deviceToken;
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

  const member = q(await rawDb().from('team').select('*').eq('email', email).maybeSingle());
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
  await enterWorkspace(member.workspace_id, 'team');

  // Upgrade passwords imported from the Apps Script version to scrypt.
  if (check.legacy) {
    const h = await hashPassword(password);
    q(await db().from('team').update({ pass_hash: h.passHash, salt: h.salt }).eq('email', email));
  }

  // New browser or phone: confirm with a code sent to the account's email first.
  if (loginCodesEnabled() && !(await isTrustedDevice(member.email, payload.deviceToken))) {
    return startLoginChallenge(member);
  }
  return finishLogin(member, payload.deviceLabel, false);
}

async function handleVerifyLoginCode(payload) {
  const challengeId = String(payload.challengeId || '');
  const code = String(payload.code || '').replace(/\D/g, '');
  const row = challengeId
    ? q(await db().from('login_codes').select('*').eq('id', challengeId).maybeSingle())
    : null;
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    fail('This code has expired. Please sign in again to get a new one.', 'CODE_EXPIRED');
  }
  if (row.attempts >= LOGIN_CODE_MAX_TRIES) {
    await db().from('login_codes').delete().eq('id', row.id);
    fail('Too many wrong codes. Please sign in again to get a new one.', 'CODE_EXPIRED');
  }
  if (code.length !== 6 || !safeEqual(sha256Hex(row.id + ':' + code), row.code_hash)) {
    q(await db().from('login_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id));
    const left = LOGIN_CODE_MAX_TRIES - row.attempts - 1;
    fail('That code is not right. ' + (left > 0 ? left + ' tries left.' : 'Please sign in again.'), 'BAD_CODE');
  }

  await db().from('login_codes').delete().eq('id', row.id);
  const member = q(await rawDb().from('team').select('*').eq('email', row.email).maybeSingle());
  if (!member) fail('Your account is no longer active.', 'AUTH');
  await enterWorkspace(member.workspace_id, 'team');
  return finishLogin(member, payload.deviceLabel, payload.rememberDevice !== false);
}

async function handleResendLoginCode(payload) {
  const row = payload.challengeId
    ? q(await db().from('login_codes').select('*').eq('id', String(payload.challengeId)).maybeSingle())
    : null;
  if (!row) fail('This sign-in has expired. Please sign in again.', 'CODE_EXPIRED');
  if (Date.now() - new Date(row.sent_at).getTime() < 30000) {
    fail('Please wait 30 seconds before asking for another code.', 'TOO_SOON');
  }
  const member = q(await rawDb().from('team').select('*').eq('email', row.email).maybeSingle());
  if (!member) fail('Your account is no longer active.', 'AUTH');
  await enterWorkspace(member.workspace_id, 'team');
  const code = randomDigits(6);
  q(await db().from('login_codes').update({
    code_hash: sha256Hex(row.id + ':' + code),
    attempts: 0,
    sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + LOGIN_CODE_MINUTES * 60000).toISOString()
  }).eq('id', row.id));
  if (!(await emailLoginCode(member, code))) {
    fail('We could not email your sign-in code. Ask your admin to check the email settings.', 'EMAIL_FAILED');
  }
  return { resent: true, emailHint: maskEmail(member.email) };
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

/* ---------- Profile ---------- */

async function handleSaveProfile(auth, payload) {
  const user = await requireAgencyAuth(auth, null);
  const name = String(payload.name || '').trim();
  if (!name) fail('Please enter your name.', 'VALIDATION');
  const update = {
    name: name.slice(0, 80),
    title: String(payload.title || '').trim().slice(0, 80),
    phone: String(payload.phone || '').trim().slice(0, 40)
  };
  if (payload.avatarPath !== undefined) {
    const path = String(payload.avatarPath || '');
    if (path && !/^avatars\/[\w.-]+$/.test(path)) fail('Invalid profile photo.', 'VALIDATION');
    update.avatar_url = path ? publicUrl(path) : '';
  }
  const saved = q(await db().from('team').update(update).eq('email', user.email).select().single());
  return { user: teamOut(saved) };
}

async function handleCreateAvatarUpload(auth, payload) {
  const user = await requireAgencyAuth(auth, null);
  const mimeType = String(payload.mimeType || '').toLowerCase();
  const size = Number(payload.size || 0);
  if (mimeType.indexOf('image/') !== 0) fail('Please choose an image file.', 'VALIDATION');
  if (!(size > 0)) fail('Empty file data.', 'VALIDATION');
  if (size > MAX_AVATAR_BYTES) fail('Profile photos can be up to 5 MB.', 'VALIDATION');
  const ext = (String(payload.name || '').match(/\.(png|jpe?g|webp|gif)$/i) || ['', 'png'])[1].toLowerCase();
  const path = 'avatars/' + sha256Hex(user.email).slice(0, 12) + '-' + newId('') + '.' + ext;
  const res = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (res.error) throw res.error;
  return { uploadUrl: res.data.signedUrl, path, url: publicUrl(path) };
}

// Signs out every other session and forgets every trusted device (they'll need a code again).
async function handleSignOutEverywhere(auth) {
  const user = await requireAgencyAuth(auth, null);
  q(await db().from('sessions').delete().eq('email', user.email).neq('token_hash', user.tokenHash));
  q(await db().from('trusted_devices').delete().eq('email', user.email));
  return { done: true };
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
  const color = COLOR_RE.test(String(payload.color || '')) ? String(payload.color).toLowerCase() : '';
  if (!name) fail('Client name is required.', 'VALIDATION');

  if (id) {
    const change = { name, notify_email: notifyEmail, currency, color };
    if (payload.timeTracking !== undefined) change.time_tracking = Boolean(payload.timeTracking);
    const updated = q(await db().from('clients')
      .update(change)
      .eq('id', id).select().maybeSingle());
    if (!updated) fail('Client not found.', 'NOT_FOUND');
    return { client: clientOut(updated, true) };
  }

  if (parentId) {
    const parent = await getClientRow(parentId);
    if (!parent) fail('Parent client not found.', 'VALIDATION');
    if (parent.parent_id) fail('Only one level of client nesting is allowed.', 'VALIDATION');
  }
  await checkClientLimit(1);

  // New clients go to the end of their group.
  const siblings = q(await (parentId
    ? db().from('clients').select('sort_order').eq('parent_id', parentId)
    : db().from('clients').select('sort_order,parent_id')));
  const groupOrders = siblings.filter((s) => parentId || !s.parent_id).map((s) => s.sort_order || 0);
  const sortOrder = groupOrders.length ? Math.max.apply(null, groupOrders) + 1 : 0;

  const saved = q(await db().from('clients').insert({
    id: newId('cli'),
    name,
    parent_id: parentId || null,
    token: null,
    notify_email: notifyEmail,
    currency,
    color,
    sort_order: sortOrder,
    portal_access: 'view',
    time_tracking: Boolean(payload.timeTracking),
    archived: false,
    created_at: nowIso()
  }).select().single());
  return { client: clientOut(saved, true) };
}

// payload.ids: the full new order of one group (all parent clients, or one parent's sub-clients).
async function handleReorderClients(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const ids = (Array.isArray(payload.ids) ? payload.ids : []).map(String);
  if (ids.length === 0) return { ids: [] };
  if (new Set(ids).size !== ids.length) fail('Duplicate clients in the new order.', 'VALIDATION');
  const rows = q(await db().from('clients').select('id,parent_id').in('id', ids));
  if (rows.length !== ids.length) fail('Some clients were not found. Refresh and try again.', 'NOT_FOUND');
  const parent = rows[0].parent_id || null;
  if (rows.some((r) => (r.parent_id || null) !== parent)) {
    fail('Clients can only be reordered within the same group.', 'VALIDATION');
  }
  for (let i = 0; i < ids.length; i++) {
    q(await db().from('clients').update({ sort_order: i }).eq('id', ids[i]));
  }
  return { ids };
}

async function handleSetPortalAccess(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const clientId = String(payload.clientId || '');
  const access = payload.access === 'edit' ? 'edit' : 'view';
  const updated = q(await db().from('clients').update({ portal_access: access }).eq('id', clientId).select('id').maybeSingle());
  if (!updated) fail('Client not found.', 'NOT_FOUND');
  return { clientId, portalAccess: access };
}

/* ---------- Tag library ---------- */

// payload.tags: the complete library in display order: [{ id?, name, color }].
// Renaming a tag also renames it on every post that uses it.
async function handleSaveTags(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const incoming = Array.isArray(payload.tags) ? payload.tags : [];
  const seen = {};
  const clean = [];
  for (const t0 of incoming) {
    const t = t0 || {};
    const name = String(t.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen[key]) fail('The tag "' + name + '" is listed twice.', 'VALIDATION');
    seen[key] = true;
    clean.push({
      id: t.id ? String(t.id) : '',
      name,
      color: COLOR_RE.test(String(t.color || '')) ? String(t.color).toLowerCase() : ''
    });
  }

  const existing = await all('tags', null, ['sort_order', 'name']);
  const byId = {};
  for (const t of existing) byId[t.id] = t;

  // Renames first, so posts keep their tags.
  for (const t of clean) {
    const old = t.id && byId[t.id];
    if (old && old.name !== t.name) {
      const posts = await all('posts', (b) => b.contains('tags', [old.name]), ['id']);
      for (const p of posts) {
        const tags = (p.tags || []).map((x) => (x === old.name ? t.name : x));
        q(await db().from('posts').update({ tags }).eq('id', p.id));
      }
    }
  }

  const keepIds = clean.filter((t) => t.id && byId[t.id]).map((t) => t.id);
  const removed = existing.filter((t) => keepIds.indexOf(t.id) === -1).map((t) => t.id);
  if (removed.length) q(await db().from('tags').delete().in('id', removed));

  // Two passes avoid clashing with the unique name index while names swap.
  const rows = clean.map((t, i) => ({
    id: t.id && byId[t.id] ? t.id : newId('tag'),
    name: t.name,
    color: t.color,
    sort_order: i,
    created_at: t.id && byId[t.id] ? (byId[t.id].created_at || nowIso()) : nowIso()
  }));
  if (rows.length) {
    q(await db().from('tags').upsert(rows.map((r) => ({ ...r, name: '~tmp~' + r.id })), { onConflict: 'id' }));
    q(await db().from('tags').upsert(rows, { onConflict: 'id' }));
  }
  return { tags: rows.map(tagOut) };
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
  if (!archive && target.archived) await checkClientLimit(1);

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
  const update = { token: newToken };
  if (payload.access === 'edit' || payload.access === 'view') update.portal_access = payload.access;

  const updated = q(await db().from('clients').update(update).eq('id', clientId).select('id,portal_access').maybeSingle());
  if (!updated) fail('Client not found.', 'NOT_FOUND');
  return {
    clientId,
    token: newToken || '',
    portalAccess: updated.portal_access === 'edit' ? 'edit' : 'view',
    webAppUrl: appUrl()
  };
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
      '<p><a href="' + escapeHtml(link) + '" style="display:inline-block;background:#1d1d1f;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px">Open client portal</a></p>' +
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

function cleanTags(raw) {
  const seen = {};
  return (Array.isArray(raw) ? raw : String(raw || '').split(','))
    .map((t) => String(t).trim().replace(/\s+/g, ' ').slice(0, 40))
    .filter((t) => t && !seen[t.toLowerCase()] && (seen[t.toLowerCase()] = true));
}

function cleanPlatforms(raw) {
  return (Array.isArray(raw) ? raw : []).filter((pl) => PLATFORMS.includes(pl));
}

// Field-by-field summary for the post's History tab.
function describePostChanges(existing, next) {
  const changes = [];
  if (next.status !== undefined && existing.status !== next.status) changes.push('Status: ' + existing.status + ' → ' + next.status);
  if ((existing.text || '') !== next.text) changes.push('Copy updated');
  if ((existing.date || '') !== next.date || (existing.time || '') !== next.time) {
    changes.push('Schedule: ' + ((existing.date || 'Unscheduled') + ' ' + (existing.time || '')).trim() +
      ' → ' + ((next.date || 'Unscheduled') + ' ' + next.time).trim());
  }
  const exPlats = (existing.platforms || []).join(', ');
  const newPlats = next.platforms.join(', ');
  if (exPlats !== newPlats) changes.push('Platforms: ' + (exPlats || 'None') + ' → ' + (newPlats || 'None'));
  if ((existing.tags || []).join(', ') !== next.tags.join(', ')) changes.push('Tags updated');
  if (JSON.stringify(sanitizeAssets(existing.assets)) !== JSON.stringify(next.assets)) changes.push('Final design updated');
  if (JSON.stringify(sanitizeAssets(existing.ref_assets)) !== JSON.stringify(next.ref_assets)) changes.push('Reference images updated');
  return changes;
}

async function notifyAgencyOfClientPost(clientName, postText, isNew) {
  try {
    const settings = await getSettings();
    if (!settings.agencyEmail) return;
    const headline = clientName + (isNew ? ' added a new post' : ' edited a post');
    const html = '<div style="font-family:sans-serif;color:#1e293b;max-width:560px">' +
      '<h2 style="font-size:18px;margin-bottom:8px">' + escapeHtml(headline) + '</h2>' +
      '<div style="background:#f8fafc;border-left:4px solid #1d1d1f;padding:12px 16px;margin:12px 0;font-size:14px">' + escapeHtml(snippetOf(postText)) + '</div>' +
      (appUrl() ? '<p><a href="' + escapeHtml(appUrl() + '/app') + '" style="color:#1d1d1f;font-weight:600">Open Flokey</a></p>' : '') +
      '</div>';
    await sendEmail({ to: settings.agencyEmail, subject: '[' + settings.agencyName + '] ' + headline, html });
  } catch (e) {
    console.error('Client post notification failed:', e);
  }
}

// Clients with an "add & edit" link: create posts, or edit ones not yet Scheduled/Published.
// They can't change status, assignee, metrics or the live URL.
async function handlePortalSavePost(auth, payload) {
  await enterFromAuth(auth);
  const id = String(payload.id || '').trim();
  let clientId = String(payload.clientId || '').trim();
  let existing = null;
  if (id) {
    existing = await getPostRow(id);
    if (!existing) fail('Post not found.', 'NOT_FOUND');
    clientId = existing.client_id;
  }
  if (!clientId) fail('Please choose a brand for this post.', 'VALIDATION');
  const ctx = await requireClientEditAuth(auth, clientId);
  const who = clientDisplayName(ctx, clientId);
  if (existing && LOCKED_FOR_CLIENTS.includes(existing.status)) {
    fail('This post is already ' + existing.status.toLowerCase() + '. Ask the agency if it needs changes.', 'FORBIDDEN');
  }

  const fields = {
    text: String(payload.text || ''),
    tags: cleanTags(payload.tags),
    platforms: cleanPlatforms(payload.platforms),
    date: String(payload.date || '').trim(),
    time: String(payload.time || '').trim(),
    ref_assets: sanitizeAssets(payload.refAssets)
  };
  const now = nowIso();
  let saved;

  if (existing) {
    // The final design belongs to the agency, so a client save never changes it.
    const changes = describePostChanges(existing, { ...fields, assets: sanitizeAssets(existing.assets) });
    if (changes.length === 0) return { post: postOut(existing, true), activity: null };
    saved = q(await db().from('posts').update({ ...fields, updated_by: who, updated_at: now })
      .eq('id', existing.id).select().single());
    await logActivity(saved.id, saved.client_id, who + ' (client)', 'updated', changes.join('; '));
  } else {
    saved = q(await db().from('posts').insert({
      id: newId('pst'),
      client_id: clientId,
      ...fields,
      assets: [],
      status: 'Draft',
      live_url: '',
      metrics: {},
      assignee: '',
      created_by: who,
      created_by_type: 'client',
      updated_by: who,
      created_at: now,
      updated_at: now
    }).select().single());
    await logActivity(saved.id, clientId, who + ' (client)', 'created', 'Added by the client');
  }
  await notifyAgencyOfClientPost(who, saved.text, !existing);
  return { post: postOut(saved, true), activity: null };
}

async function handleSavePost(auth, payload) {
  if (auth && auth.clientToken) return handlePortalSavePost(auth, payload);
  const user = await requireAgencyAuth(auth, EDITORS);
  const id = String(payload.id || '').trim();
  const clientId = String(payload.clientId || '').trim();
  if (!clientId) fail('Please select a sub-client for this post.', 'VALIDATION');

  const client = await getClientRow(clientId);
  if (!client) fail('Client not found.', 'NOT_FOUND');

  const status = STATUSES.includes(payload.status) ? payload.status : 'Draft';
  const text = String(payload.text || '');
  const tags = cleanTags(payload.tags);
  const platforms = cleanPlatforms(payload.platforms);
  const dateStr = String(payload.date || '').trim();
  const timeStr = String(payload.time || '').trim();
  const assignee = String(payload.assignee || '').trim();
  const liveUrl = String(payload.liveUrl || '').trim();
  const assets = sanitizeAssets(payload.assets);
  const refAssets = sanitizeAssets(payload.refAssets);
  const metrics = normalizeMetrics(payload.metrics);
  const column = await resolveColumn(clientId, payload.columnId);
  const columnId = column && column.after_status === status ? column.id : '';

  const now = nowIso();
  let saved;
  let oldStatus = null;
  let activity = null;

  if (id) {
    const existing = await getPostRow(id);
    if (!existing) fail('Post not found.', 'NOT_FOUND');
    oldStatus = existing.status;

    const changes = describePostChanges(existing, { status, text, date: dateStr, time: timeStr, platforms, tags, assets, ref_assets: refAssets });
    if ((existing.assignee || '') !== assignee) {
      changes.push('Assignee: ' + (existing.assignee || 'Unassigned') + ' → ' + (assignee || 'Unassigned'));
    }
    if ((existing.live_url || '') !== liveUrl) changes.push('Live URL updated');
    if ((existing.column_id || '') !== columnId) changes.push(column && columnId ? 'Moved to column "' + column.name + '"' : 'Column changed');
    if (JSON.stringify(normalizeMetrics(existing.metrics)) !== JSON.stringify(metrics) && status === 'Published') {
      changes.push('Metrics updated');
    }

    if (changes.length === 0) {
      return { post: postOut(existing, false), activity: null, clientToken: BILLING.includes(user.role) ? (client.token || '') : '' };
    }
    saved = q(await db().from('posts').update({
      text, status, tags, platforms, date: dateStr, time: timeStr, assets, ref_assets: refAssets, column_id: columnId,
      live_url: liveUrl, metrics, assignee, updated_by: user.name, updated_at: now
    }).eq('id', id).select().single());

    activity = await logActivity(id, saved.client_id, user.name, 'updated', changes.join('; '));
  } else {
    saved = q(await db().from('posts').insert({
      id: newId('pst'),
      client_id: clientId,
      text, status, tags, platforms, date: dateStr, time: timeStr, assets, ref_assets: refAssets, column_id: columnId,
      live_url: liveUrl, metrics, assignee,
      created_by: user.name, created_by_type: 'team', updated_by: user.name,
      created_at: now, updated_at: now
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

// A custom column is valid for a post only if it belongs to the same brand. Being in a
// custom column also sets the post's stage to the stage that column sits after.
async function resolveColumn(clientId, columnId) {
  if (!columnId) return null;
  const col = q(await db().from('board_columns').select('*').eq('id', String(columnId)).maybeSingle());
  return col && col.client_id === clientId ? col : null;
}

async function handleSaveBoardColumn(auth, payload) {
  await requireAgencyAuth(auth, EDITORS);
  const id = String(payload.id || '').trim();
  const name = String(payload.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) fail('Please give the column a name.', 'VALIDATION');
  const color = COLOR_RE.test(String(payload.color || '')) ? String(payload.color).toLowerCase() : '';
  const afterStatus = STATUSES.includes(payload.afterStatus) ? payload.afterStatus : 'Draft';

  if (id) {
    const existing = q(await db().from('board_columns').select('*').eq('id', id).maybeSingle());
    if (!existing) fail('Column not found.', 'NOT_FOUND');
    const saved = q(await db().from('board_columns').update({ name, color, after_status: afterStatus }).eq('id', id).select().single());
    if (existing.after_status !== afterStatus) {
      // Posts in the column follow it to its new stage.
      q(await db().from('posts').update({ status: afterStatus }).eq('column_id', id));
    }
    return { column: columnOut(saved) };
  }

  const clientId = String(payload.clientId || '');
  const client = await getClientRow(clientId);
  if (!client) fail('Client not found.', 'NOT_FOUND');
  const siblings = q(await db().from('board_columns').select('sort_order').eq('client_id', clientId));
  const sortOrder = siblings.length ? Math.max.apply(null, siblings.map((c) => c.sort_order || 0)) + 1 : 0;
  const saved = q(await db().from('board_columns').insert({
    id: newId('col'), client_id: clientId, name, color, after_status: afterStatus, sort_order: sortOrder, created_at: nowIso()
  }).select().single());
  return { column: columnOut(saved) };
}

async function handleDeleteBoardColumn(auth, payload) {
  await requireAgencyAuth(auth, EDITORS);
  const id = String(payload.id || '');
  const col = q(await db().from('board_columns').select('*').eq('id', id).maybeSingle());
  if (!col) fail('Column not found.', 'NOT_FOUND');
  // Posts in it go back to the core column of the same stage.
  q(await db().from('posts').update({ column_id: '' }).eq('column_id', id));
  q(await db().from('board_columns').delete().eq('id', id));
  return { deletedId: id, clientId: col.client_id };
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
  if (payload.columnId !== undefined) {
    const col = await resolveColumn(target.client_id, payload.columnId);
    const nextColumn = col ? col.id : '';
    if (nextColumn !== (target.column_id || '')) {
      changes.push(col ? 'Moved to column "' + col.name + '"' : 'Moved out of custom column');
      update.column_id = nextColumn;
    }
    if (col && col.after_status !== (update.status || target.status)) {
      changes.push('Status: ' + (update.status || target.status) + ' → ' + col.after_status);
      update.status = col.after_status;
    }
  } else if (update.status && target.column_id) {
    update.column_id = ''; // changing stage directly leaves the custom column
  }
  if (changes.length === 0) {
    return { post: postOut(target, false), activity: null };
  }

  update.updated_at = nowIso();
  update.updated_by = user.name;
  const saved = q(await db().from('posts').update(update).eq('id', target.id).select().single());
  const activity = await logActivity(saved.id, saved.client_id, user.name, 'updated', changes.join('; '));

  if (saved.status === 'In Review' && oldStatus !== 'In Review') {
    const client = await getClientRow(saved.client_id);
    if (client) await notifyInReview(client, saved.text, 'moved a post to');
  }

  return { post: postOut(saved, false), activity };
}

async function handleDeletePost(auth, payload) {
  await enterFromAuth(auth);
  const postId = String(payload.postId || '');
  const target = await getPostRow(postId);
  if (!target) fail('Post not found.', 'NOT_FOUND');

  let actor;
  if (auth && auth.clientToken) {
    // Clients may delete only posts they added themselves, before they're scheduled.
    const ctx = await requireClientEditAuth(auth, target.client_id);
    if (target.created_by_type !== 'client') fail('You can only delete posts you added.', 'FORBIDDEN');
    if (LOCKED_FOR_CLIENTS.includes(target.status)) {
      fail('This post is already ' + target.status.toLowerCase() + '. Ask the agency to remove it.', 'FORBIDDEN');
    }
    actor = clientDisplayName(ctx, target.client_id) + ' (client)';
  } else {
    actor = (await requireAgencyAuth(auth, EDITORS)).name;
  }

  q(await db().from('posts').delete().eq('id', postId)); // comments cascade
  const snippet = (target.text || '').substring(0, 50);
  const activity = await logActivity(postId, target.client_id, actor, 'deleted',
    'Deleted post' + (snippet ? ': "' + snippet + '"' : ''));
  return { deletedId: postId, activity: auth && auth.clientToken ? null : activity };
}

// Replaces uploadAsset: the browser uploads the file straight to Supabase Storage
// using this one-time signed URL, so large files never pass through the API.
async function handleCreateUpload(auth, payload) {
  // Comment images: anyone who can comment (every client link) may attach them.
  const forComment = payload.purpose === 'comment';
  if (auth && auth.clientToken) {
    if (forComment) await requireClientTokenAuth(auth, String(payload.clientId || ''));
    else await requireClientEditAuth(auth, String(payload.clientId || ''));
  } else {
    await requireAgencyAuth(auth, EDITORS);
  }
  const clientId = String(payload.clientId || '');
  const name = String(payload.name || 'upload');
  const mimeType = String(payload.mimeType || '').toLowerCase();
  const size = Number(payload.size || 0);

  if (!clientId) fail('Select a client before uploading files.', 'VALIDATION');
  if (mimeType.indexOf('image/') !== 0 && mimeType.indexOf('video/') !== 0) {
    fail('Only image and video files are allowed.', 'VALIDATION');
  }
  if (forComment && mimeType.indexOf('image/') !== 0) fail('Only images can be added to comments.', 'VALIDATION');
  if (!(size > 0)) fail('Empty file data.', 'VALIDATION');
  if (size > MAX_UPLOAD_BYTES) fail('File exceeds the 20 MB maximum size limit.', 'VALIDATION');
  if (!(await getClientRow(clientId))) fail('Client not found.', 'NOT_FOUND');

  const safeName = name.replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(-80) || 'upload';
  const path = (forComment ? 'comments/' : 'posts/') + clientId + '/' + newId('') + '-' + safeName;
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
  if (auth && auth.clientToken) await requireClientEditAuth(auth, null);
  else await requireAgencyAuth(auth, EDITORS);
  const input = String(payload.url || '').trim();
  if (!input) fail('Please paste a Google Drive file link or ID.', 'VALIDATION');
  const match = input.match(/[-\w]{25,}/);
  if (!match) fail('That does not look like a Google Drive file link.', 'VALIDATION');
  return { asset: enrichAsset({ id: match[0], type: 'link', name: 'Google Drive file', src: 'drive' }) };
}

async function handleAddComment(auth, payload) {
  await enterFromAuth(auth);
  const postId = String(payload.postId || '');
  const text = String(payload.text || '').trim();
  const attachments = sanitizeAssets(payload.attachments).filter((a) => a.type === 'image').slice(0, 6);
  if (!postId) fail('Post ID is required.', 'VALIDATION');
  if (!text && !attachments.length) fail('Please write a comment or add an image.', 'VALIDATION');

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
    attachments,
    created_at: nowIso()
  }).select().single());
  const summary = text.substring(0, 120) + (attachments.length ? (text ? ' ' : '') + '(+' + attachments.length + ' image' + (attachments.length > 1 ? 's' : '') + ')' : '');
  const act = await logActivity(post.id, post.client_id, activityActor, 'commented', summary);

  if (isClient) {
    const settings = await getSettings();
    if (settings.agencyEmail) {
      const html = '<div style="font-family:sans-serif;color:#1e293b;max-width:560px">' +
        '<h2 style="font-size:18px;margin-bottom:8px">New client comment from ' + escapeHtml(authorName) + '</h2>' +
        '<p style="font-size:14px;color:#475569">On post scheduled for <strong>' + escapeHtml(post.date || 'Unscheduled') + '</strong>:</p>' +
        '<div style="background:#f8fafc;border-left:4px solid #1d1d1f;padding:12px 16px;margin:12px 0;font-size:14px">' + escapeHtml(summary || '(image)') + '</div>' +
        '</div>';
      await sendEmail({ to: settings.agencyEmail, subject: '[' + settings.agencyName + '] New comment from ' + authorName, html });
    }
  }

  return { comment: commentOut(comment), activity: isClient ? null : act };
}

async function handleClientDecision(auth, payload) {
  await enterFromAuth(auth);
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
    .update({ status: newStatus, updated_by: cName, updated_at: nowIso() })
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
  // Numbers are shared by a main client and all its sub-clients, so invoices made on the
  // main client never repeat a number already used on one of its sub-clients.
  const familyRoot = client.parent_id || client.id;
  const family = q(await db().from('clients').select('id').eq('parent_id', familyRoot)).map((c) => c.id).concat([familyRoot]);
  const existing = q(await db().from('invoices').select('id,number').in('client_id', family));

  let number = String(payload.number || '').trim();
  const duplicateMsg = () => 'Invoice number "' + number + '" is already used for this client.';
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
  // Hours billed on this invoice become unbilled again.
  q(await db().from('time_entries').update({ invoice_id: '' }).eq('invoice_id', invoiceId));
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

  let emailed = false;
  let portalLinkForInvoice = '';
  if (alsoSendEmail) {
    // Sending makes the invoice visible in the client portal, and emails it if we can.
    update.sent_at = nowIso();
    const parent = client && client.parent_id ? await getClientRow(client.parent_id) : null;
    const linkOwner = client && client.token ? client : (parent && parent.token ? parent : null);
    if (linkOwner) portalLinkForInvoice = portalLink(linkOwner.token);
    const recipient = await getEffectiveClientEmail(client);
    if (recipient) {
      const html = '<div style="font-family:sans-serif;color:#1e293b;max-width:560px">' +
        '<h2 style="font-size:18px;margin-bottom:8px">Invoice ' + escapeHtml(target.number) + ' from ' + escapeHtml(settings.agencyName) + '</h2>' +
        '<p style="font-size:14px;color:#475569;line-height:1.5">Please find attached invoice <strong>' + escapeHtml(target.number) + '</strong> due on <strong>' + escapeHtml(target.due_date) + '</strong>.</p>' +
        (portalLinkForInvoice ? '<p><a href="' + escapeHtml(portalLinkForInvoice) + '" style="display:inline-block;background:#1d1d1f;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px">View in your client portal</a></p>' : '') +
        '</div>';
      emailed = await sendEmail({
        to: recipient,
        subject: 'Invoice ' + target.number + ' from ' + settings.agencyName,
        html,
        attachments: [{ filename: safeNumber + '.pdf', content: Buffer.from(bytes).toString('base64') }]
      });
    }
  }

  q(await db().from('invoices').update(update).eq('id', target.id));

  return {
    invoiceId: target.id,
    clientId: target.client_id,
    pdfFileId: path,
    pdfUrl: update.pdf_url,
    sentAt: update.sent_at || target.sent_at || '',
    emailed,
    inPortal: Boolean(alsoSendEmail && portalLinkForInvoice)
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

  const plan = currentPlan();
  if (plan.limits.seats !== null && plan.limits.seats !== undefined && nextRows.length > plan.limits.seats) {
    fail('Your ' + plan.planName + ' plan includes up to ' + plan.limits.seats + ' team members. Upgrade in Settings → Plan to add more.', 'PLAN_LIMIT');
  }

  // A person can belong to one Flokey workspace.
  const newEmails = nextRows.map((r) => r.email).filter((e) => !existingByEmail[e]);
  if (newEmails.length) {
    const taken = q(await rawDb().from('team').select('email').in('email', newEmails));
    if (taken.length) fail(taken[0].email + ' already has a Flokey account with another agency, so it can\'t be added here.', 'VALIDATION');
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
    team: nextRows.map((t) => teamOut({ ...(existingByEmail[t.email] || {}), ...t }))
  };
}

/* ==========================================================================
   SIGN-UP (new agencies), GOOGLE SIGN-IN & PLANS
   ========================================================================== */

const MAX_SIGNUPS_PER_HOUR = 5;

// Slows down scripted sign-ups: a few new workspaces per network address per hour.
async function limitSignups(meta) {
  const ip = String((meta && meta.ip) || 'unknown');
  const key = 'signup_' + sha256Hex(ip).substring(0, 24);
  const row = q(await db().from('login_attempts').select('count,reset_at').eq('key', key).maybeSingle());
  const active = Boolean(row) && new Date(row.reset_at).getTime() > Date.now();
  if (active && row.count >= MAX_SIGNUPS_PER_HOUR) {
    fail('Too many new accounts from this network. Please try again in an hour.', 'LOCKED');
  }
  q(await db().from('login_attempts').upsert({
    key,
    count: (active ? row.count : 0) + 1,
    reset_at: active ? row.reset_at : new Date(Date.now() + 3600000).toISOString()
  }, { onConflict: 'key' }));
}

function cleanAgencyName(v) {
  const name = String(v || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) fail('Please enter your agency or business name.', 'VALIDATION');
  return name;
}

// New agency: its own workspace on a free trial, with this person as Admin.
async function createWorkspace(agencyName, email) {
  const id = newId('ws');
  q(await rawDb().from('workspaces').insert({
    id,
    name: agencyName,
    plan: 'trial',
    trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(),
    owner_email: email,
    created_at: nowIso()
  }));
  await enterWorkspace(id, 'team');
  await saveSettings({ ...SETTINGS_DEFAULTS, agencyName, agencyEmail: email });
  return id;
}

async function handleSignup(payload, meta) {
  if (!signupsEnabled()) fail('New sign-ups are turned off right now.', 'SIGNUPS_OFF');
  const agencyName = cleanAgencyName(payload.agencyName);
  const name = String(payload.name || '').trim().slice(0, 80);
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!name) fail('Please enter your name.', 'VALIDATION');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Please enter a valid email address.', 'VALIDATION');
  if (password.length < 8) fail('Password must be at least 8 characters.', 'VALIDATION');

  if (q(await rawDb().from('team').select('email').eq('email', email).maybeSingle())) {
    fail('An account with this email already exists. Sign in instead.', 'EMAIL_TAKEN');
  }
  await limitSignups(meta);
  await createWorkspace(agencyName, email);

  const { salt, passHash } = await hashPassword(password);
  const member = q(await db().from('team').insert({ email, name, role: 'Admin', pass_hash: passHash, salt }).select().single());

  // Confirm the email address with a code before the first sign-in.
  if (loginCodesEnabled()) return startLoginChallenge(member);
  return finishLogin(member, payload.deviceLabel, true);
}

async function handleGoogleAuth(payload, meta) {
  const g = await verifyGoogleCredential(payload.credential);
  const existing = q(await rawDb().from('team').select('*').eq('email', g.email).maybeSingle());
  if (existing) {
    // Google has already confirmed the email, so no emailed code is needed.
    await enterWorkspace(existing.workspace_id, 'team');
    return finishLogin(existing, payload.deviceLabel, true);
  }
  if (!signupsEnabled()) {
    fail('No Flokey account uses ' + g.email + '. Ask your agency\'s admin to add you.', 'NO_ACCOUNT');
  }
  if (!String(payload.agencyName || '').trim()) {
    // New person: the app asks for their agency name, then calls again.
    return { needsAgency: true, email: g.email, name: g.name };
  }
  const agencyName = cleanAgencyName(payload.agencyName);
  await limitSignups(meta);
  await createWorkspace(agencyName, g.email);
  // Google accounts get a random password; they sign in with Google.
  const { salt, passHash } = await hashPassword(randomToken(32));
  const member = q(await db().from('team').insert({
    email: g.email, name: g.name, role: 'Admin', pass_hash: passHash, salt, avatar_url: g.picture
  }).select().single());
  return finishLogin(member, payload.deviceLabel, true);
}

// Payments come later: for now an upgrade request is recorded and emailed to you.
async function handleRequestUpgrade(auth, payload) {
  const user = await requireAgencyAuth(auth, ['Admin']);
  const plan = PLANS.find((p) => p.id === String(payload.plan || ''));
  if (!plan) fail('Please choose a plan.', 'VALIDATION');
  const ws = currentWorkspace();
  q(await rawDb().from('workspaces').update({ requested_plan: plan.id }).eq('id', ws));
  requestContext().workspace = { ...requestContext().workspace, requested_plan: plan.id };

  const to = String(process.env.PLATFORM_EMAIL || '').trim();
  if (to) {
    const settings = await getSettings();
    const html = '<div style="font-family:sans-serif;color:#1e293b;max-width:520px">' +
      '<h2 style="font-size:18px">Upgrade request</h2>' +
      '<p style="font-size:14px;line-height:1.6"><strong>' + escapeHtml(settings.agencyName) + '</strong> wants the <strong>' +
      escapeHtml(plan.name) + '</strong> plan ($' + plan.price + '/month).</p>' +
      '<p style="font-size:14px;line-height:1.6">Requested by ' + escapeHtml(user.name) + ' (' + escapeHtml(user.email) + ')<br>' +
      'Workspace ID: <code>' + escapeHtml(ws) + '</code></p>' +
      '<p style="font-size:13px;color:#64748b">To activate it: Supabase → Table Editor → workspaces → set <code>plan</code> to <code>' +
      escapeHtml(plan.id) + '</code> for this workspace.</p></div>';
    await sendEmail({ to, subject: 'Upgrade request: ' + settings.agencyName + ' → ' + plan.name, html });
  }
  return { requestedPlan: plan.id };
}

/* ==========================================================================
   PROJECTS, TASKS & TIME TRACKING
   ========================================================================== */

const PROJECT_STATUSES = ['Planning', 'Active', 'On hold', 'Done'];
const TASK_STATUSES = ['To do', 'In progress', 'Review', 'Done'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ENTRY_MINUTES = 24 * 60;

function projectOut(p, isBilling) {
  return {
    id: p.id, clientId: p.client_id, name: p.name, description: p.description || '',
    status: PROJECT_STATUSES.includes(p.status) ? p.status : 'Active',
    startDate: p.start_date || '', dueDate: p.due_date || '',
    budget: isBilling ? (p.budget || '') : '',
    owner: p.owner || '', sortOrder: p.sort_order || 0,
    createdAt: p.created_at || '', updatedAt: p.updated_at || ''
  };
}

function taskOut(t) {
  return {
    id: t.id, projectId: t.project_id, title: t.title, notes: t.notes || '',
    status: TASK_STATUSES.includes(t.status) ? t.status : 'To do',
    assignee: t.assignee || '', dueDate: t.due_date || '', estimateHours: t.estimate_hours || '',
    sortOrder: t.sort_order || 0, createdBy: t.created_by || '',
    createdAt: t.created_at || '', completedAt: t.completed_at || ''
  };
}

function timeOut(e) {
  return {
    id: e.id, projectId: e.project_id, taskId: e.task_id || '', userEmail: e.user_email,
    date: e.date, minutes: e.minutes || 0, note: e.note || '', billable: e.billable !== false,
    invoiceId: e.invoice_id || '', startedAt: e.started_at || '', createdAt: e.created_at || ''
  };
}

function cleanDate(v, label) {
  const d = String(v || '').trim();
  if (d && !DATE_RE.test(d)) fail(label + ' must be a date (yyyy-mm-dd).', 'VALIDATION');
  return d;
}

function cleanHours(v) {
  const raw = String(v === undefined || v === null ? '' : v).trim();
  if (!raw) return '';
  const n = Number(raw);
  if (!(n >= 0) || n > 10000) fail('Estimate must be a number of hours.', 'VALIDATION');
  return String(Math.round(n * 100) / 100);
}

async function teamEmailOrBlank(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  const m = q(await db().from('team').select('email').eq('email', e).maybeSingle());
  if (!m) fail('That person is not on your team.', 'VALIDATION');
  return e;
}

async function getProjectRow(id) {
  if (!id) return null;
  return q(await db().from('projects').select('*').eq('id', id).maybeSingle());
}

async function getTaskRow(id) {
  if (!id) return null;
  return q(await db().from('tasks').select('*').eq('id', id).maybeSingle());
}

async function handleSaveProject(auth, payload) {
  const user = await requireAgencyAuth(auth, EDITORS);
  const isBilling = BILLING.includes(user.role);
  const id = String(payload.id || '').trim();
  const name = String(payload.name || '').trim().slice(0, 120);
  if (!name) fail('Please give the project a name.', 'VALIDATION');
  const clientId = String(payload.clientId || '').trim();
  const client = await getClientRow(clientId);
  if (!client) fail('Please choose a client for this project.', 'VALIDATION');

  const fields = {
    client_id: clientId,
    name,
    description: String(payload.description || '').slice(0, 4000),
    status: PROJECT_STATUSES.includes(payload.status) ? payload.status : 'Active',
    start_date: cleanDate(payload.startDate, 'Start date'),
    due_date: cleanDate(payload.dueDate, 'Due date'),
    owner: await teamEmailOrBlank(payload.owner),
    updated_at: nowIso()
  };
  // Only people who can see invoices can see or change budgets.
  if (isBilling) {
    const budget = String(payload.budget === undefined || payload.budget === null ? '' : payload.budget).trim();
    if (budget && !(Number(budget) >= 0)) fail('Budget must be a number.', 'VALIDATION');
    fields.budget = budget;
  }

  let saved;
  if (id) {
    saved = q(await db().from('projects').update(fields).eq('id', id).select().maybeSingle());
    if (!saved) fail('Project not found.', 'NOT_FOUND');
  } else {
    const count = q(await db().from('projects').select('id')).length;
    saved = q(await db().from('projects').insert({
      id: newId('prj'), ...fields, budget: fields.budget || '', sort_order: count, created_at: nowIso()
    }).select().single());
  }
  return { project: projectOut(saved, isBilling) };
}

async function handleDeleteProject(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const id = String(payload.id || '');
  const project = await getProjectRow(id);
  if (!project) fail('Project not found.', 'NOT_FOUND');
  const billed = q(await db().from('time_entries').select('id').eq('project_id', id).neq('invoice_id', ''));
  if (billed.length) {
    fail('This project has hours on an invoice, so it can\'t be deleted. Set it to Done instead.', 'VALIDATION');
  }
  q(await db().from('projects').delete().eq('id', id)); // tasks and time entries cascade
  return { deletedId: id, clientId: project.client_id };
}

async function handleSaveTask(auth, payload) {
  const user = await requireAgencyAuth(auth, EDITORS);
  const id = String(payload.id || '').trim();
  const title = String(payload.title || '').trim().slice(0, 200);
  if (!title) fail('Please give the task a title.', 'VALIDATION');

  const existing = id ? await getTaskRow(id) : null;
  if (id && !existing) fail('Task not found.', 'NOT_FOUND');
  const projectId = String(payload.projectId || (existing && existing.project_id) || '');
  if (!(await getProjectRow(projectId))) fail('Project not found.', 'NOT_FOUND');

  const status = TASK_STATUSES.includes(payload.status) ? payload.status : (existing ? existing.status : 'To do');
  const fields = {
    project_id: projectId,
    title,
    notes: String(payload.notes || '').slice(0, 8000),
    status,
    assignee: await teamEmailOrBlank(payload.assignee),
    due_date: cleanDate(payload.dueDate, 'Due date'),
    estimate_hours: cleanHours(payload.estimateHours),
    completed_at: status === 'Done' ? ((existing && existing.completed_at) || nowIso()) : ''
  };

  let saved;
  if (existing) {
    saved = q(await db().from('tasks').update(fields).eq('id', id).select().single());
  } else {
    const inCol = q(await db().from('tasks').select('sort_order').eq('project_id', projectId).eq('status', status));
    const sortOrder = inCol.length ? Math.max.apply(null, inCol.map((t) => t.sort_order || 0)) + 1 : 0;
    saved = q(await db().from('tasks').insert({
      id: newId('tsk'), ...fields, sort_order: sortOrder, created_by: user.name, created_at: nowIso()
    }).select().single());
  }
  return { task: taskOut(saved) };
}

// payload: { id, status, order: [task ids in the target column, top to bottom] }
async function handleMoveTask(auth, payload) {
  await requireAgencyAuth(auth, EDITORS);
  const id = String(payload.id || '');
  const task = await getTaskRow(id);
  if (!task) fail('Task not found.', 'NOT_FOUND');
  const status = TASK_STATUSES.includes(payload.status) ? payload.status : task.status;
  const update = { status };
  if (status !== task.status) update.completed_at = status === 'Done' ? nowIso() : '';
  q(await db().from('tasks').update(update).eq('id', id));

  const order = (Array.isArray(payload.order) ? payload.order : []).map(String);
  if (order.length) {
    const rows = q(await db().from('tasks').select('id').eq('project_id', task.project_id).in('id', order));
    const valid = new Set(rows.map((r) => r.id));
    let i = 0;
    for (const tid of order) {
      if (!valid.has(tid)) continue;
      q(await db().from('tasks').update({ sort_order: i++ }).eq('id', tid));
    }
  }
  const saved = await getTaskRow(id);
  return { task: taskOut(saved) };
}

async function handleDeleteTask(auth, payload) {
  await requireAgencyAuth(auth, EDITORS);
  const id = String(payload.id || '');
  if (!(await getTaskRow(id))) fail('Task not found.', 'NOT_FOUND');
  q(await db().from('tasks').delete().eq('id', id));
  // Keep the hours (they still belong to the project), just unlink them from the task.
  q(await db().from('time_entries').update({ task_id: '' }).eq('task_id', id));
  return { deletedId: id };
}

/* ---------- Time ---------- */

// Stops this person's running timer (normally one; stops any extras left by a double click).
async function stopRunning(email) {
  const running = q(await db().from('time_entries').select('*').eq('user_email', email).neq('started_at', ''));
  let last = null;
  for (const run of running) {
    const minutes = Math.max(1, Math.min(MAX_ENTRY_MINUTES, Math.round((Date.now() - new Date(run.started_at).getTime()) / 60000)));
    last = q(await db().from('time_entries').update({ minutes, started_at: '' }).eq('id', run.id).select().single());
  }
  return last;
}

// Hours can only be tracked on projects whose client has time tracking switched on.
async function requireTracking(project) {
  const client = await getClientRow(project.client_id);
  if (!client || !client.time_tracking) {
    fail('Time tracking is off for this client. Turn it on in Client settings → Time tracking.', 'TRACKING_OFF');
  }
}

async function checkTaskInProject(taskId, projectId) {
  if (!taskId) return '';
  const task = await getTaskRow(taskId);
  if (!task || task.project_id !== projectId) fail('That task is not part of this project.', 'VALIDATION');
  return taskId;
}

async function handleStartTimer(auth, payload) {
  const user = await requireAgencyAuth(auth, EDITORS);
  const projectId = String(payload.projectId || '');
  const project = await getProjectRow(projectId);
  if (!project) fail('Please choose a project to track time on.', 'VALIDATION');
  await requireTracking(project);
  const taskId = await checkTaskInProject(String(payload.taskId || ''), projectId);
  const stopped = await stopRunning(user.email); // one timer per person
  const entry = q(await db().from('time_entries').insert({
    id: newId('tim'),
    project_id: projectId,
    task_id: taskId,
    user_email: user.email,
    date: todayStr(),
    minutes: 0,
    note: String(payload.note || '').slice(0, 500),
    billable: payload.billable !== false,
    invoice_id: '',
    started_at: new Date().toISOString(),
    created_at: nowIso()
  }).select().single());
  return { entry: timeOut(entry), stopped: stopped ? timeOut(stopped) : null };
}

async function handleStopTimer(auth) {
  const user = await requireAgencyAuth(auth, EDITORS);
  const stopped = await stopRunning(user.email);
  return { entry: stopped ? timeOut(stopped) : null };
}

async function handleSaveTimeEntry(auth, payload) {
  const user = await requireAgencyAuth(auth, EDITORS);
  const isBilling = BILLING.includes(user.role);
  const id = String(payload.id || '').trim();
  const existing = id ? q(await db().from('time_entries').select('*').eq('id', id).maybeSingle()) : null;
  if (id && !existing) fail('Time entry not found.', 'NOT_FOUND');
  if (existing && existing.user_email !== user.email && !isBilling) fail('You can only change your own hours.', 'FORBIDDEN');
  if (existing && existing.invoice_id) fail('These hours are already on an invoice. Delete the invoice first to change them.', 'VALIDATION');

  const projectId = String(payload.projectId || (existing && existing.project_id) || '');
  const project = await getProjectRow(projectId);
  if (!project) fail('Please choose a project.', 'VALIDATION');
  if (!existing || existing.project_id !== projectId) await requireTracking(project);
  const taskId = await checkTaskInProject(String(payload.taskId || ''), projectId);
  const date = cleanDate(payload.date || todayStr(), 'Date');
  const minutes = Math.round(Number(payload.minutes));
  const running = existing && existing.started_at;
  if (!running && !(minutes > 0 && minutes <= MAX_ENTRY_MINUTES)) fail('Enter the time worked (up to 24 hours).', 'VALIDATION');

  const fields = {
    project_id: projectId,
    task_id: taskId,
    date,
    note: String(payload.note || '').slice(0, 500),
    billable: payload.billable !== false
  };
  if (!running) fields.minutes = minutes;

  let saved;
  if (existing) {
    saved = q(await db().from('time_entries').update(fields).eq('id', id).select().single());
  } else {
    saved = q(await db().from('time_entries').insert({
      id: newId('tim'), ...fields, user_email: user.email, invoice_id: '', started_at: '', created_at: nowIso()
    }).select().single());
  }
  return { entry: timeOut(saved) };
}

async function handleDeleteTimeEntry(auth, payload) {
  const user = await requireAgencyAuth(auth, EDITORS);
  const id = String(payload.id || '');
  const e = q(await db().from('time_entries').select('*').eq('id', id).maybeSingle());
  if (!e) fail('Time entry not found.', 'NOT_FOUND');
  if (e.user_email !== user.email && !BILLING.includes(user.role)) fail('You can only delete your own hours.', 'FORBIDDEN');
  if (e.invoice_id) fail('These hours are already on an invoice. Delete the invoice first.', 'VALIDATION');
  q(await db().from('time_entries').delete().eq('id', id));
  return { deletedId: id };
}

// Turns unbilled hours for a client (and its sub-clients) into an invoice on the main client.
// payload: { clientId, from, to, rate, entryIds? }
async function handleInvoiceFromTime(auth, payload) {
  await requireAgencyAuth(auth, BILLING);
  const client = await getClientRow(String(payload.clientId || ''));
  if (!client) fail('Client not found.', 'NOT_FOUND');
  const rate = Number(payload.rate);
  if (!(rate > 0)) fail('Enter an hourly rate.', 'VALIDATION');
  const from = cleanDate(payload.from, 'From date');
  const to = cleanDate(payload.to, 'To date');

  const root = client.parent_id || client.id;
  const family = q(await db().from('clients').select('id').eq('parent_id', root)).map((c) => c.id).concat([root]);
  const projects = q(await db().from('projects').select('id,name,client_id').in('client_id', family));
  if (!projects.length) fail('This client has no projects with hours yet.', 'VALIDATION');
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));

  let entries = q(await db().from('time_entries').select('*').in('project_id', projects.map((p) => p.id))
    .eq('invoice_id', '').eq('billable', true).eq('started_at', ''));
  entries = entries.filter((e) => e.minutes > 0 && (!from || e.date >= from) && (!to || e.date <= to));
  if (Array.isArray(payload.entryIds)) {
    const pick = new Set(payload.entryIds.map(String));
    entries = entries.filter((e) => pick.has(e.id));
  }
  if (!entries.length) fail('There are no unbilled hours for this client in that period.', 'VALIDATION');

  const minutesByProject = {};
  for (const e of entries) minutesByProject[e.project_id] = (minutesByProject[e.project_id] || 0) + e.minutes;
  const items = Object.keys(minutesByProject).map((pid) => ({
    description: byId[pid].name + ' (hours)',
    qty: String(Math.round((minutesByProject[pid] / 60) * 100) / 100),
    rate: String(rate)
  }));
  const period = from || to ? 'Hours from ' + (from || 'the start') + ' to ' + (to || todayStr()) + '.' : '';

  const { invoice } = await handleSaveInvoice(auth, { clientId: root, items, notes: [period, payload.notes || ''].filter(Boolean).join('\n') });
  const ids = entries.map((e) => e.id);
  q(await db().from('time_entries').update({ invoice_id: invoice.id }).in('id', ids));
  return { invoice, billedEntryIds: ids, clientId: root };
}
