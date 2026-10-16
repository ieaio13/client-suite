import { useMemo, useState } from 'react';
import { ArrowRightLeft, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Clock, Columns3, Copy, ExternalLink, LayoutList, ListChecks, Mail, Pencil, Plus, Receipt, Table2, Trash2, User, UserPlus, Users } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData, upsert, remove } from '../data.jsx';
import { go } from '../lib/route.js';
import { Avatar, Dot, Empty, Field, Modal, Seg, useUi } from '../components/ui.jsx';
import { addDays, cx, filterPosts, money, monthLabel, parseYmd, relDay, shortDate, ymd } from '../lib/util.js';
import { ProjectModal, ProjectStatus } from './Projects.jsx';
import { TimeEntryModal, TimerButton, useNow } from './Timer.jsx';
import { TASK_COLOR, TASK_STATUSES, clientLabel, entryMinutes, fmtMinutes, hoursDecimal, personName, projectBillTo, projectClients, projectStats, projectTracking } from './workUtil.js';
import { EMPTY_FILTERS, Toolbar } from '../views/Toolbar.jsx';
import Calendar from '../views/Calendar.jsx';
import Board from '../views/Board.jsx';
import TableView from '../views/TableView.jsx';
import PostEditor from '../post/PostEditor.jsx';
import { InvoiceList } from '../invoices/Invoices.jsx';
import { ClientModal, ShareModal } from '../agency/ClientModals.jsx';

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
function writePref(key, v) {
  try { localStorage.setItem(key, v); } catch (e) {}
}

