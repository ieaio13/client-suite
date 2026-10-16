import { useMemo, useState } from 'react';
import { CalendarDays, CircleAlert, Clock, FolderKanban, ListChecks, Plus, Trash2, Users } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData, upsert, remove } from '../data.jsx';
import { go } from '../lib/route.js';
import { Dot, Empty, Field, Modal, Seg, useUi } from '../components/ui.jsx';
import { cx, money, shortDate, sortClients } from '../lib/util.js';
import { PROJECT_COLOR, PROJECT_STATUSES, clientLabel, fmtMinutes, personName, projectStats, projectTracking } from './workUtil.js';

export function ProjectStatus({ status }) {
  return <span className="pill" style={{ '--c': PROJECT_COLOR[status] }}>{status}</span>;
}

// Every project, or one client's (route id = client id, which includes its sub-clients).
export default function ProjectsPage({ clientId }) {
  const { data } = useData();
  const [show, setShow] = useState('open');
  const [editing, setEditing] = useState(null);
  const byId = useMemo(() => Object.fromEntries(data.clients.map((c) => [c.id, c])), [data.clients]);
  const scopeClient = clientId ? byId[clientId] : null;
  const inScope = (p) => {
    if (!scopeClient) return true;
    const c = byId[p.clientId];
    return p.clientId === scopeClient.id || (c && c.parentId === scopeClient.id);
  };
  const all = (data.projects || []).filter(inScope);
  const list = all.filter((p) => (show === 'open' ? p.status !== 'Done' : show === 'done' ? p.status === 'Done' : true))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.name.localeCompare(b.name));

  return (
    <main className="main"><div className="main-inner rise" key={clientId || 'all'}>
      <div className="page-head">
        <div>
          <div className="crumbs">{scopeClient ? <><button type="button" onClick={() => go('client', scopeClient.id)}>{scopeClient.name}</button></> : 'Workspace'}</div>
          <h1 className="page-title">{scopeClient ? <><Dot color={scopeClient.color} size={12} />Projects</> : 'Projects'}</h1>
        </div>
        <div className="page-actions">
          <Seg label="Show" value={show} onChange={setShow} options={[{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} />
          {!data.isGuest && <button type="button" className="btn btn-primary" onClick={() => setEditing({ clientId: clientId || '' })}><Plus />New project</button>}
        </div>
      </div>
      {list.length === 0 ? (
        <div className="card"><Empty icon={FolderKanban} title={all.length ? 'Nothing here' : 'No projects yet'}>
          {all.length ? 'Try another filter.' : 'Create a project for a website, campaign or any client job, then break it into tasks.'}
        </Empty></div>
      ) : (
        <div className="grid grid-3">{list.map((p) => <ProjectCard key={p.id} project={p} byId={byId} />)}</div>
      )}
      {editing && <ProjectModal project={editing.id ? editing : null} defaultClientId={editing.clientId} onClose={() => setEditing(null)} onSaved={(p) => go('project', p.id)} />}
    </div></main>
  );
}

export function ProjectCard({ project: p, byId }) {
  const { data } = useData();
  const s = projectStats(p, data.tasks || [], data.timeEntries || [], data.today);
  const cl = clientLabel(byId, p.clientId, p);
  const people = (data.projectMembers || []).filter((m) => m.projectId === p.id).length;
  return (
    <button type="button" className="card card-pad project-card" onClick={() => go('project', p.id)}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="pc-name ellipsis">{p.name}</div>
          <div className="row soft" style={{ gap: 6, fontSize: 12.5, marginTop: 2 }}><Dot color={cl.color} size={7} /><span className="ellipsis">{cl.name}</span></div>
        </div>
        <ProjectStatus status={p.status} />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row-between" style={{ fontSize: 12.5 }}><span className="muted">{s.done} of {s.total} tasks done</span><span className="num muted">{s.pct}%</span></div>
        <div className="bar"><span style={{ width: s.pct + '%', background: 'var(--st-published)' }} /></div>
      </div>
      <div className="row wrap pc-meta">
        <span className={cx('row', s.overdue && 'danger-text')} style={{ gap: 5 }}><CalendarDays />{p.dueDate ? shortDate(p.dueDate) : 'No due date'}</span>
        {projectTracking(data.clients, p) && <span className="row" style={{ gap: 5 }}><Clock />{fmtMinutes(s.minutes)}</span>}
        {people > 0 && <span className="row" style={{ gap: 5 }}><Users />{people}</span>}
        {s.overdueTasks > 0 && <span className="row danger-text" style={{ gap: 5 }}><CircleAlert />{s.overdueTasks} late</span>}
        {p.owner && <span className="row" style={{ gap: 5 }}><ListChecks />{personName(data.team, p.owner)}</span>}
      </div>
    </button>
  );
}

function ClientOptions({ clients }) {
  const parents = sortClients(clients.filter((c) => !c.parentId && !c.archived && c.inMainList !== false));
  return parents.map((p) => {
    const subs = sortClients(clients.filter((c) => c.parentId === p.id && !c.archived && c.inMainList !== false));
    return (
      <optgroup key={p.id} label={p.name}>
        <option value={p.id}>{p.name} (main client)</option>
        {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </optgroup>
    );
  });
}

export function ProjectModal({ project, defaultClientId, onClose, onSaved }) {
  const { data, patch } = useData();
  const { toast, confirm } = useUi();
  const [f, setF] = useState(() => ({
    name: project ? project.name : '',
    clientId: project ? project.clientId : defaultClientId || '',
    status: project ? project.status : 'Active',
    startDate: project ? project.startDate : data.today,
    dueDate: project ? project.dueDate : '',
    owner: project ? project.owner : data.user.email,
    budget: project ? project.budget : '',
    description: project ? project.description : ''
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const client = data.clients.find((c) => c.id === f.clientId);
  const currency = client ? (client.currency || (data.clients.find((c) => c.id === client.parentId) || {}).currency || data.settings.defaultCurrency) : data.settings.defaultCurrency;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await rpc('saveProject', { id: project ? project.id : '', ...f });
      patch((d) => ({ ...d, projects: upsert(d.projects || [], r.project) }));
      toast(project ? 'Project updated' : 'Project created', 'success');
      onClose();
      if (!project && onSaved) onSaved(r.project);
    } catch (e2) { toast(e2.message, 'error'); setBusy(false); }
  };
  const del = async () => {
    if (!(await confirm({ title: 'Delete "' + project.name + '"?', message: 'Its tasks and logged hours are deleted too. This cannot be undone.', confirmLabel: 'Delete project', danger: true }))) return;
    try {
      await rpc('deleteProject', { id: project.id });
      patch((d) => ({
        ...d,
        projects: remove(d.projects || [], project.id),
        tasks: (d.tasks || []).filter((t) => t.projectId !== project.id),
        timeEntries: (d.timeEntries || []).filter((t) => t.projectId !== project.id)
      }));
      toast('Project deleted', 'success');
      onClose();
      go('projects');
    } catch (e2) { toast(e2.message, 'error'); }
  };

  return (
    <Modal size="lg" title={project ? 'Edit project' : 'New project'} onClose={onClose}
      footer={<>
        {project && data.isBilling ? <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={del}><Trash2 />Delete</button> : <span />}
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="project-form" className="btn btn-primary" disabled={busy || !f.name.trim()}>{project ? 'Save' : 'Create project'}</button></div>
      </>}>
      <form id="project-form" className="modal-body stack" onSubmit={save}>
        <Field label="Project name" htmlFor="pj-name"><input id="pj-name" className="input" value={f.name} onChange={set('name')} maxLength={120} required autoFocus placeholder="e.g. Website redesign" /></Field>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label="Link to one of your clients" htmlFor="pj-client" hint="Optional. You can also add clients inside the project.">
            <select id="pj-client" className="select" value={f.clientId} onChange={set('clientId')}>
              <option value="">No, keep it separate</option>
              <ClientOptions clients={data.clients} />
            </select>
          </Field>
          <Field label="Status" htmlFor="pj-status">
            <select id="pj-status" className="select" value={f.status} onChange={set('status')}>{PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
          <Field label="Start date" htmlFor="pj-start"><input id="pj-start" type="date" className="input" value={f.startDate} onChange={set('startDate')} /></Field>
          <Field label="Due date" htmlFor="pj-due"><input id="pj-due" type="date" className="input" value={f.dueDate} onChange={set('dueDate')} /></Field>
          <Field label="Project lead" htmlFor="pj-owner">
            <select id="pj-owner" className="select" value={f.owner} onChange={set('owner')}>
              <option value="">Nobody yet</option>
              {data.team.map((t) => <option key={t.email} value={t.email}>{t.name}</option>)}
            </select>
          </Field>
          {data.isBilling && (
            <Field label={'Budget (' + currency + ')'} htmlFor="pj-budget" hint="Only people who see invoices can see this.">
              <input id="pj-budget" className="input num" inputMode="decimal" value={f.budget} onChange={set('budget')} placeholder="Optional" />
            </Field>
          )}
        </div>
        <Field label="Description" htmlFor="pj-desc"><textarea id="pj-desc" className="input textarea" value={f.description} onChange={set('description')} maxLength={4000} placeholder="Goals, scope, links…" /></Field>
        {project && data.isBilling && project.budget && <p className="soft" style={{ margin: 0, fontSize: 12.5 }}>Current budget: {money(project.budget, currency)}</p>}
      </form>
    </Modal>
  );
}
