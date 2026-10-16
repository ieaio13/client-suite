// Web server: serves the landing page (/), the React app (/app), the API (POST /api/rpc)
// and live-update events (GET /api/events).
// On cPanel it is started through app.cjs; locally run `npm start`.
import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Optional .env file next to this script (cPanel can also set variables in its UI).
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)));
  } catch (e) {}
}

// Imported after .env is loaded so APP_TIMEZONE etc. are picked up.
const { dispatch } = await import('./lib/handlers.js');
const { checkEmail } = await import('./lib/email.js');
const { isValidTopic, subscribe } = await import('./lib/realtime.js');

// The built React app (web/ → public/app). Falls back to the older single-file app.
const APP_DIR = fileURLToPath(new URL('./public/app/', import.meta.url));
const APP_PATH = new URL('./public/app/index.html', import.meta.url);
const LEGACY_APP_PATH = new URL('./public/index.html', import.meta.url);
const MIME = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon'
};
const LANDING_PATH = new URL('./public/landing.html', import.meta.url);
const MAX_BODY_BYTES = 1024 * 1024;
const BASE_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

function send(res, status, contentType, body) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));
}

async function handleRpc(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed', code: 'BAD_METHOD' });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      return sendJson(res, 413, { ok: false, error: 'Request too large.', code: 'TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  let body = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') || {};
  } catch (e) {}
  const out = await dispatch(body.action, body.auth || {}, body.payload || {});
  sendJson(res, 200, out);
}

function describeError(e) {
  if (!e) return 'unknown error';
  let msg = e.message || String(e);
  if (e.code) msg += ' (' + e.code + ')';
  const cause = e.cause || (e.originalError && e.originalError.cause);
  if (cause && (cause.code || cause.message)) msg += ' — ' + (cause.code || cause.message);
  const caused = /Caused by: ([^\n]+)/.exec(String(e.details || ''));
  if (caused) msg += ' — ' + caused[1];
  if (e.hint) msg += ' — ' + e.hint;
  return msg;
}

// Real round-trips to Supabase, so /api/health shows the actual problem (never secrets).
async function checkSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { databaseCheck: 'not configured', storageCheck: 'not configured' };
  }
  const { db, BUCKET } = await import('./lib/db.js');
  let databaseCheck = 'ok';
  let storageCheck = 'ok';
  try {
    const res = await db().from('settings').select('key').limit(1);
    if (res.error) databaseCheck = 'error: ' + describeError(res.error);
  } catch (e) {
    databaseCheck = 'error: ' + describeError(e);
  }
  try {
    const res = await db().storage.getBucket(BUCKET);
    if (res.error) storageCheck = 'error: ' + describeError(res.error);
  } catch (e) {
    storageCheck = 'error: ' + describeError(e);
  }
  return { databaseCheck, storageCheck };
}

// Live updates over Server-Sent Events. The topic name is the secret.
function handleEvents(req, res) {
  const topic = new URL(req.url, 'http://x').searchParams.get('topic') || '';
  if (!isValidTopic(topic)) return send(res, 404, 'text/plain', 'Not found');
  res.writeHead(200, {
    ...BASE_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 5000\nevent: hello\ndata: {}\n\n');
  const unsubscribe = subscribe(topic, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(ping); unsubscribe(); });
}

async function sendAppFile(res, path) {
  const rel = decodeURIComponent(path.replace(/^\/app\//, ''));
  if (!/^assets\/[\w.-]+$/.test(rel)) return send(res, 404, 'text/plain', 'Not found');
  const ext = rel.slice(rel.lastIndexOf('.'));
  try {
    const body = await fs.readFile(APP_DIR + rel);
    // Built files have a content hash in their name, so they can be cached for a year.
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(body);
  } catch (e) {
    send(res, 404, 'text/plain', 'Not found');
  }
}

async function readAppHtml() {
  try {
    return await fs.readFile(APP_PATH);
  } catch (e) {
    return fs.readFile(LEGACY_APP_PATH);
  }
}

http.createServer(async (req, res) => {
  try {
    const path = (req.url || '/').split('?')[0];
    if (path === '/api/rpc') return await handleRpc(req, res);
    if (path === '/api/events') return handleEvents(req, res);
    if (path === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        node: process.version,
        database: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        ...(await checkSupabase()),
        email: process.env.SMTP_HOST ? 'smtp' : (process.env.RESEND_API_KEY ? 'resend' : 'off'),
        emailCheck: await checkEmail(),
        loginCodes: String(process.env.DISABLE_LOGIN_CODES || '').toLowerCase() === 'true' ? 'off (DISABLE_LOGIN_CODES)' : 'on',
        appUrl: process.env.APP_URL || ''
      });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'Method not allowed');

    const query = (req.url || '').indexOf('?') === -1 ? '' : req.url.slice(req.url.indexOf('?'));
    // Portal links from before the landing page existed (/?t=...) now live at /app?t=...
    if (path === '/' && /[?&]t=/.test(query)) {
      res.writeHead(302, { ...BASE_HEADERS, Location: '/app' + query });
      return res.end();
    }
    if (path === '/' || path === '/index.html') {
      return send(res, 200, 'text/html; charset=utf-8', await fs.readFile(LANDING_PATH));
    }
    if (path === '/app' || path === '/app/') {
      return send(res, 200, 'text/html; charset=utf-8', await readAppHtml());
    }
    if (path.startsWith('/app/assets/')) return await sendAppFile(res, path);
    // Local preview only (dev/preview.mjs sets PREVIEW_MODE): sample-data script.
    if (process.env.PREVIEW_MODE === 'true' && path === '/__dev/seed.js') {
      return send(res, 200, 'text/javascript; charset=utf-8', await fs.readFile(new URL('./dev/seed-browser.js', import.meta.url)));
    }
    if (path === '/favicon.ico') {
      res.writeHead(204, BASE_HEADERS);
      return res.end();
    }
    res.writeHead(302, { ...BASE_HEADERS, Location: '/' });
    res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'text/plain', 'Server error');
  }
}).listen(Number(process.env.PORT || 3000), () => {
  console.log('Clientflow running on port ' + (process.env.PORT || 3000));
});