// A project is its own small workspace: tasks, the content of its clients, its clients,
// its invoices and the people working on it.
export default function ProjectPage({ project, tab }) {
  const { data, patch } = useData();
  const { toast } = useUi();
  const [modal, setModal] = useState(null);
  const byId = useMemo(() => Object.fromEntries(data.clients.map((c) => [c.id, c])), [data.clients]);
  const linked = project.clientId ? byId[project.clientId] : null;
  const tracking = projectTracking(data.clients, project);
  const own = projectClients(data.clients, project.id);
  const tasks = (data.tasks || []).filter((t) => t.projectId === project.id);
  const entries = (data.timeEntries || []).filter((e) => e.projectId === project.id);
  const s = projectStats(project, data.tasks || [], data.timeEntries || [], data.today);
  const now = useNow(entries.some((e) => e.startedAt), 30000);
  const guest = Boolean(data.isGuest);
  const currency = (own[0] && own[0].currency) || (linked && linked.currency) || data.settings.defaultCurrency;
  const people = (data.projectMembers || []).filter((m) => m.projectId === project.id);

  const tabs = [
    { id: 'tasks', label: 'Tasks', icon: ListChecks, count: tasks.filter((t) => t.status !== 'Done').length },
    { id: 'content', label: 'Content', icon: CalendarDays },
    { id: 'clients', label: 'Clients', icon: Users, count: own.length },
    data.isBilling && { id: 'invoices', label: 'Invoices', icon: Receipt },
    { id: 'people', label: 'People', icon: UserPlus, count: people.length },
    tracking && { id: 'time', label: 'Time', icon: Clock }
  ].filter(Boolean);
  const current = tabs.some((t) => t.id === tab) ? tab : 'tasks';

  const move = async (task, status, order) => {
    const before = data.tasks;
    const pos = Object.fromEntries(order.map((id, i) => [id, i]));
    patch((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, status, sortOrder: pos[t.id] } : t.id in pos ? { ...t, sortOrder: pos[t.id] } : t)) }));
    try {
      const r = await rpc('moveTask', { id: task.id, status, order });
      patch((d) => ({ ...d, tasks: upsert(d.tasks, r.task) }));
    } catch (e) {
      patch((d) => ({ ...d, tasks: before }));
      toast(e.message, 'error');
    }
  };
  const reschedule = async (task, dueDate) => {
    const before = data.tasks;
    patch((d) => ({ ...d, tasks: upsert(d.tasks, { ...task, dueDate }) }));
    try {
      const r = await rpc('saveTask', { id: task.id, projectId: task.projectId, title: task.title, notes: task.notes, status: task.status, assignee: task.assignee, dueDate, estimateHours: task.estimateHours });
      patch((d) => ({ ...d, tasks: upsert(d.tasks, r.task) }));
    } catch (e) {
      patch((d) => ({ ...d, tasks: before }));
      toast(e.message, 'error');
    }
  };

  const byPerson = {};
  for (const e of entries) byPerson[e.userEmail] = (byPerson[e.userEmail] || 0) + entryMinutes(e, now);

  return (
    <main className="main"><div className="main-inner rise" key={project.id}>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="crumbs">
            <button type="button" onClick={() => go('projects')}>Projects</button>
            {linked && <><ChevronRight size={14} /><button type="button" onClick={() => go('client', linked.id)} className="row" style={{ gap: 6 }}><Dot color={linked.color} size={7} />{linked.name}</button></>}
          </div>
          <h1 className="page-title">{project.name}<ProjectStatus status={project.status} /></h1>
        </div>
        <div className="page-actions">
          {!guest && <button type="button" className="btn btn-icon" onClick={() => setModal({ type: 'edit' })} title="Edit project" aria-label="Edit project"><Pencil /></button>}
          {current === 'tasks' && <button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'task', task: null, status: 'To do' })}><Plus />New task</button>}
          {current === 'clients' && data.isBilling && <button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'client', parentId: '' })}><Plus />Add client</button>}
        </div>
      </div>

      <nav className="tabs" aria-label="Project sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={cx('tab', current === t.id && 'on')} onClick={() => go('project', project.id, t.id)} aria-current={current === t.id ? 'page' : undefined}>
            <t.icon />{t.label}{t.count > 0 && <span className="badge">{t.count}</span>}
          </button>
        ))}
      </nav>

      {current === 'tasks' && (<>
        <div className="grid grid-4" style={{ marginBottom: 18 }}>
          <div className="card stat"><div className="k">Progress</div><div className="v num">{s.pct}%</div><div className="bar" style={{ marginTop: 10 }}><span style={{ width: s.pct + '%', background: 'var(--st-published)' }} /></div></div>
          <div className="card stat"><div className="k"><ListChecks />Tasks done</div><div className="v num">{s.done} / {s.total}</div>{s.overdueTasks > 0 && <div className="danger-text" style={{ fontSize: 12.5, marginTop: 2 }}>{s.overdueTasks} late</div>}</div>
          <div className="card stat"><div className="k"><CalendarDays />Due</div><div className={cx('v', s.overdue && 'danger-text')} style={{ fontSize: 20 }}>{project.dueDate ? shortDate(project.dueDate) : 'No date'}</div></div>
          {data.isBilling
            ? <div className="card stat"><div className="k"><Receipt />Budget</div><div className="v" style={{ fontSize: 20 }}>{project.budget ? money(project.budget, currency) : 'Not set'}</div>{tracking && <div className="soft" style={{ fontSize: 12.5, marginTop: 2 }}>{fmtMinutes(s.unbilled)} not invoiced yet</div>}</div>
            : <div className="card stat"><div className="k"><User />Lead</div><div className="v" style={{ fontSize: 20 }}>{personName(data.team, project.owner) || 'Nobody yet'}</div></div>}
        </div>
        {project.description && <p className="muted project-desc">{project.description}</p>}
        <TaskViews tasks={tasks} entries={entries} tracking={tracking} today={data.today}
          onOpen={(t) => setModal({ type: 'task', task: t })} onAdd={(status, dueDate) => setModal({ type: 'task', task: null, status, dueDate })}
          onMove={move} onReschedule={reschedule} />
      </>)}

      {current === 'content' && <ProjectContent project={project} clients={own} onAddClient={() => go('project', project.id, 'clients')} />}
      {current === 'clients' && <ProjectClients project={project} clients={own} onAdd={(parentId) => setModal({ type: 'client', parentId })} />}
      {current === 'invoices' && data.isBilling && (
        <InvoiceList project={project} billTo={projectBillTo(data.clients, project)}
          actions={tracking && s.unbilled > 0 ? <button type="button" className="btn" onClick={() => setModal({ type: 'hours' })}><Clock />Invoice {hoursDecimal(s.unbilled)}h</button> : null} />
      )}
      {current === 'people' && <ProjectPeople project={project} />}
      {current === 'time' && tracking && (
        <section className="card">
          <div className="card-head"><h3>Time on this project</h3>
            <div className="row wrap" style={{ gap: 12, justifyContent: 'flex-end' }}>
              {Object.entries(byPerson).map(([email, m]) => <span key={email} className="soft" style={{ fontSize: 12.5 }}>{personName(data.team, email)}: <b className="num" style={{ color: 'var(--text)' }}>{fmtMinutes(m)}</b></span>)}
              <TimerButton projectId={project.id} small />
              <button type="button" className="btn btn-sm" onClick={() => setModal({ type: 'time' })}><Plus />Log time</button>
            </div>
          </div>
          {entries.length === 0 ? <Empty icon={Clock} title="No hours yet">Start the timer or log time by hand.</Empty> : (
            <EntryTable entries={entries.slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))} tasks={tasks} now={now}
              onOpen={(e) => setModal({ type: 'time', entry: e })} />
          )}
        </section>
      )}

      {modal && modal.type === 'edit' && <ProjectModal project={project} onClose={() => setModal(null)} />}
      {modal && modal.type === 'task' && <TaskEditor task={modal.task} projectId={project.id} defaultStatus={modal.status} defaultDue={modal.dueDate} onClose={() => setModal(null)} />}
      {modal && modal.type === 'time' && <TimeEntryModal entry={modal.entry} defaults={{ projectId: project.id }} onClose={() => setModal(null)} />}
      {modal && modal.type === 'client' && <ClientModal parentId={modal.parentId} projectId={project.id} onClose={() => setModal(null)} onSaved={() => toast('Client added to the project', 'success')} />}
      {modal && modal.type === 'hours' && <ProjectHoursModal project={project} onClose={() => setModal(null)} />}
    </div></main>
  );
}

