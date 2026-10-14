import { createClient } from '@supabase/supabase-js';

export const BUCKET = 'assets';

let client = null;

// Server-side Supabase client using the service-role key (bypasses RLS).
export function db() {
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
