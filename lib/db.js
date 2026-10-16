import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@supabase/supabase-js';

export const BUCKET = 'assets';

let client = null;

/* ---------- Workspaces (one per agency) ----------
 * Every request runs inside a workspace scope. Once sign-in has worked out which
 * agency the request belongs to (setWorkspace), db() limits every read, update and
 * delete on agency tables to that workspace and stamps it on every insert, so one
 * agency can never see or change another's data. Before that, touching an agency
 * table throws instead of silently reading everyone's rows.
 */
export const SCOPED_TABLES = new Set(['settings', 'team', 'clients', 'posts', 'comments', 'activity',
  'invoices', 'tags', 'board_columns', 'projects', 'tasks', 'time_entries']);
const scope = new AsyncLocalStorage();

export function withScope(fn) {
  return scope.run({ ws: null }, fn);
}

// For scripts: the rest of this process runs in one workspace.
export function useWorkspace(ws) {
  scope.enterWith({ ws });
}

// Per-request scratch space (current action, loaded workspace row).
export function requestContext() {
  const s = scope.getStore();
  if (!s) throw new Error('requestContext called outside a request scope.');
  return s;
}

export function currentWorkspace() {
  const s = scope.getStore();
  return s ? s.ws : null;
}

export function setWorkspace(ws) {
  const s = scope.getStore();
  if (!s) throw new Error('setWorkspace called outside a request scope.');
  if (!ws) throw new Error('Missing workspace.');
  if (s.ws && s.ws !== ws) throw new Error('Request is already scoped to another workspace.');
  s.ws = ws;
}

function stamp(rows, ws) {
  return Array.isArray(rows) ? rows.map((r) => ({ ...r, workspace_id: ws })) : { ...rows, workspace_id: ws };
}

// Column an upsert matches existing rows on. Settings rows are keyed by
// (workspace_id, key), so they can't collide across workspaces.
const CONFLICT_KEYS = { team: 'email' };

function scopedFrom(real, table, ws) {
  const t = () => real.from(table);
  return {
    select: (...a) => t().select(...a).eq('workspace_id', ws),
    update: (...a) => t().update(...a).eq('workspace_id', ws),
    delete: (...a) => t().delete(...a).eq('workspace_id', ws),
    insert: (rows, o) => t().insert(stamp(rows, ws), o),
    // An upsert could otherwise take over a row (e.g. a team email) that belongs to
    // another workspace, so check first.
    upsert: async (rows, o) => {
      const key = CONFLICT_KEYS[table] || 'id';
      const keys = table === 'settings' ? [] : [].concat(rows).map((r) => r[key]).filter((v) => v !== undefined && v !== null);
      if (keys.length) {
        const res = await real.from(table).select(key + ',workspace_id').in(key, keys);
        if (res.error) return res;
        if ((res.data || []).some((r) => r.workspace_id !== ws)) {
          return { data: null, error: Object.assign(new Error('Row belongs to another workspace'), { code: 'WORKSPACE_CONFLICT', key }) };
        }
      }
      const opts = { ...(o || {}) };
      if (table === 'settings') opts.onConflict = 'workspace_id,key';
      return t().upsert(stamp(rows, ws), opts);
    }
  };
}

// Supabase client limited to the current workspace (see above).
export function db() {
  const real = rawDb();
  const ws = currentWorkspace();
  return {
    storage: real.storage,
    from(table) {
      if (!SCOPED_TABLES.has(table)) return real.from(table);
      if (!ws) throw new Error('No workspace selected before reading "' + table + '".');
      return scopedFrom(real, table, ws);
    }
  };
}

// Unscoped client: only for sign-in lookups and tables shared by every workspace.
export function rawDb() {
  if (!client) {
    // Accept a pasted "API URL" too: keep only https://<project>.supabase.co
    const url = String(process.env.SUPABASE_URL || '').trim()
      .replace(/\/(rest|storage|auth)\/v1.*$/, '')
      .replace(/\/+$/, '');
    const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return client;
}

// Unwrap a supabase-js response, throwing on error.
export function q(res) {
  if (res.error) throw res.error;
  return res.data;
}

// Read every row of a table (PostgREST caps a single response at 1000 rows).
export async function all(table, filter, order) {
  const cols = order || ['created_at', 'id'];
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let b = db().from(table).select('*');
    if (filter) b = filter(b);
    for (const c of cols) b = b.order(c, { ascending: true });
    const rows = q(await b.range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export function publicUrl(path) {
  return db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
