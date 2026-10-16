// "Sign in with Google". The browser gets a signed ID token from Google; this file
// asks Google to confirm it and checks it was issued for this app.
// Turn it on by setting GOOGLE_CLIENT_ID (see README → Google sign-in).
import { AppError, fail } from './util.js';

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || '').trim();
}

export async function verifyGoogleCredential(credential) {
  const clientId = googleClientId();
  if (!clientId) fail('Google sign-in is not set up on this server.', 'GOOGLE_OFF');
  const token = String(credential || '');
  if (!token || token.length > 4096) fail('Google sign-in failed. Please try again.', 'GOOGLE_FAILED');

  let info;
  try {
    const res = await fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: token }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) fail('Google sign-in failed or expired. Please try again.', 'GOOGLE_FAILED');
    info = await res.json();
  } catch (e) {
    if (e instanceof AppError) throw e;
    fail('Could not reach Google to confirm your sign-in. Please try again.', 'GOOGLE_FAILED');
  }

  if (info.aud !== clientId || !ISSUERS.includes(info.iss)) fail('Google sign-in failed. Please try again.', 'GOOGLE_FAILED');
  if (!(Number(info.exp) * 1000 > Date.now())) fail('Google sign-in expired. Please try again.', 'GOOGLE_FAILED');
  if (String(info.email_verified) !== 'true' || !info.email) {
    fail('Your Google account email is not verified.', 'GOOGLE_FAILED');
  }
  const email = String(info.email).toLowerCase();
  return {
    email,
    name: String(info.name || email.split('@')[0]).slice(0, 80),
    picture: /^https:\/\//.test(String(info.picture || '')) ? String(info.picture) : ''
  };
}
