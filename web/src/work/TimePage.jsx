import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Plus, Receipt } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData, upsert } from '../data.jsx';
import { go } from '../lib/route.js';
import { Empty, Field, Modal, useUi } from '../components/ui.jsx';
import { addDays, cx, money, prettyDate, shortDate, sortClients } from '../lib/util.js';
import { EntryTable } from './ProjectPage.jsx';
import { TimeEntryModal, useNow } from './Timer.jsx';
import { entryMinutes, fmtMinutes, hoursDecimal, weekDays, weekStart } from './workUtil.js';

export default function TimePage() {
  const { data } = useData();
  const [start, setStart] = useState(() => weekStart(data.today));
  const [person, setPerson] = useState(data.user.email);
  const [modal, setModal] = useState(null);
  const days = weekDays(start);
  const end = days[6];
  const all = data.timeEntries || [];
  const now = useNow(all.some((e) => e.startedAt), 30000);
  const mine = all.filter((e) => !person || e.userEmail === person);
  const week = mine.filter((e) => e.date >= start && e.date <= end);
  const total = week.reduce((n, e) => n + entryMinutes(e, now), 0);
  const billable = week.filter((e) => e.billable).reduce((n, e) => n + entryMinutes(e, now), 0);
  const unbilledAll = all.filter((e) => e.billable && !e.invoiceId && !e.startedAt).reduce((n, e) => n + e.minutes, 0);

  return (
    <main className="main"><div className="main-inner rise">
      <div className="page-head">
        <div><div className="crumbs">Workspace</div><h1 className="page-title">Time</h1></div>
        <div className="page-actions">
          <select className="select" style={{ width: 'auto' }} value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Whose hours">
            <option value="">Everyone</option>
            {data.team.map((t) => <option key={t.email} value={t.email}>{t.email === data.user.email ? 'My hours' : t.name}</option>)}
          </select>
          {data.isBilling && <button type="button" className="btn" onClick={() => setModal({ type: 'invoice' })}><Receipt />Invoice hours</button>}
          <button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'entry', date: data.today >= start && data.today <= end ? data.today : start })}><Plus />Log time</button>
        </div>
      </div>

      <div className="row-between" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="row">
          <button type="button" className="btn btn-icon" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week"><ChevronLeft /></button>
          <button type="button" className="btn" onClick={() => setStart(weekStart(data.today))} disabled={start === weekStart(data.today)}>This week</button>
          <button type="button" className="btn btn-icon" onClick={() => setStart(addDays(start, 7))} aria-label="Next week"><ChevronRight /></button>
          <span style={{ fontWeight: 600, marginLeft: 6 }}>{shortDate(start)} – {shortDate(end)}</span>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="k"><Clock />This week</div><div className="v num">{fmtMinutes(total)}</div></div>
        <div className="card stat"><div className="k">Billable this week</div><div className="v num">{fmtMinutes(billable)}</div></div>
        <div className="card stat"><div className="k"><Receipt />Not invoiced yet (everyone)</div><div className="v num">{fmtMinutes(unbilledAll)}</div></div>
      </div>

      <div className="week-strip">
        {days.map((d) => {
          const m = week.filter((e) => e.date === d).reduce((n, e) => n + entryMinutes(e, now), 0);
          return (
            <button key={d} type="button" className={cx('week-day', d === data.today && 'today')} onClick={() => setModal({ type: 'entry', date: d })} title={'Log time on ' + prettyDate(d)}>
              <span className="soft">{prettyDate(d).split(',')[0].split(' ')[0]}</span>
              <b className="num">{m ? fmtMinutes(m) : '–'}</b>
            </button>
          );
        })}
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Entries</h3><span className="badge">{week.length}</span></div>
        {week.length === 0 ? <Empty icon={Clock} title="No hours this week">Start a timer from a project or task, or log time here.</Empty> : (
          <EntryTable entries={week.slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))} now={now} showProject
            onOpen={(e) => setModal({ type: 'entry', entry: e })} />
        )}
      </section>

      {modal && modal.type === 'entry' && <TimeEntryModal entry={modal.entry} defaults={{ date: modal.date }} onClose={() => setModal(null)} />}
      {modal && modal.type === 'invoice' && <InvoiceHoursModal onClose={() => setModal(null)} />}
    </div></main>
  );
}

