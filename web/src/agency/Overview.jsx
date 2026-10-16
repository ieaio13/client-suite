import { useMemo, useState } from 'react';
import { CalendarClock, CircleAlert, Clock, Inbox, Receipt } from 'lucide-react';
import { useData } from '../data.jsx';
import { go } from '../lib/route.js';
import { Dot, Empty, StatusPill } from '../components/ui.jsx';
import { addDays, invoiceTotals, isOverdue, money, postCover, relDay, shortDate, sumByCurrency } from '../lib/util.js';
import SummaryPanel from '../views/SummaryPanel.jsx';
import PostEditor from '../post/PostEditor.jsx';
import { usePanel } from './usePanel.js';

export default function Overview() {
  const { data } = useData();
  const [panel, setPanel] = usePanel();
  const [editor, setEditor] = useState(null);
  const today = data.today;
  const active = useMemo(() => new Set(data.clients.filter((c) => !c.archived).map((c) => c.id)), [data.clients]);
  const byId = useMemo(() => Object.fromEntries(data.clients.map((c) => [c.id, c])), [data.clients]);
  const posts = data.posts.filter((p) => active.has(p.clientId));
  const review = posts.filter((p) => p.status === 'In Review');
  const week = posts.filter((p) => p.date >= today && p.date <= addDays(today, 7) && p.status !== 'Published').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const unpaid = data.invoices.filter((i) => active.has(i.clientId) && i.status !== 'Paid');
  const overdue = unpaid.filter((i) => isOverdue(i, today));

  const row = (p) => {
    const cover = postCover(p);
    const c = byId[p.clientId];
    return (
      <button key={p.id} type="button" className="mini-item" onClick={() => setEditor(p)}>
        {cover && cover.asset.thumbUrl ? <img className="thumb" src={cover.asset.thumbUrl} alt="" /> : <span className="thumb" />}
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t ellipsis" style={{ display: 'block' }}>{p.text || 'No copy yet'}</span>
          <span className="s row" style={{ gap: 6 }}><Dot color={c && c.color} size={7} />{c ? c.name : ''} · {relDay(p.date, today)}</span>
        </span>
        <StatusPill status={p.status} />
      </button>
    );
  };

  return (
    <>
      <main className="main"><div className="main-inner rise">
        <div className="page-head">
          <div><div className="crumbs">Workspace</div><h1 className="page-title">Overview</h1></div>
          {!panel && <button type="button" className="btn" onClick={() => setPanel(true)}>Show summary</button>}
        </div>
        <div className="grid grid-4" style={{ marginBottom: 20 }}>
          <div className="card stat"><div className="k"><Inbox />Waiting on clients</div><div className="v" style={{ color: 'var(--st-review)' }}>{review.length}</div></div>
          <div className="card stat"><div className="k"><CalendarClock />Next 7 days</div><div className="v">{week.length}</div></div>
          {data.isBilling && <div className="card stat"><div className="k"><Receipt />Outstanding</div><div className="v" style={{ fontSize: 20 }}>{sumByCurrency(unpaid, (i) => invoiceTotals(i).total, data.invoices.length ? data.invoices[0].currency : undefined)}</div></div>}
          {data.isBilling && <div className="card stat"><div className="k"><CircleAlert />Overdue invoices</div><div className="v" style={{ color: overdue.length ? 'var(--danger)' : 'var(--success)' }}>{overdue.length}</div></div>}
        </div>
        <div className="grid grid-2">
          <section className="card">
            <div className="card-head"><h3>Waiting on client review</h3><span className="badge warn">{review.length}</span></div>
            <div style={{ padding: 8 }}>{review.length ? <div className="mini-list">{review.map(row)}</div> : <Empty icon={Inbox} title="All caught up">Nothing is waiting on clients.</Empty>}</div>
          </section>
          <section className="card">
            <div className="card-head"><h3>Coming up this week</h3><span className="badge">{week.length}</span></div>
            <div style={{ padding: 8 }}>{week.length ? <div className="mini-list">{week.map(row)}</div> : <Empty icon={Clock} title="A quiet week">Nothing scheduled in the next 7 days.</Empty>}</div>
          </section>
        </div>
        {data.isBilling && overdue.length > 0 && (
          <section className="card" style={{ marginTop: 16 }}>
            <div className="card-head"><h3>Overdue invoices</h3><span className="badge warn">{overdue.length}</span></div>
            <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="table"><tbody>
                {overdue.map((i) => (
                  <tr key={i.id} className="click" onClick={() => go('client', (byId[i.clientId] && byId[i.clientId].parentId) || i.clientId)}>
                    <td style={{ fontWeight: 600 }}>{i.number}</td>
                    <td><span className="row" style={{ gap: 6 }}><Dot color={byId[i.clientId] && byId[i.clientId].color} size={8} />{byId[i.clientId] ? byId[i.clientId].name : ''}</span></td>
                    <td className="num" style={{ color: 'var(--danger)' }}>Due {shortDate(i.dueDate)}</td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{money(invoiceTotals(i).total, i.currency)}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          </section>
        )}
      </div></main>
      {panel && <SummaryPanel title="All clients" posts={posts} today={today} onOpen={setEditor} onClose={() => setPanel(false)} />}
      {editor && <PostEditor post={editor} onClose={() => setEditor(null)} />}
    </>
  );
}
