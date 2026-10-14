import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'ERROR';
  }
}

export function fail(message, code) {
  throw new AppError(message, code);
}

/* ---------- Dates (all user-visible stamps are 'yyyy-MM-ddTHH:mm:ss' in APP_TIMEZONE) ---------- */

export const TZ = process.env.APP_TIMEZONE || 'Asia/Kathmandu';

const STAMP_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23'
});

export function nowIso() {
  const p = {};
  for (const part of STAMP_FORMAT.formatToParts(new Date())) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export function todayStr() {
  return nowIso().slice(0, 10);
}

export function addDaysStr(dateStr, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(todayStr() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/* ---------- IDs, tokens, hashing ---------- */

export function newId(prefix) {
  const raw = crypto.randomUUID().replace(/-/g, '').substring(0, 12);
  return (prefix ? prefix + '_' : '') + raw;
}

const TOKEN_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Cryptographically random, unbiased (rejection sampling: 248 = 62 * 4).
export function randomToken(len) {
  let out = '';
  while (out.length < len) {
    for (const b of crypto.randomBytes(len * 2)) {
      if (b < 248) {
        out += TOKEN_CHARS[b % 62];
        if (out.length === len) break;
      }
    }
  }
  return out;
}

export function sha256Hex(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Hash format used by the old Apps Script version (400 rounds of SHA-256).
// Kept only so imported accounts can still sign in; upgraded to scrypt on first login.
function legacyHash(password, salt) {
  let digest = crypto.createHash('sha256').update(salt + ':' + password, 'utf8').digest();
  for (let i = 1; i < 400; i++) {
    digest = crypto.createHash('sha256').update(digest.toString('hex') + ':' + salt, 'utf8').digest();
  }
  return digest.toString('hex');
}

export async function hashPassword(password) {
  const salt = randomToken(24);
  const key = await scrypt(String(password), salt, 64);
  return { salt, passHash: 'scrypt$' + key.toString('hex') };
}

export async function verifyPassword(password, salt, passHash) {
  const stored = String(passHash || '');
  if (stored.startsWith('scrypt$')) {
    const key = await scrypt(String(password), String(salt), 64);
    return { ok: safeEqual('scrypt$' + key.toString('hex'), stored), legacy: false };
  }
  return { ok: safeEqual(legacyHash(String(password), String(salt)), stored), legacy: true };
}

/* ---------- Formatting ---------- */

export function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMoney(amount, currency) {
  const num = Number(amount || 0);
  return (currency || 'USD') + ' ' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function invoiceTotals(inv) {
  const items = Array.isArray(inv.items) ? inv.items : [];
  let subtotal = 0;
  for (const it of items) subtotal += Number(it.qty || 0) * Number(it.rate || 0);
  const discount = Number(inv.discount || 0);
  const afterDiscount = Math.max(0, subtotal - discount);
  const taxPct = Number(inv.tax_pct || 0);
  const tax = afterDiscount * (taxPct / 100);
  return { items, subtotal, discount, taxPct, tax, total: afterDiscount + tax };
}