function firstOfMonth(day) { return day.slice(0, 8) + '01'; }

export function InvoiceHoursModal({ clientId, onClose }) {
  const { data, patch } = useData();
  const { toast } = useUi();
  const parents = sortClients(data.clients.filter((c) => !c.parentId && !c.archived));
  const [f, setF] = useState({ clientId: clientId || (parents[0] ? parents[0].id : ''), from: firstOfMonth(data.today), to: data.today, rate: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const byId = Object.fromEntries(data.clients.map((c) => [c.id, c]));
  const client = byId[f.clientId];
  const currency = (client && client.currency) || data.settings.defaultCurrency;

  // Same rules as the server: this client and its sub-clients, billable, not yet invoiced, in range.
  const preview = useMemo(() => {
    const family = new Set(data.clients.filter((c) => c.id === f.clientId || c.parentId === f.clientId).map((c) => c.id));
    const projects = (data.projects || []).filter((p) => family.has(p.clientId));
    const pids = new Set(projects.map((p) => p.id));
    const rows = (data.timeEntries || []).filter((e) => pids.has(e.projectId) && e.billable && !e.invoiceId && !e.startedAt && e.minutes > 0
      && (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to));
    const per = projects.map((p) => ({ p, minutes: rows.filter((e) => e.projectId === p.id).reduce((n, e) => n + e.minutes, 0) })).filter((x) => x.minutes > 0);
    return { per, minutes: rows.reduce((n, e) => n + e.minutes, 0) };
  }, [data.clients, data.projects, data.timeEntries, f.clientId, f.from, f.to]);
  const rate = Number(f.rate) || 0;

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await rpc('invoiceFromTime', { clientId: f.clientId, from: f.from, to: f.to, rate: f.rate });
      const billed = new Set(r.billedEntryIds);
      patch((d) => ({
        ...d,
        invoices: upsert(d.invoices || [], r.invoice),
        timeEntries: (d.timeEntries || []).map((x) => (billed.has(x.id) ? { ...x, invoiceId: r.invoice.id } : x))
      }));
      toast('Invoice ' + r.invoice.number + ' created as a draft. Review it, then Send.', 'success');
      onClose();
      go('client', r.clientId);
    } catch (e2) { toast(e2.message, 'error'); setBusy(false); }
  };

  return (
    <Modal size="lg" title="Invoice hours" onClose={onClose}
      footer={<><span className="muted" style={{ fontSize: 13 }}>{preview.minutes ? hoursDecimal(preview.minutes) + ' h' + (rate ? ' × ' + money(rate, currency) + ' = ' + money((preview.minutes / 60) * rate, currency) : '') : ''}</span>
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="ih-form" className="btn btn-primary" disabled={busy || !preview.minutes || !(rate > 0)}>Create draft invoice</button></div></>}>
      <form id="ih-form" className="modal-body stack" onSubmit={create}>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Adds every billable hour not invoiced yet, for the main client and all its sub-clients, as one line per project. The invoice is saved as a draft on the main client.</p>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label="Main client" htmlFor="ih-client">
            <select id="ih-client" className="select" value={f.clientId} onChange={set('clientId')}>{parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </Field>
          <Field label={'Hourly rate (' + currency + ')'} htmlFor="ih-rate"><input id="ih-rate" className="input num" inputMode="decimal" value={f.rate} onChange={set('rate')} required placeholder="e.g. 2000" autoFocus /></Field>
          <Field label="From" htmlFor="ih-from"><input id="ih-from" type="date" className="input" value={f.from} onChange={set('from')} /></Field>
          <Field label="To" htmlFor="ih-to"><input id="ih-to" type="date" className="input" value={f.to} onChange={set('to')} /></Field>
        </div>
        {preview.per.length === 0 ? <div className="notice">No unbilled hours for {client ? client.name : 'this client'} in this period.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Project</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>
                {preview.per.map(({ p, minutes }) => (
                  <tr key={p.id}><td>{p.name}{byId[p.clientId] && byId[p.clientId].parentId ? <span className="soft"> · {byId[p.clientId].name}</span> : null}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{hoursDecimal(minutes)}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{rate ? money((Math.round((minutes / 60) * 100) / 100) * rate, currency) : '–'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </form>
    </Modal>
  );
}
