import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CircleAlert, Mail } from 'lucide-react';
import { deviceLabel, devices, rpc } from '../lib/api.js';
import { Field, PasswordInput, ThemeButton, useUi } from '../components/ui.jsx';
import { cx } from '../lib/util.js';

export function Logo() {
  return <span className="logo" aria-hidden="true"><span /><span /><span /><span /><span /></span>;
}

function AuthCard({ agencyName, shake, children }) {
  return (
    <div className="auth">
      <div className={cx('card auth-card', shake && 'shake')} key={shake || 'card'}>
        <div className="row-between">
          <span className="brand"><Logo />{agencyName || 'Clientflow'}</span>
          <ThemeButton />
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorNote({ text }) {
  if (!text) return null;
  return <div className="notice warn" role="alert" style={{ marginBottom: 16 }}><CircleAlert /><span>{text}</span></div>;
}

export function SetupScreen({ agencyName, onDone }) {
  const { toast } = useUi();
  const [f, setF] = useState({ code: '', name: '', email: '', pass: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.pass !== f.confirm) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    setErr('');
    try {
      const d = await rpc('setupAdmin', { setupCode: f.code, name: f.name, email: f.email, password: f.pass, deviceLabel: deviceLabel() });
      devices.save(f.email, d.deviceToken);
      toast('Workspace ready. Welcome!', 'success');
      onDone(d);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };
  return (
    <AuthCard agencyName={agencyName}>
      <h1>Set up your workspace</h1>
      <p className="sub">Enter the setup code saved as <code>SETUP_CODE</code> on the server to create the first Admin account.</p>
      <ErrorNote text={err} />
      <form className="stack" onSubmit={submit}>
        <Field label="Setup code" htmlFor="s-code"><input id="s-code" className="input" value={f.code} onChange={set('code')} required autoComplete="off" /></Field>
        <Field label="Your name" htmlFor="s-name"><input id="s-name" className="input" value={f.name} onChange={set('name')} required autoComplete="name" /></Field>
        <Field label="Email" htmlFor="s-email"><input id="s-email" className="input" type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></Field>
        <Field label="Password" hint="At least 8 characters" htmlFor="s-pass"><PasswordInput id="s-pass" value={f.pass} onChange={set('pass')} required minLength={8} autoComplete="new-password" /></Field>
        <Field label="Confirm password" htmlFor="s-confirm"><PasswordInput id="s-confirm" value={f.confirm} onChange={set('confirm')} required minLength={8} autoComplete="new-password" /></Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Setting up…' : 'Create workspace'}</button>
      </form>
    </AuthCard>
  );
}

export function LoginScreen({ agencyName, authError, onDone, onNeedsCode }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(authError || '');
  const [shake, setShake] = useState(0);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const d = await rpc('login', { email, password: pass, deviceToken: devices.get(email), deviceLabel: deviceLabel() });
      if (d.needsCode) onNeedsCode({ ...d, email });
      else onDone(d);
    } catch (e2) {
      setErr(e2.message);
      setShake(shake + 1);
      setBusy(false);
    }
  };
  return (
    <AuthCard agencyName={agencyName} shake={shake}>
      <h1>Sign in</h1>
      <p className="sub">Welcome back. Enter your team email and password.</p>
      <ErrorNote text={err} />
      <form className="stack" onSubmit={submit}>
        <Field label="Email" htmlFor="l-email"><input id="l-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" autoFocus /></Field>
        <Field label="Password" htmlFor="l-pass"><PasswordInput id="l-pass" value={pass} onChange={(e) => setPass(e.target.value)} required autoComplete="current-password" /></Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <div style={{ textAlign: 'center', marginTop: 18 }}><a href="/" className="muted" style={{ fontSize: 13 }}>Back to home</a></div>
    </AuthCard>
  );
}

export function CodeScreen({ agencyName, challenge, onDone, onBack }) {
  const { toast } = useUi();
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(0);
  const [cooldown, setCooldown] = useState(30);
  const inputRef = useRef(null);
  useEffect(() => {
    const t = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const verify = async (value) => {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setErr('');
    try {
      const d = await rpc('verifyLoginCode', { challengeId: challenge.challengeId, code: value, rememberDevice: remember, deviceLabel: deviceLabel() });
      devices.save(challenge.email, d.deviceToken);
      toast('Signed in. Welcome back!', 'success');
      onDone(d);
    } catch (e) {
      if (e.code === 'CODE_EXPIRED') { onBack(e.message); return; }
      setErr(e.message);
      setCode('');
      setShake(shake + 1);
      setBusy(false);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    }
  };
  const resend = async () => {
    try {
      const r = await rpc('resendLoginCode', { challengeId: challenge.challengeId });
      toast('New code sent to ' + r.emailHint, 'success');
      setCooldown(30);
    } catch (e) {
      if (e.code === 'CODE_EXPIRED') onBack(e.message);
      else toast(e.message, 'error');
    }
  };
  return (
    <AuthCard agencyName={agencyName} shake={shake}>
      <div className="row" style={{ marginTop: 20, gap: 10 }}>
        <span className="avatar" style={{ width: 40, height: 40 }}><Mail size={18} /></span>
      </div>
      <h1 style={{ marginTop: 14 }}>Check your email</h1>
      <p className="sub">This is a new device, so we sent a 6-digit code to <b>{challenge.emailHint}</b>. It expires in 10 minutes.</p>
      <ErrorNote text={err} />
      <form className="stack" onSubmit={(e) => { e.preventDefault(); verify(code); }}>
        <input ref={inputRef} className="input otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
          aria-label="6-digit code" placeholder="000000" value={code}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) verify(v); }} />
        <label className="checkbox"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Trust this device for 30 days</label>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and sign in'}</button>
      </form>
      <div className="row-between" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onBack('')}><ArrowLeft />Use another account</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={resend} disabled={cooldown > 0}>{cooldown > 0 ? 'Resend in ' + cooldown + 's' : 'Resend code'}</button>
      </div>
    </AuthCard>
  );
}
