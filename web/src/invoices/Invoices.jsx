import { useMemo, useState } from 'react';
import { CircleCheck, Download, Ellipsis, FileText, Pencil, Plus, Receipt, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData, upsert, remove } from '../data.jsx';
import { Dot, Empty, Field, MenuItem, Modal, Popover, useUi } from '../components/ui.jsx';
import { addDays, invoiceTotals, isOverdue, money, shortDate, sumByCurrency } from '../lib/util.js';

export function InvoiceStatus({ inv, today }) {
  const overdue = isOverdue(inv, today);
  const label = inv.status === 'Paid' ? 'Paid' : overdue ? 'Overdue' : inv.sentAt ? 'Sent' : 'Draft';
  const color = inv.status === 'Paid' ? 'var(--st-published)' : overdue ? 'var(--danger)' : inv.sentAt ? 'var(--st-review)' : 'var(--st-draft)';
  return <span className="pill" style={{ '--c': color }}>{label}</span>;
}

/* ---------- Read-only invoice (used in the portal and as a preview) ---------- */
export function InvoiceView({ inv, agencyName, billTo, onClose }) {
  const t = invoiceTotals(inv);
  return (
    <Modal size="lg" title={<><FileText size={18} />Invoice {inv.number}</>} onClose={onClose}
      footer={<><span className="muted" style={{ fontSize: 13 }}>Due {shortDate(inv.dueDate)}</span>
        <div className="row">
          {inv.pdfUrl && <a className="btn btn-primary" href={inv.pdfUrl} target="_blank" rel="noopener noreferrer"><Download />Download PDF</a>}
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div></>}>
      <div className="modal-body stack" style={{ gap: 18 }}>
        <div className="row-between wrap">
          <div><div className="label">From</div><div style={{ fontWeight: 600 }}>{agencyName}</div></div>
          <div><div className="label">Bill to</div><div style={{ fontWeight: 600 }}>{billTo}</div></div>
          <div><div className="label">Issued</div><div className="num">{shortDate(inv.issueDate)}</div></div>
          <div><div className="label">Due</div><div className="num">{shortDate(inv.dueDate)}</div></div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>{(inv.items || []).map((it, i) => (
              <tr key={i}><td>{it.description}</td><td className="num" style={{ textAlign: 'right' }}>{it.qty}</td>
                <td className="num" style={{ textAlign: 'right' }}>{money(it.rate, inv.currency)}</td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{money(Number(it.qty || 0) * Number(it.rate || 0), inv.currency)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div style={{ marginLeft: 'auto', width: 'min(320px, 100%)' }} className="stack">
          <div className="row-between"><span className="muted">Subtotal</span><span className="num">{money(t.subtotal, inv.currency)}</span></div>
          {t.discount > 0 && <div className="row-between"><span className="muted">Discount</span><span className="num">− {money(t.discount, inv.currency)}</span></div>}
          {t.tax > 0 && <div className="row-between"><span className="muted">Tax ({inv.taxPct}%)</span><span className="num">{money(t.tax, inv.currency)}</span></div>}
          <hr className="divider" />
          <div className="row-between" style={{ fontSize: 16, fontWeight: 600 }}><span>Total due</span><span className="num">{money(t.total, inv.currency)}</span></div>
        </div>
        {inv.notes && <div className="notice"><FileText /><span style={{ whiteSpace: 'pre-wrap' }}>{inv.notes}</span></div>}
      </div>
    </Modal>
  );
}

/* ---------- Agency: invoice list for a main client (includes older sub-client invoices) ---------- */
export function InvoiceList({ client }) {
  const { data, patch } = useData();
  const { toast, confirm } = useUi();
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState('');
  const today = data.today;
  const ids = useMemo(() => new Set([client.id].concat(data.clients.filter((c) => c.parentId === client.id).map((c) => c.id))), [client.id, data.clients]);
  const list = data.invoices.filter((i) => ids.has(i.clientId)).sort((a, b) => (b.issueDate + b.number).localeCompare(a.issueDate + a.number));
  const showFor = list.some((i) => i.clientId !== client.id);
  const byId = Object.fromEntries(data.clients.map((c) => [c.id, c]));
  const unpaid = list.filter((i) => i.status !== 'Paid');

  const run = async (inv, action, payload, message) => {
    setBusyId(inv.id);
    try {
      const r = await rpc(action, { invoiceId: inv.id, ...payload }, { long: true });
      patch((d) => ({ ...d, invoices: d.invoices.map((x) => (x.id === inv.id ? { ...x, ...(r.status ? { status: r.status } : {}), ...(r.pdfUrl ? { pdfUrl: r.pdfUrl, pdfFileId: r.pdfFileId } : {}), ...(r.sentAt ? { sentAt: r.sentAt } : {}) } : x)) }));
      toast(typeof message === 'function' ? message(r) : message, 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId('');
    }
  };
  const send = (inv) => run(inv, 'sendInvoice', {}, (r) => (r.emailed && r.inPortal ? 'Invoice emailed and shared in the client portal'
    : r.emailed ? 'Invoice emailed to the client' : r.inPortal ? 'Invoice shared in the client portal (no client email on file)' : 'Invoice marked as sent. Create a share link so the client can see it.'));
  const del = async (inv) => {
    if (!(await confirm({ title: 'Delete invoice ' + inv.number + '?', message: 'The invoice and its PDF will be removed permanently.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await rpc('deleteInvoice', { invoiceId: inv.id });
      patch((d) => ({ ...d, invoices: remove(d.invoices, inv.id) }));
      toast('Invoice deleted', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <section className="stack" style={{ gap: 14 }} id="invoices">
      <div className="row-between">
        <h2 className="section-title">Invoices</h2>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ clientId: client.id })}><Plus />New invoice</button>
      </div>
      <div className="grid grid-3">
        <div className="card stat"><div className="k">Invoiced</div><div className="v">{sumByCurrency(list, (i) => invoiceTotals(i).total)}</div></div>
        <div className="card stat"><div className="k">Received</div><div className="v" style={{ color: 'var(--success)' }}>{sumByCurrency(list.filter((i) => i.status === 'Paid'), (i) => invoiceTotals(i).total)}</div></div>
        <div className="card stat"><div className="k">Outstanding · {unpaid.filter((i) => isOverdue(i, today)).length} overdue</div><div className="v" style={{ color: 'var(--warn)' }}>{sumByCurrency(unpaid, (i) => invoiceTotals(i).total)}</div></div>
      </div>
      {list.length === 0 ? <div className="card"><Empty icon={Receipt} title="No invoices yet">Create one and send it straight to the client portal.</Empty></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Number</th>{showFor && <th>For</th>}<th>Issued</th><th>Due</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {list.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="link-btn" style={{ fontWeight: 600 }} onClick={() => setEditing(inv)} title={'Edit invoice ' + inv.number}>{inv.number}</button></td>
                  {showFor && <td style={{ whiteSpace: 'nowrap' }}><span className="row" style={{ gap: 6 }}><Dot color={byId[inv.clientId] && byId[inv.clientId].color} size={8} />{byId[inv.clientId] ? byId[inv.clientId].name : ''}</span></td>}
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{shortDate(inv.issueDate)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{shortDate(inv.dueDate)}</td>
                  <td><InvoiceStatus inv={inv} today={today} /></td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{money(invoiceTotals(inv).total, inv.currency)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(inv)}><Pencil />Edit</button>
                      <button type="button" className="btn btn-sm" disabled={busyId === inv.id} onClick={() => send(inv)}><Send />{inv.sentAt ? 'Resend' : 'Send'}</button>
                      <Popover trigger={({ toggle }) => <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={toggle} aria-label={'More actions for ' + inv.number}><Ellipsis /></button>}>
                        {({ close }) => (<>
                          <MenuItem icon={Pencil} onClick={() => { close(); setEditing(inv); }}>Edit</MenuItem>
                          {inv.status === 'Paid'
                            ? <MenuItem icon={RotateCcw} onClick={() => { close(); run(inv, 'setInvoiceStatus', { status: 'Pending' }, 'Marked as unpaid'); }}>Mark as unpaid</MenuItem>
                            : <MenuItem icon={CircleCheck} onClick={() => { close(); run(inv, 'setInvoiceStatus', { status: 'Paid' }, 'Marked as paid'); }}>Mark as paid</MenuItem>}
                          <MenuItem icon={FileText} onClick={() => { close(); run(inv, 'generateInvoicePdf', {}, 'PDF ready'); }}>Generate PDF</MenuItem>
                          {inv.pdfUrl && <MenuItem icon={Download} onClick={() => { close(); window.open(inv.pdfUrl, '_blank', 'noopener'); }}>Open PDF</MenuItem>}
                          <div className="menu-sep" />
                          <MenuItem icon={Trash2} danger onClick={() => { close(); del(inv); }}>Delete</MenuItem>
                        </>)}
                      </Popover>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <InvoiceEditor inv={editing} client={byId[editing.clientId] || client} onClose={() => setEditing(null)} />}
    </section>
  );
}

function InvoiceEditor({ inv, client, onClose }) {
  const { data, patch } = useData();
  const { toast } = useUi();
  const parent = client.parentId ? data.clients.find((c) => c.id === client.parentId) : null;
  const dueDays = parseInt(data.settings.dueDays || '14', 10) || 14;
  const [d, setD] = useState(() => inv.id ? JSON.parse(JSON.stringify(inv)) : {
    clientId: client.id, number: '', issueDate: data.today, dueDate: addDays(data.today, dueDays), status: 'Pending',
    currency: client.currency || (parent && parent.currency) || data.settings.defaultCurrency || 'USD',
    items: [{ description: '', qty: '1', rate: '' }], taxPct: '', discount: '', notes: ''
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setD({ ...d, [k]: v });
  const setItem = (i, k, v) => set('items', d.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const t = invoiceTotals(d);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await rpc('saveInvoice', d);
      patch((x) => ({ ...x, invoices: upsert(x.invoices, r.invoice) }));
      toast('Invoice saved', 'success');
      onClose();
    } catch (e2) {
      toast(e2.message, 'error');
      setSaving(false);
    }
  };
  return (
    <Modal size="lg" title={inv.id ? 'Edit invoice ' + inv.number : 'New invoice'} subtitle={<div className="meta-line">Billed to <b>{client.name}</b></div>} onClose={onClose}
      footer={<><div className="num" style={{ fontWeight: 600 }}>Total {money(t.total, d.currency)}</div>
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="inv-form" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save invoice'}</button></div></>}>
      <form id="inv-form" className="modal-body stack" style={{ gap: 16 }} onSubmit={save}>
        <div className="grid grid-4" style={{ gap: 12 }}>
          <Field label="Invoice number"><input className="input" placeholder="Automatic" value={d.number} onChange={(e) => set('number', e.target.value)} /></Field>
          <Field label="Currency"><input className="input" value={d.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
          <Field label="Issue date"><input className="input" type="date" value={d.issueDate} onChange={(e) => set('issueDate', e.target.value)} /></Field>
          <Field label="Due date"><input className="input" type="date" value={d.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="label">Line items</div>
          {d.items.map((it, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <input className="input grow" placeholder="Description" value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} aria-label="Description" />
              <input className="input num" style={{ width: 80 }} inputMode="decimal" placeholder="Qty" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} aria-label="Quantity" />
              <input className="input num" style={{ width: 120 }} inputMode="decimal" placeholder="Rate" value={it.rate} onChange={(e) => setItem(i, 'rate', e.target.value)} aria-label="Rate" />
              <button type="button" className="btn btn-ghost btn-icon" disabled={d.items.length < 2} onClick={() => set('items', d.items.filter((_, j) => j !== i))} aria-label="Remove line"><X /></button>
            </div>
          ))}
          <div><button type="button" className="btn btn-sm" onClick={() => set('items', d.items.concat([{ description: '', qty: '1', rate: '' }]))}><Plus />Add line</button></div>
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label="Discount (amount)"><input className="input num" inputMode="decimal" value={d.discount} onChange={(e) => set('discount', e.target.value)} /></Field>
          <Field label="Tax %"><input className="input num" inputMode="decimal" value={d.taxPct} onChange={(e) => set('taxPct', e.target.value)} /></Field>
        </div>
        <Field label="Notes"><textarea className="textarea" style={{ minHeight: 70 }} placeholder="Payment details or terms" value={d.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
