import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Building2, CreditCard, KeyRound, LoaderCircle, LogOut, Plus, ShieldCheck, Tag, Trash2, Upload, User, Users } from 'lucide-react';
import { compressImage, putToSignedUrl, rpc } from '../lib/api.js';
import { useData } from '../data.jsx';
import { go } from '../lib/route.js';
import { Avatar, Field, PasswordInput, useUi } from '../components/ui.jsx';
import { COLORS, cx } from '../lib/util.js';
import PlanSettings from './Plan.jsx';

export default function Settings({ tab }) {
  const { data } = useData();
  const tabs = [{ id: 'profile', label: 'Profile', icon: User }];
  if (data.isBilling) tabs.push({ id: 'tags', label: 'Tags', icon: Tag });
  if (data.isAdmin) tabs.push({ id: 'team', label: 'Team & workspace', icon: Users });
  if (data.isAdmin) tabs.push({ id: 'plan', label: 'Plan', icon: CreditCard });
  const current = tabs.some((t) => t.id === tab) ? tab : 'profile';
  return (
    <main className="main"><div className="main-inner rise" key={current}>
      <div className="page-head"><div><div className="crumbs">Workspace</div><h1 className="page-title">Settings</h1></div></div>
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {tabs.map((t) => <button key={t.id} type="button" className={cx('navitem', current === t.id && 'on')} onClick={() => go('settings', t.id)}><t.icon /><span className="grow">{t.label}</span></button>)}
        </nav>
        <div className="stack" style={{ gap: 16 }}>
          {current === 'profile' && <Profile />}
          {current === 'tags' && <Tags />}
          {current === 'team' && <Team />}
          {current === 'plan' && <PlanSettings />}
        </div>
      </div>
    </div></main>
  );
}

function Card({ title, icon: Icon, lead, children, action }) {
  return (
    <section className="card">
      <div className="card-head"><h3 className="row">{Icon && <Icon size={16} className="muted" />}{title}</h3>{action}</div>
      <div className="card-pad stack" style={{ gap: 16 }}>{lead && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{lead}</p>}{children}</div>
    </section>
  );
}

