// Live updates: after a change, open browsers get a tiny "changed" signal and refetch.
// No data travels over these channels, only the signal, and channel names are secret.
//
// Two ways the signal is delivered:
//  1. Server-Sent Events from this Node process (GET /api/events?topic=...).
//  2. Supabase Realtime "broadcast", used when SUPABASE_ANON_KEY is set, which keeps
//     working even if the host buffers long-lived connections.
// The browser falls back to checking every few seconds if neither gets through.

const TOPIC_RE = /^cf-(team|portal)-[0-9a-f]{32}$/;
const listeners = new Map(); // topic -> Set of http.ServerResponse

export function isValidTopic(topic) {
  return TOPIC_RE.test(String(topic || ''));
}

export function subscribe(topic, res) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  const set = listeners.get(topic);
  set.add(res);
  return () => {
    set.delete(res);
    if (set.size === 0) listeners.delete(topic);
  };
}

export function liveConfig(topic) {
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const url = String(process.env.SUPABASE_URL || '').replace(/\/(rest|storage|auth)\/v1.*$/, '').replace(/\/+$/, '');
  return {
    topic,
    sse: '/api/events?topic=' + encodeURIComponent(topic),
    supabaseUrl: anonKey && /^https:\/\//.test(url) ? url : '',
    anonKey: anonKey && /^https:\/\//.test(url) ? anonKey : ''
  };
}

export function publish(topics) {
  const unique = [...new Set(topics.filter(isValidTopic))];
  if (!unique.length) return;
  const msg = 'event: changed\ndata: {"at":' + Date.now() + '}\n\n';
  for (const t of unique) {
    const set = listeners.get(t);
    if (!set) continue;
    for (const res of set) {
      try { res.write(msg); } catch (e) { /* connection already gone */ }
    }
  }
  broadcastViaSupabase(unique);
}

function broadcastViaSupabase(topics) {
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const url = String(process.env.SUPABASE_URL || '').replace(/\/(rest|storage|auth)\/v1.*$/, '').replace(/\/+$/, '');
  if (!anonKey || !key || !/^https:\/\//.test(url)) return;
  fetch(url + '/realtime/v1/api/broadcast', {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: topics.map((topic) => ({ topic, event: 'changed', payload: { at: Date.now() } })) }),
    signal: AbortSignal.timeout(5000)
  }).catch((e) => console.error('Realtime broadcast failed:', e.message));
}
