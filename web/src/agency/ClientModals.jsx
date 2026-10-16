import { useState } from 'react';
import { Archive, ArchiveRestore, Copy, Eye, ExternalLink, Pencil, RefreshCw, Trash2, Link2Off } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData, upsert } from '../data.jsx';
import { go } from '../lib/route.js';
import { Dot, Field, Modal, useUi } from '../components/ui.jsx';
import { COLORS, cx } from '../lib/util.js';

export function ClientModal({ client, parentId, projectId, onClose, onSaved }) {
  const { data, patch, refresh } = useData();
  const { toast, confirm } = useUi();
  const isNew = !client;
  const parent = (client ? client.parentId : parentId) ? data.clients.find((c) => c.id === (client ? client.parentId : parentId)) : null;
  const [d, setD] = useState(() => client ? { ...client } : { name: '', notifyEmail: '', currency: '', color: COLORS[data.clients.length % COLORS.length], parentId: parentId || '' });
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const set = (k, v) => setD({ ...d, [k]: v });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await rpc('saveClient', { id: client ? client.id : '', parentId: d.parentId, projectId: projectId || '', name: d.name, notifyEmail: d.notifyEmail, currency: d.currency, color: d.color, timeTracking: Boolean(d.timeTracking) });
      patch((x) => ({ ...x, clients: upsert(x.clients, r.client) }));
      toast(isNew ? 'Client added' : 'Client saved', 'success');
      onClose();
      if (isNew && onSaved) onSaved(r.client);
      else if (isNew) go('client', r.client.id);
    } catch (e2) {
      toast(e2.message, 'error');
      setBusy(false);
    }
  };
  const archive = async () => {
    try {
      await rpc('archiveClient', { clientId: client.id, archive: !client.archived });
      await refresh();
      toast(client.archived ? 'Client restored' : 'Client archived', 'success');
      onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  const del = async () => {
    if (!(await confirm({ title: 'Delete ' + client.name + ' permanently?', message: 'All posts, comments, history and invoices for this client' + (client.parentId ? '' : ' and its sub-clients') + ' will be deleted. This cannot be undone.', confirmLabel: 'Delete permanently', danger: true }))) return;
    try {
      await rpc('deleteClient', { clientId: client.id, confirmName });
      await refresh();
      go('overview');
      toast('Client deleted', 'success');
      onClose();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <Modal title={isNew ? (parent ? 'Add a sub-client to ' + parent.name : 'Add a client') : 'Client settings'} onClose={onClose}
      footer={<><span /><div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" form="client-form" className="btn btn-primary" disabled={busy || !d.name.trim()}>{isNew ? 'Add client' : 'Save'}</button></div></>}>
      <form id="client-form" className="modal-body stack" style={{ gap: 16 }} onSubmit={save}>
        <Field label="Name" htmlFor="c-name"><input id="c-name" className="input" value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus placeholder={parent ? 'e.g. Acme Coffee' : 'e.g. Acme Group'} /></Field>
        <Field label="Notification email" hint="Gets review requests and invoices. Sub-clients use their main client's email if empty.">
          <input className="input" type="email" value={d.notifyEmail} onChange={(e) => set('notifyEmail', e.target.value)} placeholder="marketing@client.com" />
        </Field>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label="Currency" hint="Leave empty to inherit"><input className="input" value={d.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} placeholder={data.settings.defaultCurrency || 'USD'} /></Field>
          <Field label="Color">
            <div className="row wrap" style={{ gap: 6 }}>
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => set('color', c)} aria-label={'Color ' + c} aria-pressed={d.color === c}
                  style={{ width: 24, height: 24, borderRadius: 999, border: d.color === c ? '2px solid var(--text)' : '2px solid transparent', background: c, cursor: 'pointer', boxShadow: 'inset 0 0 0 2px var(--surface)' }} />
              ))}
            </div>
          </Field>
        </div>
        <label className="switch-row">
          <span className="grow">
            <span style={{ fontWeight: 500, display: 'block' }}>Time tracking</span>
            <span className="hint">Shows a timer and hour logging on this client's projects, so hours can be invoiced.</span>
          </span>
          <input type="checkbox" className="switch" checked={Boolean(d.timeTracking)} onChange={(e) => set('timeTracking', e.target.checked)} />
        </label>
        {!isNew && (
          <>
            <hr className="divider" />
            <div className="row-between">
              <div><div style={{ fontWeight: 500 }}>{client.archived ? 'Restore client' : 'Archive client'}</div><div className="hint">{client.archived ? 'Shows it again and re-enables its share link.' : 'Hides it from the sidebar and turns off its share link.'}</div></div>
              <button type="button" className="btn" onClick={archive}>{client.archived ? <ArchiveRestore /> : <Archive />}{client.archived ? 'Restore' : 'Archive'}</button>
            </div>
            {data.isAdmin && (
              <div className="stack" style={{ gap: 8 }}>
                <div><div style={{ fontWeight: 500, color: 'var(--danger)' }}>Delete permanently</div><div className="hint">Type <b>{client.name}</b> to confirm. Uploaded files are kept.</div></div>
                <div className="row"><input className="input grow" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={client.name} aria-label="Type the client name to confirm" />
                  <button type="button" className="btn btn-danger" disabled={confirmName !== client.name} onClick={del}><Trash2 />Delete</button></div>
              </div>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}

export function ShareModal({ client, onClose }) {
  const { data, patch } = useData();
  const { toast, confirm } = useUi();
  const [busy, setBusy] = useState(false);
  const base = (data.webAppUrl || window.location.origin).replace(/\/+$/, '');
  const link = client.token ? base + '/app?t=' + client.token : '';
  const access = client.portalAccess === 'edit' ? 'edit' : 'view';

  const apply = (r) => patch((d) => ({ ...d, clients: d.clients.map((c) => (c.id === client.id ? { ...c, token: r.token !== undefined ? r.token : c.token, hasToken: r.token !== undefined ? Boolean(r.token) : c.hasToken, portalAccess: r.portalAccess || c.portalAccess } : c)) }));
  const manage = async (mode) => {
    if (mode !== 'create' && !(await confirm({ title: mode === 'rotate' ? 'Make a new link?' : 'Turn off this link?', message: 'The current link will stop working immediately.' + (mode === 'rotate' ? ' Send the new link to your client.' : ''), confirmLabel: mode === 'rotate' ? 'Make new link' : 'Turn off', danger: mode === 'disable' }))) return;
    setBusy(true);
    try { apply(await rpc('manageClientToken', { clientId: client.id, mode, access })); toast(mode === 'disable' ? 'Link turned off' : 'Link ready', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const setAccess = async (a) => {
    if (a === access) return;
    apply({ portalAccess: a });
    try { await rpc('setPortalAccess', { clientId: client.id, access: a }); toast(a === 'edit' ? 'Clients can now add and edit posts' : 'Link is now view and approve only', 'success'); }
    catch (e) { apply({ portalAccess: access }); toast(e.message, 'error'); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copied', 'success'); } catch (e) { toast('Copy failed. Select the link and copy it manually.', 'error'); }
  };

  const Option = ({ value, icon: Icon, title, text }) => (
    <button type="button" onClick={() => setAccess(value)} aria-pressed={access === value}
      className={cx('card')} style={{ textAlign: 'left', padding: 14, cursor: 'pointer', display: 'flex', gap: 12, borderColor: access === value ? 'var(--accent)' : undefined, boxShadow: access === value ? 'var(--ring)' : undefined }}>
      <span className="avatar" style={{ width: 32, height: 32 }}><Icon size={16} /></span>
      <span><span style={{ display: 'block', fontWeight: 600 }}>{title}</span><span className="hint">{text}</span></span>
    </button>
  );

  return (
    <Modal title={<><Dot color={client.color} />Share {client.name}</>} onClose={onClose}
      subtitle={<div className="meta-line">{client.parentId ? 'This link opens only this brand.' : 'This link opens every active brand under ' + client.name + '.'}</div>}
      footer={<><span /><button type="button" className="btn" onClick={onClose}>Done</button></>}>
      <div className="modal-body stack" style={{ gap: 18 }}>
        <div className="stack" style={{ gap: 8 }}>
          <div className="label">People with the link can</div>
          <div className="grid grid-2" style={{ gap: 10 }}>
            <Option value="view" icon={Eye} title="View and approve" text="See the calendar, comment, approve or request changes." />
            <Option value="edit" icon={Pencil} title="Add and edit" text="Also add posts and reference images, and edit posts until they're scheduled." />
          </div>
        </div>
        {link ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="label">Client portal link</div>
            <div className="row"><input className="input grow" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Portal link" />
              <button type="button" className="btn" onClick={copy}><Copy />Copy</button></div>
            <div className="row wrap">
              <a className="btn btn-sm" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink />Open client view</a>
              <button type="button" className="btn btn-sm" onClick={() => manage('rotate')} disabled={busy}><RefreshCw />New link</button>
              <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => manage('disable')} disabled={busy}><Link2Off />Turn off</button>
            </div>
          </div>
        ) : (
          <div><button type="button" className="btn btn-primary" onClick={() => manage('create')} disabled={busy}>Create share link</button></div>
        )}
      </div>
    </Modal>
  );
}