function Profile() {
  const { data, patch, signOut } = useData();
  const { toast, confirm } = useUi();
  const u = data.user;
  const [d, setD] = useState({ name: u.name, title: u.title || '', phone: u.phone || '' });
  const [pw, setPw] = useState({ cur: '', next: '' });
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);

  const applyUser = (user) => patch((x) => ({ ...x, user, team: x.team.map((t) => (t.email === user.email ? user : t)) }));
  const save = async (extra) => {
    setBusy('profile');
    try {
      const r = await rpc('saveProfile', { ...d, ...(extra || {}) });
      applyUser(r.user);
      toast(extra ? 'Profile photo updated' : 'Profile saved', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const upload = async (file) => {
    if (!file) return;
    if (file.type.indexOf('image/') !== 0) { toast('Please choose an image.', 'error'); return; }
    setBusy('photo');
    try {
      const ready = await compressImage(file);
      const r = await rpc('createAvatarUpload', { name: ready.name, mimeType: ready.type, size: ready.size });
      await putToSignedUrl(r.uploadUrl, ready);
      await save({ avatarPath: r.path });
    } catch (e) { toast(e.message, 'error'); setBusy(''); }
  };
  const changePassword = async (e) => {
    e.preventDefault();
    try {
      await rpc('changePassword', { currentPassword: pw.cur, newPassword: pw.next });
      setPw({ cur: '', next: '' });
      toast('Password updated. Other devices were signed out.', 'success');
    } catch (e2) { toast(e2.message, 'error'); }
  };
  const everywhere = async () => {
    if (!(await confirm({ title: 'Sign out other devices?', message: 'They will need a code from your email next time they sign in.', confirmLabel: 'Sign out others' }))) return;
    try { await rpc('signOutEverywhere', {}); toast('Signed out on your other devices', 'success'); } catch (e) { toast(e.message, 'error'); }
  };

  return (<>
    <Card title="Your profile" icon={User} lead="How you appear to your team and on posts you add.">
      <div className="row wrap" style={{ gap: 16 }}>
        <Avatar person={{ name: d.name, avatarUrl: u.avatarUrl }} large />
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <button type="button" className="btn" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy === 'photo'}>{busy === 'photo' ? <LoaderCircle className="spin" /> : <Upload />}Upload photo</button>
            {u.avatarUrl && <button type="button" className="btn btn-ghost" onClick={() => save({ avatarPath: '' })}>Remove</button>}
          </div>
          <span className="hint">JPG, PNG or WebP. Compressed automatically.</span>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <Field label="Full name"><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoComplete="name" /></Field>
        <Field label="Job title"><input className="input" value={d.title} placeholder="e.g. Social media manager" onChange={(e) => setD({ ...d, title: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={d.phone} inputMode="tel" onChange={(e) => setD({ ...d, phone: e.target.value })} autoComplete="tel" /></Field>
        <Field label="Email (used to sign in)"><input className="input" value={u.email} readOnly style={{ background: 'var(--surface-2)' }} /></Field>
      </div>
      <div><button type="button" className="btn btn-primary" onClick={() => save()} disabled={busy === 'profile'}>Save profile</button></div>
    </Card>
    <Card title="Password" icon={KeyRound} lead="Changing your password signs you out on your other devices.">
      <form className="grid grid-2" style={{ gap: 12, alignItems: 'end' }} onSubmit={changePassword}>
        <Field label="Current password"><PasswordInput value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} required autoComplete="current-password" /></Field>
        <Field label="New password" hint="At least 8 characters"><PasswordInput value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
        <div><button type="submit" className="btn btn-primary">Update password</button></div>
      </form>
    </Card>
    <Card title="Devices and sign-in" icon={ShieldCheck} lead={'New browsers and phones need a 6-digit code sent to ' + u.email + ' the first time. They are then trusted for 30 days.'}>
      <div className="row wrap">
        <button type="button" className="btn" onClick={everywhere}>Sign out other devices</button>
        <button type="button" className="btn btn-danger-ghost" onClick={signOut}><LogOut />Sign out</button>
      </div>
    </Card>
  </>);
}

function Tags() {
  const { data, refresh } = useData();
  const { toast } = useUi();
  const [list, setList] = useState(() => (data.tags || []).map((t) => ({ ...t })));
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setList(list.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= list.length) return; const n = list.slice(); [n[i], n[j]] = [n[j], n[i]]; setList(n); };
  const save = async () => {
    setBusy(true);
    try { await rpc('saveTags', { tags: list }); await refresh(); toast('Tags saved', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Tag library" icon={Tag} lead="These appear as one-click options on every post. Renaming a tag updates it on every post that uses it."
      action={<button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>Save tags</button>}>
      <div className="stack" style={{ gap: 8 }}>
        {list.length === 0 && <div className="soft">No tags yet. Add your first, like “Launch”, “Reel” or “Offer”.</div>}
        {list.map((t, i) => (
          <div key={t.id || 'new' + i} className="row">
            <input type="color" value={t.color || '#9ca3af'} onChange={(e) => set(i, 'color', e.target.value)} aria-label="Tag color"
              style={{ width: 40, height: 36, padding: 3, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--surface)', cursor: 'pointer', flexShrink: 0 }} />
            <input className="input grow" value={t.name} maxLength={40} placeholder="Tag name" onChange={(e) => set(i, 'name', e.target.value)} aria-label="Tag name" />
            <button type="button" className="btn btn-ghost btn-icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp /></button>
            <button type="button" className="btn btn-ghost btn-icon" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown /></button>
            <button type="button" className="btn btn-danger-ghost btn-icon" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="Delete tag"><Trash2 /></button>
          </div>
        ))}
        <div><button type="button" className="btn btn-sm" onClick={() => setList(list.concat([{ id: '', name: '', color: COLORS[list.length % COLORS.length] }]))}><Plus />Add tag</button></div>
      </div>
    </Card>
  );
}

function Team() {
  const { data, patch } = useData();
  const { toast } = useUi();
  const [s, setS] = useState({ ...data.settings });
  const [team, setTeam] = useState(() => data.team.map((t) => ({ ...t, password: '', isExisting: true })));
  const [busy, setBusy] = useState(false);
  const setMember = (i, k, v) => setTeam(team.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const save = async () => {
    setBusy(true);
    try {
      const r = await rpc('saveTeamAndSettings', { settings: s, team });
      patch((x) => ({ ...x, settings: r.settings, team: r.team }));
      setTeam(r.team.map((t) => ({ ...t, password: '', isExisting: true })));
      toast('Team and settings saved', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  return (<>
    <Card title="Workspace" icon={Building2} action={<button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>Save</button>}>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <Field label="Agency name"><input className="input" value={s.agencyName} onChange={(e) => setS({ ...s, agencyName: e.target.value })} /></Field>
        <Field label="Team notification email" hint="Gets client comments, approvals and new client posts."><input className="input" type="email" value={s.agencyEmail} onChange={(e) => setS({ ...s, agencyEmail: e.target.value })} /></Field>
        <Field label="Default currency"><input className="input" value={s.defaultCurrency} onChange={(e) => setS({ ...s, defaultCurrency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Invoice due after (days)"><input className="input num" inputMode="numeric" value={s.dueDays} onChange={(e) => setS({ ...s, dueDays: e.target.value })} /></Field>
      </div>
    </Card>
    <Card title="Team members" icon={Users} action={<button type="button" className="btn btn-sm" onClick={() => setTeam(team.concat([{ name: '', email: '', role: 'Designer', password: '', isExisting: false }]))}><Plus />Add person</button>}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th><th aria-label="Remove" /></tr></thead>
          <tbody>
            {team.map((m, i) => (
              <tr key={m.email || 'new' + i}>
                <td style={{ minWidth: 150 }}><input className="input" value={m.name} onChange={(e) => setMember(i, 'name', e.target.value)} aria-label="Name" /></td>
                <td style={{ minWidth: 200 }}><input className="input" type="email" value={m.email} readOnly={m.isExisting} style={m.isExisting ? { background: 'var(--surface-2)' } : undefined} onChange={(e) => setMember(i, 'email', e.target.value)} aria-label="Email" /></td>
                <td style={{ minWidth: 150 }}><select className="select" value={m.role} onChange={(e) => setMember(i, 'role', e.target.value)} aria-label="Role">{['Admin', 'Account Manager', 'Designer'].map((r) => <option key={r}>{r}</option>)}</select></td>
                <td style={{ minWidth: 200 }}><PasswordInput value={m.password} placeholder={m.isExisting ? 'Leave blank to keep' : 'At least 8 characters'} autoComplete="new-password" onChange={(e) => setMember(i, 'password', e.target.value)} /></td>
                <td><button type="button" className="btn btn-danger-ghost btn-icon" onClick={() => setTeam(team.filter((_, j) => j !== i))} aria-label={'Remove ' + (m.name || 'person')}><Trash2 /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Save team</button></div>
    </Card>
  </>);
}
