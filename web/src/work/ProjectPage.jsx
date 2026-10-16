import { useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, CircleAlert, Clock, Pencil, Plus, Receipt, Trash2, User } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData, upsert, remove } from '../data.jsx';
import { go } from '../lib/route.js';
import { Avatar, Dot, Empty, Field, Modal, useUi } from '../components/ui.jsx';
import { cx, money, relDay, shortDate } from '../lib/util.js';
import { ProjectModal, ProjectStatus } from './Projects.jsx';
import { TimeEntryModal, TimerButton, useNow } from './Timer.jsx';
import { TASK_COLOR, TASK_STATUSES, clientLabel, entryMinutes, fmtMinutes, personName, projectStats, trackingOn } from './workUtil.js';

export default function ProjectPage({ project }) {
  const { data, patch } = useData();
  const { toast } = useUi();
  const [modal, setModal] = useState(null); // {type:'edit'|'task'|'time', ...}
  const byId = useMemo(() => Object.fromEntries(data.clients.map((c) => [c.id, c])), [data.clients]);
  const cl = clientLabel(byId, project.clientId);
  const tracking = trackingOn(byId, project.clientId);
  const tasks = (data.tasks || []).filter((t) => t.projectId === project.id);
  const entries = (data.timeEntries || []).filter((e) => e.projectId === project.id);
  const s = projectStats(project, data.tasks || [], data.timeEntries || [], data.today);
  const anyRunning = entries.some((e) => e.startedAt);
  const now = useNow(anyRunning, 30000);
  const client = byId[project.clientId];
  const currency = client ? (client.currency || (client.parentId && byId[client.parentId] && byId[client.parentId].currency) || data.settings.defaultCurrency) : data.settings.defaultCurrency;

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

  const byPerson = {};
  for (const e of entries) byPerson[e.userEmail] = (byPerson[e.userEmail] || 0) + entryMinutes(e, now);

  return (
    <main className="main"><div className="main-inner rise" key={project.id}>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="crumbs">
            <button type="button" onClick={() => go('projects')}>Projects</button><ChevronRight size={14} />
            <button type="button" onClick={() => go('client', project.clientId)} className="row" style={{ gap: 6 }}><Dot color={cl.color} size={7} />{cl.name}</button>
          </div>
          <h1 className="page-title">{project.name}<ProjectStatus status={project.status} /></h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-icon" onClick={() => setModal({ type: 'edit' })} title="Edit project" aria-label="Edit project"><Pencil /></button>
          <button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'task', task: null, status: 'To do' })}><Plus />New task</button>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="k">Progress</div><div className="v num">{s.pct}%</div><div className="bar" style={{ marginTop: 10 }}><span style={{ width: s.pct + '%', background: 'var(--st-published)' }} /></div></div>
        {tracking
          ? <div className="card stat"><div className="k"><Clock />Hours logged</div><div className="v num">{fmtMinutes(s.minutes)}</div>{s.estimateHours > 0 && <div className="soft" style={{ fontSize: 12.5, marginTop: 2 }}>of {s.estimateHours}h estimated</div>}</div>
          : <div className="card stat"><div className="k">Tasks</div><div className="v num">{s.done} / {s.total}</div><div className="soft" style={{ fontSize: 12.5, marginTop: 2 }}>done</div></div>}
        <div className="card stat"><div className="k"><CalendarDays />Due</div><div className={cx('v', s.overdue && 'danger-text')} style={{ fontSize: 20 }}>{project.dueDate ? shortDate(project.dueDate) : 'No date'}</div>{s.overdueTasks > 0 && <div className="danger-text" style={{ fontSize: 12.5, marginTop: 2 }}>{s.overdueTasks} task{s.overdueTasks === 1 ? '' : 's'} late</div>}</div>
        {data.isBilling
          ? <div className="card stat"><div className="k"><Receipt />Budget</div><div className="v" style={{ fontSize: 20 }}>{project.budget ? money(project.budget, currency) : 'Not set'}</div>{tracking && <div className="soft" style={{ fontSize: 12.5, marginTop: 2 }}>{fmtMinutes(s.unbilled)} not invoiced yet</div>}</div>
          : <div className="card stat"><div className="k"><User />Lead</div><div className="v" style={{ fontSize: 20 }}>{personName(data.team, project.owner) || 'Nobody yet'}</div></div>}
      </div>

      {project.description && <p className="muted project-desc">{project.description}</p>}

      <TaskBoard tasks={tasks} entries={entries} tracking={tracking} onOpen={(t) => setModal({ type: 'task', task: t })}
        onAdd={(status) => setModal({ type: 'task', task: null, status })} onMove={move} />

      {tracking && <section className="card" style={{ marginTop: 24 }}>
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
      </section>}

      {modal && modal.type === 'edit' && <ProjectModal project={project} onClose={() => setModal(null)} />}
      {modal && modal.type === 'task' && <TaskEditor task={modal.task} projectId={project.id} defaultStatus={modal.status} onClose={() => setModal(null)} />}
      {modal && modal.type === 'time' && <TimeEntryModal entry={modal.entry} defaults={{ projectId: project.id }} onClose={() => setModal(null)} />}
    </div></main>
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

export function TaskEditor({ task, projectId, defaultStatus, onClose }) {
  const { data, patch } = useData();
  const { toast, confirm } = useUi();
  const [f, setF] = useState(() => ({
    title: task ? task.title : '',
    notes: task ? task.notes : '',
    status: task ? task.status : defaultStatus || 'To do',
    assignee: task ? task.assignee : '',
    dueDate: task ? task.dueDate : '',
    estimateHours: task ? task.estimateHours : ''
  }));
  const [busy, setBusy] = useState(false);
  const [logging, setLogging] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const entries = task ? (data.timeEntries || []).filter((e) => e.taskId === task.id) : [];
  const project = (data.projects || []).find((p) => p.id === (task ? task.projectId : projectId));
  const tracking = Boolean(project) && Boolean((data.clients.find((c) => c.id === project.clientId) || {}).timeTracking);
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
              {data.team.map((t) => <option key={t.email} value={t.email}>{t.name}</option>)}
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
