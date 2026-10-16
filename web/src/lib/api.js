// Talking to the server (POST /api/rpc), plus session/device storage and uploads.

const SESSION_KEY = 'cocs_session_token';
const DEVICES_KEY = 'cocs_devices';
const memory = {};

function store(key, value) {
  memory[key] = value;
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (e) { /* private mode: memory only */ }
}
function load(key) {
  try { return localStorage.getItem(key) || memory[key] || ''; } catch (e) { return memory[key] || ''; }
}

export const session = {
  get: () => load(SESSION_KEY),
  set: (t) => store(SESSION_KEY, t || '')
};

export function portalToken() {
  try { return (new URLSearchParams(window.location.search).get('t') || '').trim(); } catch (e) { return ''; }
}

export const devices = {
  get(email) {
    try { return (JSON.parse(load(DEVICES_KEY) || '{}') || {})[String(email || '').trim().toLowerCase()] || ''; } catch (e) { return ''; }
  },
  save(email, token) {
    if (!email || !token) return;
    let map = {};
    try { map = JSON.parse(load(DEVICES_KEY) || '{}') || {}; } catch (e) {}
    map[String(email).trim().toLowerCase()] = token;
    store(DEVICES_KEY, JSON.stringify(map));
  }
};

export function deviceLabel() {
  const ua = navigator.userAgent || '';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'device';
  return b + ' on ' + os;
}

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code || 'ERROR'; }
}

let onAuthExpired = null;
export function setAuthExpiredHandler(fn) { onAuthExpired = fn; }

export async function rpc(action, payload, opts) {
  const timeoutMs = opts && opts.long ? 180000 : 45000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    const r = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, auth: { sessionToken: session.get(), clientToken: portalToken() }, payload: payload || {} }),
      signal: ctrl.signal
    });
    res = await r.json().catch(() => { throw new ApiError('The server returned an invalid response (HTTP ' + r.status + ').'); });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === 'AbortError') throw new ApiError('The request took too long. Please try again.', 'TIMEOUT');
    throw new ApiError('Could not reach the server. Check your connection and try again.', 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  if (!res || !res.ok) {
    const err = new ApiError((res && res.error) || 'Server error', res && res.code);
    if (err.code === 'AUTH' && onAuthExpired && !portalToken()) onAuthExpired(err.message);
    throw err;
  }
  return res.data;
}

/* ---------- Uploads (browser → storage via one-time signed URL) ---------- */

const COMPRESS_MAX_DIM = 2048;
const COMPRESS_QUALITY = 0.85;
const COMPRESS_MIN_BYTES = 300 * 1024;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function hasTransparency(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 64) if (data[i] < 250) return true;
  return false;
}

// Resizes large photos to 2048px and re-encodes them (JPEG, or PNG if transparent).
// Keeps the original if it's small, unreadable (e.g. HEIC on Chrome) or wouldn't shrink.
export async function compressImage(file) {
  if (!/^image\/(jpeg|png|webp|bmp)$/i.test(file.type) || file.size < COMPRESS_MIN_BYTES || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, COMPRESS_MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const type = file.type === 'image/png' && hasTransparency(ctx, w, h) ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((r) => cv.toBlob(r, type, COMPRESS_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg'), { type, lastModified: Date.now() });
  } catch (e) {
    return file;
  }
}

export async function putToSignedUrl(url, file) {
  const fd = new FormData();
  fd.append('cacheControl', '3600');
  fd.append('', file);
  let r;
  try {
    r = await fetch(url, { method: 'PUT', body: fd, headers: { 'x-upsert': 'false' } });
  } catch (e) {
    throw new ApiError('Upload of "' + file.name + '" failed. Check your connection and try again.');
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new ApiError('Upload of "' + file.name + '" failed (HTTP ' + r.status + ')' + (t ? ': ' + t.slice(0, 160) : '.'));
  }
}

// Compress (images), then upload. Returns { asset, before, after }.
export async function uploadFile(file, { clientId, purpose } = {}) {
  if (file.type.indexOf('image/') !== 0 && (purpose === 'comment' || file.type.indexOf('video/') !== 0)) {
    throw new ApiError('"' + file.name + '": only ' + (purpose === 'comment' ? 'images' : 'images and videos') + ' are allowed.');
  }
  const ready = await compressImage(file);
  if (ready.size > MAX_UPLOAD_BYTES) throw new ApiError('"' + file.name + '" is larger than 20 MB.');
  const res = await rpc('createUpload', { clientId, purpose, name: ready.name, mimeType: ready.type, size: ready.size });
  await putToSignedUrl(res.uploadUrl, ready);
  return { asset: res.asset, before: file.size, after: ready.size };
}
