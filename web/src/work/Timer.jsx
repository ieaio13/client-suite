import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Square, Trash2 } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData, upsert, remove } from '../data.jsx';
import { go } from '../lib/route.js';
import { Field, Modal, useUi } from '../components/ui.jsx';
import { sortClients } from '../lib/util.js';
import { clock, durationText, elapsedSeconds, parseDuration } from './workUtil.js';

export function useNow(active, ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

// The signed-in person's running timer, plus start/stop actions.
export function useTimer() {
  const { data, patch } = useData();
  const { toast } = useUi();
  const running = (data.timeEntries || []).find((e) => e.startedAt && e.userEmail === data.user.email) || null;
  const start = async (projectId, taskId) => {
    try {
      const r = await rpc('startTimer', { projectId, taskId: taskId || '' });
      patch((d) => {
        let list = d.timeEntries || [];
        if (r.stopped) list = upsert(list, r.stopped);
        return { ...d, timeEntries: upsert(list, r.entry) };
      });
      toast(r.stopped ? 'Previous timer stopped, new one started' : 'Timer started', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const stop = async () => {
    try {
      const r = await rpc('stopTimer', {});
      if (r.entry) patch((d) => ({ ...d, timeEntries: upsert(d.timeEntries || [], r.entry) }));
      toast('Timer stopped', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  return { running, start, stop };
}

// Play/stop button for a project or task.
export function TimerButton({ projectId, taskId, small }) {
  const { running, start, stop } = useTimer();
  const mine = Boolean(running) && running.projectId === projectId && (!taskId || running.taskId === taskId);
  const now = useNow(Boolean(mine));
  if (mine) {
    return (
      <button type="button" className={'btn timer-on' + (small ? ' btn-sm' : '')} onClick={(e) => { e.stopPropagation(); stop(); }} title="Stop timer">
        <Square />{clock(elapsedSeconds(running.startedAt, now))}
      </button>
    );
  }
  return (
    <button type="button" className={'btn' + (small ? ' btn-sm btn-icon' : '')} onClick={(e) => { e.stopPropagation(); start(projectId, taskId); }}
      title="Start timer" aria-label="Start timer">
      <Play />{!small && 'Start timer'}
    </button>
  );
}

// Shown in the top bar while your timer runs, on every page.
export function TimerBadge() {
  const { data } = useData();
  const { running, stop } = useTimer();
  const now = useNow(Boolean(running));
  if (!running) return null;
  const project = (data.projects || []).find((p) => p.id === running.projectId);
  const task = running.taskId ? (data.tasks || []).find((t) => t.id === running.taskId) : null;
  return (
    <div className="timer-badge">
      <span className="pulse" aria-hidden="true" />
      <button type="button" className="timer-label" onClick={() => project && go('project', project.id)} title="Open project">
        <b className="num">{clock(elapsedSeconds(running.startedAt, now))}</b>
        <span className="ellipsis hide-mobile">{task ? task.title : project ? project.name : 'Timer'}</span>
      </button>
      <button type="button" className="btn btn-sm btn-icon" onClick={stop} title="Stop timer" aria-label="Stop timer"><Pause /></button>
    </div>
  );
}

export function ProjectSelect({ value, onChange, id, required }) {
  const { data } = useData();
  const byId = Object.fromEntries(data.clients.map((c) => [c.id, c]));
  const groups = {};
  for (const p of data.projects || []) {
    if (p.status === 'Done' && p.id !== value) continue;
    const c = byId[p.clientId];
    if (!(c && c.timeTracking) && p.id !== value) continue; // only clients with time tracking on
    const root = c && c.parentId ? byId[c.parentId] : c;
    const key = root ? root.id : '';
    (groups[key] = groups[key] || []).push(p);
  }
  const roots = sortClients(data.clients.filter((c) => !c.parentId && groups[c.id]));
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">Choose a project…</option>
      {roots.map((r) => (
        <optgroup key={r.id} label={r.name}>
          {groups[r.id].map((p) => <option key={p.id} value={p.id}>{p.name}{byId[p.clientId] && byId[p.clientId].parentId ? ' (' + byId[p.clientId].name + ')' : ''}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

// Add or edit hours by hand.
export function TimeEntryModal({ entry, defaults, onClose }) {
  const { data, patch } = useData();
  const { toast, confirm } = useUi();
  const [f, setF] = useState(() => ({
    projectId: entry ? entry.projectId : (defaults && defaults.projectId) || '',
    taskId: entry ? entry.taskId : (defaults && defaults.taskId) || '',
    date: entry ? entry.date : (defaults && defaults.date) || data.today,
    duration: entry ? durationText(entry.minutes) : '',
    note: entry ? entry.note : '',
    billable: entry ? entry.billable : true
  }));
  const [busy, setBusy] = useState(false);
  const tasks = useMemo(() => (data.tasks || []).filter((t) => t.projectId === f.projectId), [data.tasks, f.projectId]);
  const running = entry && entry.startedAt;
  const locked = entry && entry.invoiceId;
  const minutes = parseDuration(f.duration);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    if (!running && !minutes) { toast('Enter how long you worked, e.g. 1:30 or 1.5', 'error'); return; }
    setBusy(true);
    try {
      const r = await rpc('saveTimeEntry', { id: entry ? entry.id : '', projectId: f.projectId, taskId: f.taskId, date: f.date, minutes, note: f.note, billable: f.billable });
      patch((d) => ({ ...d, timeEntries: upsert(d.timeEntries || [], r.entry) }));
      toast(entry ? 'Hours updated' : 'Hours logged', 'success');
      onClose();
    } catch (e2) { toast(e2.message, 'error'); setBusy(false); }
  };
  const del = async () => {
    if (!(await confirm({ title: 'Delete these hours?', message: 'This time entry will be removed.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await rpc('deleteTimeEntry', { id: entry.id });
      patch((d) => ({ ...d, timeEntries: remove(d.timeEntries || [], entry.id) }));
      onClose();
    } catch (e2) { toast(e2.message, 'error'); }
  };

  return (
    <Modal title={entry ? 'Edit hours' : 'Log time'} onClose={onClose}
      footer={<>
        {entry && !locked ? <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={del}><Trash2 />Delete</button> : <span />}
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="time-form" className="btn btn-primary" disabled={busy || locked || !f.projectId}>{entry ? 'Save' : 'Log time'}</button></div>
      </>}>
      <form id="time-form" className="modal-body stack" onSubmit={save}>
        {locked && <div className="notice warn">These hours are on an invoice, so they can't be changed. Delete that invoice first to edit them.</div>}
        <Field label="Project" htmlFor="te-project"><ProjectSelect id="te-project" value={f.projectId} onChange={(v) => setF({ ...f, projectId: v, taskId: '' })} required /></Field>
        <Field label="Task (optional)" htmlFor="te-task">
          <select id="te-task" className="select" value={f.taskId} onChange={set('taskId')} disabled={!f.projectId}>
            <option value="">No specific task</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </Field>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label="Date" htmlFor="te-date"><input id="te-date" type="date" className="input" value={f.date} onChange={set('date')} required /></Field>
          <Field label="Time worked" htmlFor="te-dur" hint={running ? 'Timer is running' : minutes ? '= ' + Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm' : 'e.g. 1:30, 1.5 or 90m'}>
            <input id="te-dur" className="input num" value={running ? '' : f.duration} onChange={set('duration')} placeholder="1:30" disabled={running} autoFocus={!entry} />
          </Field>
        </div>
        <Field label="What did you work on?" htmlFor="te-note"><input id="te-note" className="input" value={f.note} onChange={set('note')} maxLength={500} placeholder="Optional note" /></Field>
        <label className="checkbox"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} />Billable to the client</label>
      </form>
    </Modal>
  );
}