/* ---------- Tasks: board, calendar or table ---------- */

function TaskViews({ tasks, entries, tracking, today, onOpen, onAdd, onMove, onReschedule }) {
  const [view, setViewState] = useState(() => readPref('cf_task_view', 'board'));
  const setView = (v) => { setViewState(v); writePref('cf_task_view', v); };
  return (<>
    <div className="toolbar"><Seg label="View" value={view} onChange={setView} options={[
      { value: 'board', label: 'Board', icon: Columns3 }, { value: 'calendar', label: 'Calendar', icon: CalendarDays }, { value: 'table', label: 'Table', icon: Table2 }
    ]} /></div>
    {view === 'board' && <TaskBoard tasks={tasks} entries={entries} tracking={tracking} onOpen={onOpen} onAdd={(st) => onAdd(st)} onMove={onMove} />}
    {view === 'calendar' && <TaskCalendar tasks={tasks} today={today} onOpen={onOpen} onAdd={(date) => onAdd('To do', date)} onReschedule={onReschedule} />}
    {view === 'table' && <TaskTable tasks={tasks} entries={entries} tracking={tracking} today={today} onOpen={onOpen} />}
  </>);
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function TaskCalendar({ tasks, today, onOpen, onAdd, onReschedule }) {
  const [cursor, setCursor] = useState(today.slice(0, 8) + '01');
  const [drop, setDrop] = useState('');
  const first = parseYmd(cursor);
  const shift = (first.getDay() + 6) % 7;
  const start = addDays(cursor, -shift);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const month = cursor.slice(0, 7);
  const byDay = {};
  for (const t of tasks) if (t.dueDate) (byDay[t.dueDate] = byDay[t.dueDate] || []).push(t);
  const nextMonth = (n) => { const d = parseYmd(cursor); d.setMonth(d.getMonth() + n, 1); setCursor(ymd(d)); };
  const undated = tasks.filter((t) => !t.dueDate && t.status !== 'Done');
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="cal-head">
        <button type="button" className="btn btn-icon" onClick={() => nextMonth(-1)} aria-label="Previous month"><ChevronLeft /></button>
        <button type="button" className="btn" onClick={() => setCursor(today.slice(0, 8) + '01')}>Today</button>
        <button type="button" className="btn btn-icon" onClick={() => nextMonth(1)} aria-label="Next month"><ChevronRight /></button>
        <h2>{monthLabel(cursor)}</h2>
      </div>
      <div className="cal">
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {days.map((day) => (
          <div key={day} className={cx('cal-cell', day.slice(0, 7) !== month && 'out', drop === day && 'drop')}
            onDragOver={(e) => { e.preventDefault(); setDrop(day); }} onDragLeave={() => setDrop('')}
            onDrop={(e) => { e.preventDefault(); setDrop(''); const t = tasks.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (t && t.dueDate !== day) onReschedule(t, day); }}>
            <div className="cal-top">
              <span className={cx('cal-num', day === today && 'today')}>{Number(day.slice(8))}</span>
              <button type="button" className="btn btn-ghost btn-icon btn-sm cal-add" onClick={() => onAdd(day)} aria-label={'Add task due ' + day}><Plus /></button>
            </div>
            {(byDay[day] || []).map((t) => (
              <button key={t.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                className={cx('task-chip', t.status === 'Done' && 'done')} style={{ '--c': TASK_COLOR[t.status] }} onClick={() => onOpen(t)} title={t.title + ' · ' + t.status}>
                <span className="ellipsis">{t.title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {undated.length > 0 && (
        <div className="card card-pad">
          <div className="soft" style={{ fontSize: 12.5, marginBottom: 8 }}>No due date · drag onto a day to schedule</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {undated.map((t) => (
              <button key={t.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                className="task-chip" style={{ '--c': TASK_COLOR[t.status], width: 'auto' }} onClick={() => onOpen(t)}>{t.title}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskTable({ tasks, entries, tracking, today, onOpen }) {
  const { data } = useData();
  const order = Object.fromEntries(TASK_STATUSES.map((s, i) => [s, i]));
  const list = tasks.slice().sort((a, b) => order[a.status] - order[b.status] || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const logged = {};
  for (const e of entries) if (e.taskId && !e.startedAt) logged[e.taskId] = (logged[e.taskId] || 0) + e.minutes;
  if (!list.length) return <div className="card"><Empty icon={ListChecks} title="No tasks yet">Add the first task for this project.</Empty></div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Task</th><th>Status</th><th>Assigned to</th><th>Due</th><th style={{ textAlign: 'right' }}>Estimate</th>{tracking && <th style={{ textAlign: 'right' }}>Logged</th>}</tr></thead>
        <tbody>
          {list.map((t) => {
            const late = t.status !== 'Done' && t.dueDate && t.dueDate < today;
            return (
              <tr key={t.id} className="click" onClick={() => onOpen(t)}>
                <td style={{ fontWeight: 500 }} className={t.status === 'Done' ? 'soft' : ''}>{t.title}</td>
                <td><span className="pill" style={{ '--c': TASK_COLOR[t.status] }}>{t.status}</span></td>
                <td>{personName(data.team, t.assignee) || <span className="soft">Nobody</span>}</td>
                <td className={cx('num', late && 'danger-text')} style={{ whiteSpace: 'nowrap' }}>{t.dueDate ? relDay(t.dueDate, today) : '–'}</td>
                <td className="num" style={{ textAlign: 'right' }}>{t.estimateHours ? t.estimateHours + 'h' : '–'}</td>
                {tracking && <td className="num" style={{ textAlign: 'right' }}>{logged[t.id] ? fmtMinutes(logged[t.id]) : '–'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Content: posts of the project's clients ---------- */

function ProjectContent({ project, clients, onAddClient }) {
  const { data, patch } = useData();
  const { toast } = useUi();
  const [clientId, setClientId] = useState('');
  const [view, setViewState] = useState(() => readPref('cf_project_content_view', 'calendar'));
  const setView = (v) => { setViewState(v); writePref('cf_project_content_view', v); };
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [editor, setEditor] = useState(null);
  const ids = clientId ? [clientId] : clients.map((c) => c.id);
  const all = useMemo(() => data.posts.filter((p) => ids.includes(p.clientId)), [data.posts, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const posts = useMemo(() => filterPosts(all, filters), [all, filters]);
  const clientsById = useMemo(() => Object.fromEntries(data.clients.map((c) => [c.id, c])), [data.clients]);
  const tagNames = useMemo(() => [...new Set(all.flatMap((p) => p.tags))].sort(), [all]);
  const columns = clientId ? (data.boardColumns || []).filter((c) => c.clientId === clientId) : [];
  // New posts go to the chosen client, or the first sub-client (brand) of the project.
  const target = clientId || (clients.find((c) => c.parentId) || clients[0] || {}).id;

  if (!clients.length) {
    return <div className="card"><Empty icon={CalendarDays} title="No clients in this project yet">Add a client to the project to plan its content here.
      {data.isBilling && <div style={{ marginTop: 12 }}><button type="button" className="btn btn-primary" onClick={onAddClient}><Plus />Add a client</button></div>}</Empty></div>;
  }

  const move = async (id, change) => {
    const post = data.posts.find((p) => p.id === id);
    if (!post) return;
    const col = change.columnId ? columns.find((c) => c.id === change.columnId) : null;
    const next = { ...post, ...change, ...(col ? { status: col.afterStatus } : {}) };
    if (change.status && !change.columnId) next.columnId = '';
    patch((d) => ({ ...d, posts: upsert(d.posts, next) }));
    try {
      const r = await rpc('movePost', { postId: id, ...change });
      patch((d) => ({ ...d, posts: upsert(d.posts, r.post), activity: r.activity ? d.activity.concat([r.activity]) : d.activity }));
    } catch (e) {
      patch((d) => ({ ...d, posts: upsert(d.posts, post) }));
      toast(e.message, 'error');
    }
  };
  const shared = { clientsById, showBrand: !clientId && clients.length > 1, today: data.today, onOpen: (p) => setEditor({ post: p }) };

  return (<>
    <Toolbar view={view} onView={setView} filters={filters} onFilters={setFilters} tags={tagNames} team={data.team} showAssignee panelOpen onTogglePanel={() => {}}
      extra={<>
        <select className="select" style={{ width: 'auto' }} value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Which client">
          <option value="">All project clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.parentId ? '   ' : ''}{c.name}</option>)}
        </select>
        <button type="button" className="btn btn-primary" onClick={() => setEditor({ newFor: { clientId: target, date: data.today } })}><Plus />New post</button>
      </>} />
    {view === 'calendar' && <Calendar {...shared} posts={posts} canAdd canMove onNew={(date) => setEditor({ newFor: { clientId: target, date } })} onMoveDate={(id, date) => move(id, { date })} />}
    {view === 'board' && <Board {...shared} posts={posts} columns={columns} tags={data.tags} comments={data.comments} canMove canManage={false} onMove={move} onSaveColumn={() => {}} onDeleteColumn={() => {}} />}
    {view === 'table' && <TableView {...shared} posts={posts} team={data.team} tags={data.tags} />}
    {editor && <PostEditor post={editor.post} newFor={editor.newFor} onClose={() => setEditor(null)} />}
  </>);
}

/* ---------- Clients inside the project ---------- */

function ProjectClients({ project, clients, onAdd }) {
  const { data, patch } = useData();
  const { toast, confirm } = useUi();
  const [share, setShare] = useState(null);
  const parents = clients.filter((c) => !c.parentId);
  const posts = (id) => data.posts.filter((p) => p.clientId === id).length;
  const moveToMain = async (c) => {
    if (!(await confirm({ title: 'Move ' + c.name + ' to your clients?', message: 'It and its sub-clients appear in your sidebar with all their posts. They stay part of this project too, so people in the project keep access.', confirmLabel: 'Move to my clients' }))) return;
    try {
      const r = await rpc('moveClientToMain', { clientId: c.id });
      const moved = new Set(r.clientIds);
      patch((d) => ({ ...d, clients: d.clients.map((x) => (moved.has(x.id) ? { ...x, inMainList: true } : x)) }));
      toast(c.name + ' is now in your client list', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  if (!clients.length) {
    return <div className="card"><Empty icon={Users} title="No clients in this project">{data.isBilling
      ? 'Add the clients and sub-clients this project is for. They stay inside the project until you move them to your main list.'
      : 'The project lead hasn\'t added any clients yet.'}</Empty></div>;
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      {parents.map((p) => {
        const subs = clients.filter((c) => c.parentId === p.id);
        return (
          <section key={p.id} className="card">
            <div className="card-head">
              <h3 className="row"><Dot color={p.color} />{p.name}{p.inMainList && <span className="badge">In your clients</span>}</h3>
              <div className="row wrap" style={{ gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => go('client', p.id)}><ExternalLink />Open</button>
                {data.isBilling && <button type="button" className="btn btn-sm" onClick={() => setShare(p)}>Share link</button>}
                {data.isBilling && <button type="button" className="btn btn-sm" onClick={() => onAdd(p.id)}><Plus />Sub-client</button>}
                {data.isBilling && !p.inMainList && <button type="button" className="btn btn-sm" onClick={() => moveToMain(p)}><ArrowRightLeft />Move to my clients</button>}
              </div>
            </div>
            <div className="mini-list" style={{ padding: 8 }}>
              <button type="button" className="mini-item" onClick={() => go('client', p.id)}>
                <span className="grow"><span className="t">Main client</span><span className="s" style={{ display: 'block' }}>{posts(p.id)} posts</span></span><ChevronRight size={16} className="soft" />
              </button>
              {subs.map((c) => (
                <button key={c.id} type="button" className="mini-item" onClick={() => go('client', c.id)}>
                  <Dot color={c.color} />
                  <span className="grow"><span className="t">{c.name}</span><span className="s" style={{ display: 'block' }}>{posts(c.id)} posts</span></span><ChevronRight size={16} className="soft" />
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {share && <ShareModal client={share} onClose={() => setShare(null)} />}
    </div>
  );
}

/* ---------- People in the project ---------- */

function ProjectPeople({ project }) {
  const { data, patch } = useData();
  const { toast, confirm } = useUi();
  const [f, setF] = useState({ name: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null); // { email, url, emailed }
  const members = (data.projectMembers || []).filter((m) => m.projectId === project.id);
  const everyone = (data.team || []).concat(data.guests || []);
  const person = (email) => everyone.find((t) => t.email === email) || { email, name: email };
  const lead = project.owner ? person(project.owner) : null;

  const invite = async (e, resendEmail) => {
    if (e) e.preventDefault();
    setBusy(true);
    try {
      const r = await rpc('inviteToProject', resendEmail ? { projectId: project.id, email: resendEmail, resend: true } : { projectId: project.id, email: f.email, name: f.name });
      patch((d) => ({
        ...d,
        projectMembers: (d.projectMembers || []).filter((m) => !(m.projectId === r.member.projectId && m.email === r.member.email)).concat([r.member]),
        guests: r.isGuest && !(d.guests || []).some((g) => g.email === r.person.email) ? (d.guests || []).concat([r.person]) : d.guests
      }));
      if (r.inviteLink) setLink({ email: r.person.email, url: r.inviteLink, emailed: r.emailed });
      toast(r.emailed ? 'Invite sent to ' + r.person.email : (r.isGuest ? 'Added. Copy the invite link below and send it to them.' : r.person.name + ' added to the project'), 'success');
      setF({ name: '', email: '' });
    } catch (e2) { toast(e2.message, 'error'); }
    setBusy(false);
  };
  const removePerson = async (m) => {
    const p = person(m.email);
    if (!(await confirm({ title: 'Remove ' + p.name + ' from this project?', message: p.role === 'Guest' ? 'They lose access to this project. If it was their only project, their guest account is removed too.' : 'They stay on your team, but are no longer listed on this project.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      const r = await rpc('removeFromProject', { projectId: project.id, email: m.email });
      patch((d) => ({
        ...d,
        projectMembers: (d.projectMembers || []).filter((x) => !(x.projectId === project.id && x.email === m.email)),
        guests: r.removedAccount ? (d.guests || []).filter((g) => g.email !== m.email) : d.guests
      }));
      toast('Removed from the project', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="grid people-grid">
      <section className="card">
        <div className="card-head"><h3>People in this project</h3><span className="badge">{members.length + (lead && !members.some((m) => m.email === lead.email) ? 1 : 0)}</span></div>
        <div className="mini-list" style={{ padding: 8 }}>
          {lead && !members.some((m) => m.email === lead.email) && (
            <div className="mini-item" style={{ cursor: 'default' }}>
              <Avatar person={lead} /><span className="grow"><span className="t">{lead.name}</span><span className="s" style={{ display: 'block' }}>{lead.email}</span></span><span className="badge accent">Lead</span>
            </div>
          )}
          {members.map((m) => {
            const p = person(m.email);
            return (
              <div key={m.email} className="mini-item" style={{ cursor: 'default' }}>
                <Avatar person={p} />
                <span className="grow" style={{ minWidth: 0 }}><span className="t">{p.name}</span><span className="s ellipsis" style={{ display: 'block' }}>{m.email}</span></span>
                <span className="badge">{p.role === 'Guest' ? 'Guest' : (p.role || 'Team')}</span>
                {data.isBilling && p.role === 'Guest' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => invite(null, m.email)} title="Send a new invite link"><Mail />Resend</button>}
                {data.isBilling && <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removePerson(m)} aria-label={'Remove ' + p.name}><Trash2 /></button>}
              </div>
            );
          })}
          {members.length === 0 && !lead && <Empty icon={Users} title="Just you so far">Invite a designer or editor to work on this project.</Empty>}
        </div>
      </section>
      {data.isBilling && (
        <section className="card">
          <div className="card-head"><h3 className="row"><UserPlus size={16} className="muted" />Invite someone</h3></div>
          <form className="card-pad stack" onSubmit={invite}>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>They'll only see this project: its tasks, its clients' content and the people in it. Never your other clients, invoices or settings.</p>
            <Field label="Name" htmlFor="pp-name"><input id="pp-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Gita Sharma" /></Field>
            <Field label="Email" htmlFor="pp-email"><input id="pp-email" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required placeholder="gita@studio.com" /></Field>
            <button type="submit" className="btn btn-primary" disabled={busy || !f.email.trim()}><UserPlus />{busy ? 'Inviting…' : 'Invite to project'}</button>
            {link && (
              <div className="notice">
                <span className="grow" style={{ minWidth: 0 }}>
                  {link.emailed ? 'We emailed ' + link.email + ' an invite. You can also send this link yourself:' : 'Email could not be sent. Send ' + link.email + ' this one-time link:'}
                  <code className="invite-link">{link.url}</code>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(link.url); toast('Link copied', 'success'); }}><Copy />Copy</button>
              </div>
            )}
          </form>
        </section>
      )}
    </div>
  );
}

/* ---------- Invoice a project's hours ---------- */

function ProjectHoursModal({ project, onClose }) {
  const { data, patch } = useData();
  const { toast } = useUi();
  const billTo = projectBillTo(data.clients, project);
  const [f, setF] = useState({ clientId: billTo[0] ? billTo[0].id : '', from: '', to: data.today, rate: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const client = data.clients.find((c) => c.id === f.clientId);
  const currency = (client && client.currency) || data.settings.defaultCurrency;
  const rows = (data.timeEntries || []).filter((e) => e.projectId === project.id && e.billable && !e.invoiceId && !e.startedAt && e.minutes > 0
    && (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to));
  const minutes = rows.reduce((n, e) => n + e.minutes, 0);
  const rate = Number(f.rate) || 0;
  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await rpc('invoiceFromTime', { projectId: project.id, clientId: f.clientId, from: f.from, to: f.to, rate: f.rate });
      const billed = new Set(r.billedEntryIds);
      patch((d) => ({ ...d, invoices: upsert(d.invoices || [], r.invoice), timeEntries: (d.timeEntries || []).map((x) => (billed.has(x.id) ? { ...x, invoiceId: r.invoice.id } : x)) }));
      toast('Invoice ' + r.invoice.number + ' created as a draft', 'success');
      onClose();
    } catch (e2) { toast(e2.message, 'error'); setBusy(false); }
  };
  return (
    <Modal title="Invoice project hours" onClose={onClose}
      footer={<><span className="muted" style={{ fontSize: 13 }}>{minutes ? hoursDecimal(minutes) + ' h' + (rate ? ' = ' + money((minutes / 60) * rate, currency) : '') : ''}</span>
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="ph-form" className="btn btn-primary" disabled={busy || !minutes || !(rate > 0) || !f.clientId}>Create draft invoice</button></div></>}>
      <form id="ph-form" className="modal-body stack" onSubmit={create}>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Billable hours on this project that aren't invoiced yet, one line per task.</p>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label="Bill to" htmlFor="ph-client">
            <select id="ph-client" className="select" value={f.clientId} onChange={set('clientId')}>{billTo.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field label={'Hourly rate (' + currency + ')'} htmlFor="ph-rate"><input id="ph-rate" className="input num" inputMode="decimal" value={f.rate} onChange={set('rate')} required autoFocus /></Field>
          <Field label="From" htmlFor="ph-from"><input id="ph-from" type="date" className="input" value={f.from} onChange={set('from')} /></Field>
          <Field label="To" htmlFor="ph-to"><input id="ph-to" type="date" className="input" value={f.to} onChange={set('to')} /></Field>
        </div>
        {!minutes && <div className="notice">No unbilled hours in this period.</div>}
      </form>
    </Modal>
  );
}

export function EntryTable({ entries, tasks, now, onOpen, showProject }) {
  const { data } = useData();
  const taskName = (id) => { const t = (tasks || data.tasks || []).find((x) => x.id === id); return t ? t.title : ''; };
  const projName = (id) => { const p = (data.projects || []).find((x) => x.id === id); return p ? p.name : ''; };
  return (
    <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
      <table className="table">
        <thead><tr><th>Date</th><th>Person</th>{showProject && <th>Project</th>}<th>Task / note</th><th style={{ textAlign: 'right' }}>Time</th><th /></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="click" onClick={() => onOpen(e)}>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>{relDay(e.date, data.today)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{personName(data.team, e.userEmail)}</td>
              {showProject && <td className="ellipsis" style={{ maxWidth: 220 }}>{projName(e.projectId)}</td>}
              <td className="ellipsis" style={{ maxWidth: 320 }}>{[taskName(e.taskId), e.note].filter(Boolean).join(' · ') || <span className="soft">No note</span>}</td>
              <td className="num" style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{e.startedAt ? <span className="timer-text">Running{entryMinutes(e, now) > 0 ? ' · ' + fmtMinutes(entryMinutes(e, now)) : ''}</span> : fmtMinutes(e.minutes)}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {e.invoiceId ? <span className="badge accent">Invoiced</span> : !e.billable ? <span className="badge">Not billable</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskBoard({ tasks, entries, tracking, onOpen, onAdd, onMove }) {
  const { data } = useData();
  const [drag, setDrag] = useState('');
  const [over, setOver] = useState({ col: '', before: '' });
  const minutesByTask = {};
  for (const e of entries) if (e.taskId && !e.startedAt) minutesByTask[e.taskId] = (minutesByTask[e.taskId] || 0) + e.minutes;
  const inCol = (st) => tasks.filter((t) => t.status === st).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));

  const drop = (st) => {
    const task = tasks.find((t) => t.id === drag);
    setDrag(''); setOver({ col: '', before: '' });
    if (!task) return;
    const ids = inCol(st).map((t) => t.id).filter((id) => id !== task.id);
    const at = over.before ? ids.indexOf(over.before) : -1;
    if (at === -1) ids.push(task.id); else ids.splice(at, 0, task.id);
    onMove(task, st, ids);
  };

  return (
    <div className="board task-board">
      {TASK_STATUSES.map((st) => {
        const list = inCol(st);
        return (
          <section key={st} className={cx('col', over.col === st && 'drop')} aria-label={st + ' tasks'}
            onDragOver={(e) => { e.preventDefault(); if (over.col !== st) setOver({ col: st, before: '' }); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver({ col: '', before: '' }); }}
            onDrop={(e) => { e.preventDefault(); drop(st); }}>
            <header className="col-head">
              <span className="bar-c" style={{ background: TASK_COLOR[st] }} />
              <span className="name grow">{st}</span>
              <span className="badge">{list.length}</span>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ width: 26, height: 26 }} onClick={() => onAdd(st)} aria-label={'Add task to ' + st} title="Add task"><Plus /></button>
            </header>
            <div className="col-body">
              {list.map((t) => {
                const late = t.status !== 'Done' && t.dueDate && t.dueDate < data.today;
                const assignee = data.team.find((m) => m.email === t.assignee);
                const logged = minutesByTask[t.id] || 0;
                return (
                  <div key={t.id} className={cx('kcard task-card', drag === t.id && 'dragging', over.before === t.id && 'insert-before')}
                    draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); setDrag(t.id); }} onDragEnd={() => { setDrag(''); setOver({ col: '', before: '' }); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (over.before !== t.id) setOver({ col: st, before: t.id }); }}
                    onClick={() => onOpen(t)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t); }}>
                    <div className="k-body">
                      <div className={cx('k-text', t.status === 'Done' && 'done-text')}>{t.title}</div>
                      <div className="k-foot">
                        <span className="row">
                          {t.dueDate && <span className={cx('row', late && 'danger-text')} style={{ gap: 4 }}>{late ? <CircleAlert /> : <CalendarDays />}{relDay(t.dueDate, data.today)}</span>}
                          {tracking && (logged > 0 || t.estimateHours) && <span className="row" style={{ gap: 4 }}><Clock />{fmtMinutes(logged)}{t.estimateHours ? ' / ' + t.estimateHours + 'h' : ''}</span>}
                          {!tracking && t.estimateHours && <span className="row" style={{ gap: 4 }}><Clock />{t.estimateHours}h</span>}
                        </span>
                        <span className="row" style={{ gap: 6 }}>
                          {tracking && <TimerButton projectId={t.projectId} taskId={t.id} small />}
                          {assignee && <span title={assignee.name}><Avatar person={assignee} /></span>}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {list.length === 0 && <div className="soft" style={{ fontSize: 12.5, padding: '6px 4px' }}>Drop tasks here</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function TaskEditor({ task, projectId, defaultStatus, defaultDue, onClose }) {
  const { data, patch } = useData();
  const { toast, confirm } = useUi();
  const [f, setF] = useState(() => ({
    title: task ? task.title : '',
    notes: task ? task.notes : '',
    status: task ? task.status : defaultStatus || 'To do',
    assignee: task ? task.assignee : '',
    dueDate: task ? task.dueDate : defaultDue || '',
    estimateHours: task ? task.estimateHours : ''
  }));
  const [busy, setBusy] = useState(false);
  const [logging, setLogging] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const entries = task ? (data.timeEntries || []).filter((e) => e.taskId === task.id) : [];
  const project = (data.projects || []).find((p) => p.id === (task ? task.projectId : projectId));
  const tracking = projectTracking(data.clients, project);
  // Anyone on the team, plus guests who are in this project.
  const pid = task ? task.projectId : projectId;
  const assignable = (data.team || []).concat((data.guests || []).filter((g) => (data.projectMembers || []).some((m) => m.projectId === pid && m.email === g.email)));
  const now = useNow(entries.some((e) => e.startedAt), 30000);
  const logged = entries.reduce((n, e) => n + entryMinutes(e, now), 0);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await rpc('saveTask', { id: task ? task.id : '', projectId: task ? task.projectId : projectId, ...f });
      patch((d) => ({ ...d, tasks: upsert(d.tasks || [], r.task) }));
      toast(task ? 'Task saved' : 'Task added', 'success');
      onClose();
    } catch (e2) { toast(e2.message, 'error'); setBusy(false); }
  };
  const del = async () => {
    if (!(await confirm({ title: 'Delete this task?', message: 'Hours logged on it stay on the project.', confirmLabel: 'Delete task', danger: true }))) return;
    try {
      await rpc('deleteTask', { id: task.id });
      patch((d) => ({ ...d, tasks: remove(d.tasks || [], task.id), timeEntries: (d.timeEntries || []).map((x) => (x.taskId === task.id ? { ...x, taskId: '' } : x)) }));
      onClose();
    } catch (e2) { toast(e2.message, 'error'); }
  };

  if (logging) return <TimeEntryModal entry={logging.entry} defaults={{ projectId: task.projectId, taskId: task.id }} onClose={() => setLogging(null)} />;

  return (
    <Modal size="lg" title={task ? 'Task' : 'New task'} onClose={onClose}
      footer={<>
        {task ? <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={del}><Trash2 />Delete</button> : <span />}
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="task-form" className="btn btn-primary" disabled={busy || !f.title.trim()}>{task ? 'Save' : 'Add task'}</button></div>
      </>}>
      <form id="task-form" className="modal-body stack" onSubmit={save}>
        <Field label="Title" htmlFor="tk-title"><input id="tk-title" className="input" value={f.title} onChange={set('title')} maxLength={200} required autoFocus={!task} placeholder="e.g. Design the homepage" /></Field>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label="Status" htmlFor="tk-status"><select id="tk-status" className="select" value={f.status} onChange={set('status')}>{TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Assigned to" htmlFor="tk-who">
            <select id="tk-who" className="select" value={f.assignee} onChange={set('assignee')}>
              <option value="">Nobody</option>
              {assignable.map((t) => <option key={t.email} value={t.email}>{t.name}{t.role === 'Guest' ? ' (guest)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Due date" htmlFor="tk-due"><input id="tk-due" type="date" className="input" value={f.dueDate} onChange={set('dueDate')} /></Field>
          <Field label="Estimate (hours)" htmlFor="tk-est"><input id="tk-est" className="input num" inputMode="decimal" value={f.estimateHours} onChange={set('estimateHours')} placeholder="Optional" /></Field>
        </div>
        <Field label="Notes" htmlFor="tk-notes"><textarea id="tk-notes" className="input textarea" value={f.notes} onChange={set('notes')} maxLength={8000} placeholder="Details, links, checklist…" /></Field>
        {task && tracking && (
          <section className="task-time">
            <div className="row-between">
              <span className="row" style={{ gap: 6, fontWeight: 600, fontSize: 13.5 }}><Clock size={15} />Time on this task: <span className="num">{fmtMinutes(logged)}</span>{f.estimateHours ? <span className="soft" style={{ fontWeight: 400 }}>of {f.estimateHours}h</span> : null}</span>
              <span className="row" style={{ gap: 6 }}>
                <TimerButton projectId={task.projectId} taskId={task.id} small />
                <button type="button" className="btn btn-sm" onClick={() => setLogging({ entry: null })}><Plus />Log time</button>
              </span>
            </div>
            {entries.length > 0 && (
              <div className="mini-list" style={{ marginTop: 8 }}>
                {entries.slice().sort((a, b) => b.date.localeCompare(a.date)).map((e) => (
                  <button key={e.id} type="button" className="mini-item" onClick={() => setLogging({ entry: e })}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t" style={{ display: 'block' }}>{personName(data.team, e.userEmail)} · {relDay(e.date, data.today)}</span>
                      {e.note && <span className="s ellipsis" style={{ display: 'block' }}>{e.note}</span>}
                    </span>
                    <span className="num" style={{ fontWeight: 600 }}>{e.startedAt ? 'Running' : fmtMinutes(e.minutes)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {task && <p className="soft" style={{ margin: 0, fontSize: 12.5 }}>Added by {task.createdBy || 'someone'}{task.completedAt ? ' · finished ' + shortDate(task.completedAt.slice(0, 10)) : ''}</p>}
      </form>
    </Modal>
  );
}
