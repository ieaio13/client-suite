import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CircleAlert, Mail } from 'lucide-react';
import { deviceLabel, devices, rpc } from '../lib/api.js';
import { Field, PasswordInput, ThemeButton, useUi } from '../components/ui.jsx';
import { cx } from '../lib/util.js';

// Flokey wordmark (rounded geometric type, Quicksand Bold).
export function Logo({ small }) {
  return <span className={small ? 'wordmark sm' : 'wordmark'}>Flokey</span>;
}

function AuthCard({ agencyName, shake, children }) {
  return (
    <div className="auth">
      <div className={cx('card auth-card', shake && 'shake')} key={shake || 'card'}>
        <div className="row-between">
          <span className="brand"><Logo />{agencyName && agencyName !== 'Flokey' && <><span className="brand-sep" aria-hidden="true" /><span className="ellipsis">{agencyName}</span></>}</span>
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

/* ---------- Google sign-in ---------- */

let gisPromise = null;
function loadGoogle() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve(window.google);
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve(window.google);
      s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in.')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

function GoogleButton({ clientId, text, onCredential }) {
  const ref = useRef(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadGoogle().then((g) => {
      if (!alive || !ref.current) return;
      g.accounts.id.initialize({ client_id: clientId, callback: (r) => cb.current(r.credential), ux_mode: 'popup' });
      const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      ref.current.innerHTML = '';
      g.accounts.id.renderButton(ref.current, {
        type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', shape: 'rectangular',
        text, logo_alignment: 'center', width: Math.min(336, ref.current.offsetWidth || 336)
      });
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [clientId, text]);
  if (failed) return <p className="muted" style={{ fontSize: 13, textAlign: 'center', margin: 0 }}>Google sign-in could not load. Use your email instead.</p>;
  return <div ref={ref} className="google-btn" />;
}

function OrDivider() {
  return <div className="or-divider"><span>or</span></div>;
}

/* ---------- Sign in / create account ---------- */

export function LoginScreen({ boot, authError, onDone, onNeedsCode }) {
  const signupsOn = boot.signupsEnabled !== false;
  const [mode, setMode] = useState(() => (signupsOn && /signup/.test(window.location.hash) ? 'signup' : 'signin'));
  const [f, setF] = useState({ agency: '', name: '', email: '', pass: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(authError || '');
  const [shake, setShake] = useState(0);
  const [google, setGoogle] = useState(null); // { credential, email, name } while asking a new Google user for their agency name
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const switchTo = (m) => {
    setMode(m);
    setErr('');
    try { window.history.replaceState(null, '', m === 'signup' ? '#/signup' : '#/'); } catch (e) {}
  };
  const failed = (e2) => { setErr(e2.message); setShake((n) => n + 1); setBusy(false); };
  const finish = (d, email) => {
    if (d.needsCode) onNeedsCode({ ...d, email, purpose: mode === 'signup' ? 'signup' : 'signin' });
    else {
      if (d.deviceToken) devices.save(email, d.deviceToken);
      onDone(d);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (mode === 'signup') {
        const d = await rpc('signup', { agencyName: f.agency, name: f.name, email: f.email, password: f.pass, deviceLabel: deviceLabel() });
        finish(d, f.email.trim().toLowerCase());
      } else {
        const d = await rpc('login', { email: f.email, password: f.pass, deviceToken: devices.get(f.email), deviceLabel: deviceLabel() });
        finish(d, f.email);
      }
    } catch (e2) { failed(e2); }
  };

  const withGoogle = async (credential, agencyName) => {
    setBusy(true);
    setErr('');
    try {
      const d = await rpc('googleAuth', { credential, agencyName: agencyName || '', deviceLabel: deviceLabel() });
      if (d.needsAgency) { setGoogle({ credential, email: d.email, name: d.name }); setBusy(false); return; }
      finish(d, d.user ? d.user.email : '');
    } catch (e2) {
      if (google) setGoogle(null);
      failed(e2);
    }
  };

  if (google) {
    return (
      <AuthCard shake={shake}>
        <h1>Name your workspace</h1>
        <p className="sub">Signed in with Google as <b>{google.email}</b>. One last step: what is your agency or business called?</p>
        <ErrorNote text={err} />
        <form className="stack" onSubmit={(e) => { e.preventDefault(); withGoogle(google.credential, f.agency); }}>
          <Field label="Agency or business name" htmlFor="g-agency"><input id="g-agency" className="input" value={f.agency} onChange={set('agency')} required autoFocus autoComplete="organization" placeholder="e.g. Bright Social" /></Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating workspace…' : 'Start ' + (boot.trialDays || 14) + '-day free trial'}</button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 16 }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => setGoogle(null)}><ArrowLeft />Back</button></div>
      </AuthCard>
    );
  }

  const isSignup = mode === 'signup';
  return (
    <AuthCard shake={shake}>
      {signupsOn && (
        <div className="seg auth-tabs" role="tablist" aria-label="Sign in or create an account">
          <button type="button" role="tab" aria-selected={!isSignup} className={!isSignup ? 'on' : ''} onClick={() => switchTo('signin')}>Sign in</button>
          <button type="button" role="tab" aria-selected={isSignup} className={isSignup ? 'on' : ''} onClick={() => switchTo('signup')}>Create account</button>
        </div>
      )}
      <h1>{isSignup ? 'Start your free trial' : 'Welcome back'}</h1>
      <p className="sub">{isSignup
        ? (boot.trialDays || 14) + ' days free, no card needed. You get your own private workspace.'
        : 'Sign in with your team email and password.'}</p>
      <ErrorNote text={err} />
      {boot.googleClientId && (<>
        <GoogleButton clientId={boot.googleClientId} text={isSignup ? 'signup_with' : 'signin_with'} onCredential={(c) => withGoogle(c, '')} />
        <OrDivider />
      </>)}
      <form className="stack" onSubmit={submit}>
        {isSignup && <Field label="Agency or business name" htmlFor="l-agency"><input id="l-agency" className="input" value={f.agency} onChange={set('agency')} required autoComplete="organization" placeholder="e.g. Bright Social" /></Field>}
        {isSignup && <Field label="Your name" htmlFor="l-name"><input id="l-name" className="input" value={f.name} onChange={set('name')} required autoComplete="name" /></Field>}
        <Field label={isSignup ? 'Work email' : 'Email'} htmlFor="l-email"><input id="l-email" className="input" type="email" value={f.email} onChange={set('email')} required autoComplete={isSignup ? 'email' : 'username'} autoFocus={!isSignup} /></Field>
        <Field label="Password" hint={isSignup ? 'At least 8 characters' : undefined} htmlFor="l-pass"><PasswordInput id="l-pass" value={f.pass} onChange={set('pass')} required minLength={isSignup ? 8 : undefined} autoComplete={isSignup ? 'new-password' : 'current-password'} /></Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? (isSignup ? 'Creating workspace…' : 'Signing in…') : (isSignup ? 'Create account' : 'Sign in')}</button>
      </form>
      {isSignup && <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', margin: '14px 0 0' }}>Joining an existing agency? Ask its admin to add you instead.</p>}
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
      toast(challenge.purpose === 'signup' ? 'Your workspace is ready. Welcome!' : 'Signed in. Welcome back!', 'success');
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
      <h1 style={{ marginTop: 14 }}>{challenge.purpose === 'signup' ? 'Confirm your email' : 'Check your email'}</h1>
      <p className="sub">{challenge.purpose === 'signup' ? 'To finish creating your account, enter' : 'This is a new device, so we sent'} the 6-digit code {challenge.purpose === 'signup' ? 'we sent to' : 'to'} <b>{challenge.emailHint}</b>. It expires in 10 minutes.</p>
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

/* ---------- Accepting a project invite ---------- */

export function InviteScreen({ token, onDone }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ name: '', pass: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    rpc('checkInvite', { token })
      .then((r) => { setInfo(r); setF((x) => ({ ...x, name: r.name || '' })); })
      .catch((e) => setErr(e.message));
  }, [token]);
  const submit = async (e) => {
    e.preventDefault();
    if (f.pass !== f.confirm) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    setErr('');
    try {
      const d = await rpc('acceptInvite', { token, name: f.name, password: f.pass, deviceLabel: deviceLabel() });
      if (d.deviceToken && info) devices.save(info.email, d.deviceToken);
      onDone(d);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  if (!info) {
    return (
      <AuthCard>
        <h1>{err ? 'Invite not valid' : 'Opening your invite…'}</h1>
        <ErrorNote text={err} />
        {err && <a href="/app" className="btn btn-block">Go to sign in</a>}
      </AuthCard>
    );
  }
  return (
    <AuthCard>
      <h1>Join {info.projectName ? '“' + info.projectName + '”' : 'the project'}</h1>
      <p className="sub"><b>{info.agencyName}</b> invited you to work on this project in Flokey. Choose a password for <b>{info.email}</b>.</p>
      <ErrorNote text={err} />
      <form className="stack" onSubmit={submit}>
        <Field label="Your name" htmlFor="iv-name"><input id="iv-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoComplete="name" /></Field>
        <Field label="Password" hint="At least 8 characters" htmlFor="iv-pass"><PasswordInput id="iv-pass" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
        <Field label="Confirm password" htmlFor="iv-confirm"><PasswordInput id="iv-confirm" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Joining…' : 'Join project'}</button>
      </form>
      <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', margin: '14px 0 0' }}>You'll only see the projects you're invited to.</p>
    </AuthCard>
  );
}
