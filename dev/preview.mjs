// Local preview with no real services: an in-memory database, file storage and mail
// server, plus the real app server. Sample data is added on first start.
// Usage: node dev/preview.mjs   → http://localhost:4321
import http from 'node:http';
import net from 'node:net';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MOCK_DB = pathToFileURL(fileURLToPath(new URL('./mock-supabase.mjs', import.meta.url))).href;
const PORT = Number(process.env.PORT || 4321);
const STORAGE_PORT = PORT + 1;
const SMTP_PORT = 2525;

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@supabase/supabase-js') return { url: MOCK_DB, shortCircuit: true };
    return next(spec, ctx);
  }
});

Object.assign(process.env, {
  PORT: String(PORT),
  SUPABASE_URL: 'http://mock',
  SUPABASE_SERVICE_ROLE_KEY: 'mock',
  APP_URL: 'http://localhost:' + PORT,
  MOCK_STORAGE_URL: 'http://localhost:' + STORAGE_PORT,
  SETUP_CODE: 'preview-setup-code',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: String(SMTP_PORT),
  SMTP_USER: 'noreply@preview.test',
  SMTP_PASS: 'preview',
  MAIL_FROM: 'Clientflow <noreply@preview.test>',
  PREVIEW_MODE: 'true'
});

const { FILES } = await import(MOCK_DB);
export const OUTBOX = [];

// ---- mock file storage (cross-origin, like Supabase Storage) ----
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'x-upsert,content-type' };
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const url = new URL(req.url, 'http://x');
  if (req.method === 'PUT' && url.pathname.startsWith('/__upload/')) {
    const fd = await new Request('http://x', { method: 'PUT', headers: { 'content-type': req.headers['content-type'] }, body: Buffer.concat(chunks) }).formData();
    const f = fd.get('');
    FILES[decodeURIComponent(url.pathname.slice(10))] = { bytes: Buffer.from(await f.arrayBuffer()), type: f.type };
    res.writeHead(200, CORS);
    return res.end('{}');
  }
  const f = FILES[decodeURIComponent(url.pathname.replace('/__storage/', ''))];
  if (!f) { res.writeHead(404, CORS); return res.end(); }
  res.writeHead(200, { ...CORS, 'Content-Type': f.type, 'Cache-Control': 'max-age=3600' });
  res.end(f.bytes);
}).listen(STORAGE_PORT);

// ---- mock mail server: accepts everything, keeps messages in OUTBOX ----
net.createServer((s) => {
  let data = false;
  let buf = '';
  s.write('220 preview ESMTP\r\n');
  s.on('data', (d) => {
    const t = d.toString();
    if (data) {
      buf += t;
      if (buf.endsWith('\r\n.\r\n')) {
        data = false;
        const subject = (/^Subject: (.*)$/m.exec(buf) || [])[1] || '';
        const to = (/^To: (.*)$/m.exec(buf) || [])[1] || '';
        OUTBOX.push({ to, subject, at: new Date().toISOString() });
        console.log('[mail] to ' + to + ': ' + subject);
        s.write('250 OK\r\n');
      }
      return;
    }
    for (const line of t.split('\r\n').filter(Boolean)) {
      if (/^EHLO/i.test(line)) s.write('250-preview\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (/^AUTH/i.test(line)) s.write('235 ok\r\n');
      else if (/^DATA/i.test(line)) { data = true; buf = ''; s.write('354 go\r\n'); }
      else if (/^QUIT/i.test(line)) { s.write('221 bye\r\n'); s.end(); }
      else s.write('250 ok\r\n');
    }
  });
}).listen(SMTP_PORT);

// ---- the real app ----
process.chdir(ROOT);
await import(pathToFileURL(ROOT + 'server.js').href);
console.log('Preview ready: http://localhost:' + PORT + '  (setup code: preview-setup-code)');
