// In-memory stand-in for the parts of @supabase/supabase-js the server uses.
// Development/preview only — never deployed.
export const TABLES = {};
export const FILES = {};
export const BROADCASTS = [];
let SEQ = 0;

const PK = { team: ['email'], settings: ['workspace_id', 'key'], sessions: ['token_hash'], trusted_devices: ['token_hash'], login_attempts: ['key'] };
const pkCols = (t) => PK[t] || ['id'];
const samePk = (t, a, b) => pkCols(t).every((c) => a[c] === b[c]);
const rowsOf = (t) => (TABLES[t] = TABLES[t] || []);
const clone = (x) => JSON.parse(JSON.stringify(x));
const err = (message, code) => ({ message, code });

function uniqueViolation(t, row, ignore) {
  const rows = rowsOf(t).filter((r) => r !== ignore);
  if (rows.some((r) => samePk(t, r, row))) return true;
  if (t === 'clients' && row.token && rows.some((r) => r.token === row.token)) return true;
  if (t === 'invoices' && rows.some((r) => r.client_id === row.client_id && String(r.number).toLowerCase() === String(row.number).toLowerCase())) return true;
  if (t === 'tags' && rows.some((r) => r.workspace_id === row.workspace_id && String(r.name).toLowerCase() === String(row.name).toLowerCase())) return true;
  return false;
}

function cascadeDelete(t, row) {
  const del = (tt, pred) => {
    for (const r of rowsOf(tt).filter(pred)) {
      TABLES[tt].splice(TABLES[tt].indexOf(r), 1);
      cascadeDelete(tt, r);
    }
  };
  if (t === 'clients') {
    del('clients', (r) => r.parent_id === row.id);
    for (const tt of ['posts', 'comments', 'activity', 'invoices', 'board_columns', 'projects']) del(tt, (r) => r.client_id === row.id);
  }
  if (t === 'projects') {
    del('tasks', (r) => r.project_id === row.id);
    del('time_entries', (r) => r.project_id === row.id);
  }
  if (t === 'posts') del('comments', (r) => r.post_id === row.id);
  if (t === 'team') {
    del('sessions', (r) => r.email === row.email);
    del('trusted_devices', (r) => r.email === row.email);
  }
}

class Query {
  constructor(t) { this.t = t; this.op = null; this.filters = []; this.orders = []; this.mode = null; }
  select(cols, opts) { if (!this.op) { this.op = 'select'; this.head = opts && opts.head; } return this; }
  insert(v) { this.op = 'insert'; this.payload = v; return this; }
  update(v) { this.op = 'update'; this.payload = v; return this; }
  upsert(v) { this.op = 'upsert'; this.payload = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
  lt(c, v) { this.filters.push((r) => String(r[c]) < String(v)); return this; }
  gt(c, v) { this.filters.push((r) => String(r[c]) > String(v)); return this; }
  in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
  contains(c, vs) { this.filters.push((r) => vs.every((v) => (r[c] || []).includes(v))); return this; }
  order(c) { this.orders.push(c); return this; }
  limit() { return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  match() { return rowsOf(this.t).filter((r) => this.filters.every((f) => f(r))); }
  run() {
    const t = this.t;
    let out = [];
    if (this.op === 'select') {
      out = this.match();
      if (this.head) return { data: null, count: out.length, error: null };
      for (const c of this.orders.slice().reverse()) {
        out = out.slice().sort((a, b) => (typeof a[c] === 'number' ? a[c] - b[c] : String(a[c] ?? '').localeCompare(String(b[c] ?? ''))));
      }
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
    } else if (this.op === 'insert') {
      for (const row of [].concat(this.payload)) {
        if (uniqueViolation(t, row)) return { data: null, error: err('duplicate key', '23505') };
        const stored = clone(row);
        if (t === 'comments' || t === 'activity') stored.seq = ++SEQ;
        rowsOf(t).push(stored);
        out.push(stored);
      }
    } else if (this.op === 'upsert') {
      for (const row of [].concat(this.payload)) {
        const ex = rowsOf(t).find((r) => samePk(t, r, row));
        if (ex) Object.assign(ex, clone(row)); else rowsOf(t).push(clone(row));
        out.push(row);
      }
    } else if (this.op === 'update') {
      for (const r of this.match()) {
        const next = { ...r, ...clone(this.payload) };
        if (uniqueViolation(t, next, r)) return { data: null, error: err('duplicate key', '23505') };
        Object.assign(r, clone(this.payload));
        out.push(r);
      }
    } else if (this.op === 'delete') {
      for (const r of this.match()) {
        TABLES[t].splice(TABLES[t].indexOf(r), 1);
        cascadeDelete(t, r);
        out.push(r);
      }
    }
    out = clone(out);
    if (this.mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: err('expected 1 row, got ' + out.length, 'PGRST116') };
    if (this.mode === 'maybe') return out.length <= 1 ? { data: out[0] || null, error: null } : { data: null, error: err('multiple rows', 'PGRST116') };
    return { data: out, error: null };
  }
  then(res, rej) {
    try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); }
  }
}

export function createClient() {
  const base = process.env.MOCK_STORAGE_URL;
  return {
    from: (t) => new Query(t),
    storage: {
      getBucket: async () => ({ data: { id: 'assets' }, error: null }),
      from: () => ({
        createSignedUploadUrl: async (path) => ({ data: { signedUrl: base + '/__upload/' + path + '?token=mock', path, token: 'mock' }, error: null }),
        getPublicUrl: (path) => ({ data: { publicUrl: base + '/__storage/' + path } }),
        upload: async (path, bytes, opts) => { FILES[path] = { bytes: Buffer.from(bytes), type: opts.contentType }; return { data: { path }, error: null }; },
        remove: async (paths) => { for (const p of paths) delete FILES[p]; return { data: [], error: null }; }
      })
    }
  };
}
