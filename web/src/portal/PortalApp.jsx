import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CircleCheck, Clock, Columns3, Download, FileText, Inbox, LayoutDashboard, Layers, MessageSquare, Plus, Receipt } from 'lucide-react';
import { useData } from '../data.jsx';
import { go, useRoute } from '../lib/route.js';
import { Dot, Empty, StatusPill } from '../components/ui.jsx';
import { LiveBadge, TopBar } from '../components/Shell.jsx';
import { addDays, cx, filterPosts, invoiceTotals, money, postCover, relDay, shortDate, stamp, sumByCurrency } from '../lib/util.js';
import { EMPTY_FILTERS, Toolbar } from '../views/Toolbar.jsx';
import Calendar from '../views/Calendar.jsx';
import Board from '../views/Board.jsx';
import SummaryPanel from '../views/SummaryPanel.jsx';
import PostEditor from '../post/PostEditor.jsx';
import { InvoiceStatus, InvoiceView } from '../invoices/Invoices.jsx';
import { usePanel } from '../agency/usePanel.js';

const PAGES = ['dashboard', 'calendar', 'board', 'invoices'];

export default function PortalApp() {
  const { data, liveMode } = useData();
  const route = useRoute();
  const page = PAGES.includes(route.page) ? route.page : 'dashboard';
  const brands = data.clients;
  const brand = brands.find((b) => b.id === route.id) || (brands.length === 1 ? brands[0] : null);
  const [drawer, setDrawer] = useState(false);
  const [editor, setEditor] = useState(null);
  useEffect(() => { setDrawer(false); }, [page, route.id]);
  const canEdit = data.rootClient.access === 'edit';
  const today = data.today;
  const brandPosts = useMemo(() => (brand ? data.posts.filter((p) => p.clientId === brand.id) : data.posts), [data.posts, brand]);
  const reviewCount = (id) => data.posts.filter((p) => p.status === 'In Review' && (!id || p.clientId === id)).length;

  const goPage = (p, id) => go(p, id !== undefined ? id : (brand ? brand.id : ''));
  const newPost = (date) => setEditor({ newFor: { clientId: (brand || brands[0]).id, date: date || today } });

  return (
    <div className="app">
      <TopBar name={data.agencyName} onMenu={() => setDrawer(!drawer)}
        nav={<span className="row hide-mobile" style={{ marginLeft: 12, color: 'var(--muted)', fontSize: 14 }}>Client portal · <b style={{ color: 'var(--text)', fontWeight: 600 }}>{data.rootClient.name}</b></span>}
        right={<LiveBadge mode={liveMode} />} />
      <div className="shell">
        <aside className={cx('sidebar', drawer && 'open')} aria-label="Portal navigation">
          <div className="sidebar-scroll">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { id: 'calendar', label: 'Calendar', icon: CalendarDays },
              { id: 'board', label: 'Board', icon: Columns3 },
              { id: 'invoices', label: 'Invoices', icon: Receipt, count: data.invoices.filter((i) => i.status !== 'Paid').length }
            ].map((n) => (
              <button key={n.id} type="button" className={cx('navitem', page === n.id && 'on')} onClick={() => goPage(n.id)}>
                <n.icon /><span className="grow">{n.label}</span>{n.count > 0 && <span className="badge">{n.count}</span>}
              </button>
            ))}
            {brands.length > 1 && (
              <>
                <div className="side-head" style={{ marginTop: 16 }}><span>Brands</span></div>
                <button type="button" className={cx('navitem', !brand && 'on')} onClick={() => go(page === 'invoices' ? 'calendar' : page)}>
                  <Layers /><span className="grow">All brands</span>{reviewCount() > 0 && <span className="badge warn">{reviewCount()}</span>}
                </button>
                {brands.map((b) => (
                  <button key={b.id} type="button" className={cx('navitem', brand && brand.id === b.id && 'on')} onClick={() => go(page === 'invoices' || page === 'dashboard' ? 'calendar' : page, b.id)}>
                    <Dot color={b.color} /><span className="grow">{b.name}</span>{reviewCount(b.id) > 0 && <span className="badge warn">{reviewCount(b.id)}</span>}
                  </button>
                ))}
              </>
            )}
          </div>
          {canEdit && <div className="side-foot"><button type="button" className="btn btn-primary btn-block" onClick={() => newPost()}><Plus />New post</button></div>}
        </aside>
        {drawer && <div className="drawer-overlay only-mobile" onClick={() => setDrawer(false)} />}
        {page === 'dashboard' && <Dashboard onOpen={(p) => setEditor({ post: p })} />}
        {(page === 'calendar' || page === 'board') && (
          <PortalPosts page={page} brand={brand} posts={brandPosts} canEdit={canEdit} onOpen={(p) => setEditor({ post: p })} onNew={newPost}
            onView={(v) => goPage(v)} />
        )}
        {page === 'invoices' && <PortalInvoices />}
      </div>
      {editor && <PostEditor post={editor.post} newFor={editor.newFor} onClose={() => setEditor(null)} />}
    </div>
  );
}

function PortalPosts({ page, brand, posts, canEdit, onOpen, onNew, onView }) {
  const { data } = useData();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [panel, setPanel] = usePanel();
  const visible = useMemo(() => filterPosts(posts, filters, { portal: true }), [posts, filters]);
  const clientsById = useMemo(() => Object.fromEntries(data.clients.map((c) => [c.id, c])), [data.clients]);
  const tagNames = useMemo(() => [...new Set(posts.flatMap((p) => p.tags))].sort(), [posts]);
  const columns = brand ? (data.boardColumns || []).filter((c) => c.clientId === brand.id) : [];
  const shared = { clientsById, showBrand: !brand && data.clients.length > 1, today: data.today, onOpen };
  return (
    <>
      <main className="main"><div className="main-inner rise" key={(brand ? brand.id : 'all') + page}>
        <div className="page-head">
          <div><div className="crumbs">{data.rootClient.name}</div><h1 className="page-title">{brand && <Dot color={brand.color} size={12} />}{brand ? brand.name : 'All brands'}</h1></div>
          {canEdit && <div className="page-actions"><button type="button" className="btn btn-primary" onClick={() => onNew()}><Plus />New post</button></div>}
        </div>
        <Toolbar view={page} onView={onView} filters={filters} onFilters={setFilters} tags={tagNames} table={false} panelOpen={panel} onTogglePanel={() => setPanel(true)} />
        {page === 'calendar'
          ? <Calendar {...shared} posts={visible} canAdd={canEdit} canMove={false} onNew={onNew} />
          : <Board {...shared} posts={visible} columns={columns} tags={data.tags} comments={data.comments} canMove={false} canManage={false} />}
      </div></main>
      {panel && <SummaryPanel title={brand ? brand.name : 'All brands'} posts={visible} today={data.today} onOpen={onOpen} onClose={() => setPanel(false)} />}
    </>
  );
}

function Dashboard({ onOpen }) {
  const { data } = useData();
  const today = data.today;
  const byId = Object.fromEntries(data.clients.map((c) => [c.id, c]));
  const posts = data.posts;
  const review = posts.filter((p) => p.status === 'In Review');
  const week = posts.filter((p) => p.date >= today && p.date <= addDays(today, 7) && p.status !== 'Published').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const monthStart = today.slice(0, 8) + '01';
  const publishedMonth = posts.filter((p) => p.status === 'Published' && p.date >= monthStart && p.date <= today);
  const unpaid = data.invoices.filter((i) => i.status !== 'Paid');
  const postsById = Object.fromEntries(posts.map((p) => [p.id, p]));
  const recent = data.comments.slice(-6).reverse();

  const row = (p, right) => {
    const cover = postCover(p);
    const c = byId[p.clientId];
    return (
      <button key={p.id} type="button" className="mini-item" onClick={() => onOpen(p)}>
        {cover && cover.asset.thumbUrl ? <img className="thumb" src={cover.asset.thumbUrl} alt="" /> : <span className="thumb" />}
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t ellipsis" style={{ display: 'block' }}>{p.text || 'No copy yet'}</span>
          <span className="s row" style={{ gap: 6 }}>{data.clients.length > 1 && <><Dot color={c && c.color} size={7} />{c ? c.name : ''} · </>}{relDay(p.date, today)}</span>
        </span>
        {right}
      </button>
    );
  };

  return (
    <main className="main"><div className="main-inner rise">
      <div className="page-head"><div><div className="crumbs">Welcome back</div><h1 className="page-title">{data.rootClient.name}</h1></div></div>
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="k"><Inbox />Waiting for you</div><div className="v" style={{ color: review.length ? 'var(--st-review)' : undefined }}>{review.length}</div></div>
        <div className="card stat"><div className="k"><Clock />Coming up this week</div><div className="v">{week.length}</div></div>
        <div className="card stat"><div className="k"><CircleCheck />Published this month</div><div className="v" style={{ color: 'var(--success)' }}>{publishedMonth.length}</div></div>
        <div className="card stat"><div className="k"><Receipt />Outstanding invoices</div><div className="v" style={{ fontSize: 20 }}>{unpaid.length ? sumByCurrency(unpaid, (i) => invoiceTotals(i).total) : 'None'}</div></div>
      </div>
      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h3>Needs your approval</h3><span className="badge warn">{review.length}</span></div>
          <div style={{ padding: 8 }}>{review.length ? <div className="mini-list">{review.map((p) => row(p, <span className="btn btn-sm">Review</span>))}</div>
            : <Empty icon={CircleCheck} title="You're all caught up">Nothing is waiting for your approval.</Empty>}</div>
        </section>
        <section className="card">
          <div className="card-head"><h3>Coming up this week</h3><span className="badge">{week.length}</span></div>
          <div style={{ padding: 8 }}>{week.length ? <div className="mini-list">{week.map((p) => row(p, <StatusPill status={p.status} />))}</div>
            : <Empty icon={CalendarDays} title="Nothing this week">New posts will appear here.</Empty>}</div>
        </section>
        <section className="card">
          <div className="card-head"><h3>Recent comments</h3></div>
          <div style={{ padding: 8 }}>{recent.length ? <div className="mini-list">{recent.map((c) => {
            const p = postsById[c.postId];
            return (
              <button key={c.id} type="button" className="mini-item" onClick={() => p && onOpen(p)}>
                <span className="avatar"><MessageSquare size={14} /></span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t ellipsis" style={{ display: 'block' }}>{c.text || 'Shared an image'}</span>
                  <span className="s">{c.author} · {stamp(c.createdAt)}</span>
                </span>
              </button>
            );
          })}</div> : <Empty icon={MessageSquare} title="No comments yet" />}</div>
        </section>
        <section className="card">
          <div className="card-head"><h3>Invoices</h3><button type="button" className="btn btn-ghost btn-sm" onClick={() => go('invoices')}>View all</button></div>
          <div style={{ padding: 8 }}>{data.invoices.length ? <div className="mini-list">{data.invoices.slice(0, 5).map((i) => (
            <button key={i.id} type="button" className="mini-item" onClick={() => go('invoices')}>
              <span className="avatar"><FileText size={14} /></span>
              <span className="grow"><span className="t" style={{ display: 'block' }}>{i.number}</span><span className="s">Due {shortDate(i.dueDate)}</span></span>
              <span className="row" style={{ gap: 8 }}><b className="num" style={{ fontSize: 13 }}>{money(invoiceTotals(i).total, i.currency)}</b><InvoiceStatus inv={i} today={today} /></span>
            </button>
          ))}</div> : <Empty icon={Receipt} title="No invoices yet" />}</div>
        </section>
      </div>
    </div></main>
  );
}

function PortalInvoices() {
  const { data } = useData();
  const [open, setOpen] = useState(null);
  const byId = Object.fromEntries(data.clients.map((c) => [c.id, c]).concat([[data.rootClient.id, data.rootClient]]));
  const list = data.invoices.slice().sort((a, b) => (b.issueDate + b.number).localeCompare(a.issueDate + a.number));
  const unpaid = list.filter((i) => i.status !== 'Paid');
  return (
    <main className="main"><div className="main-inner rise">
      <div className="page-head"><div><div className="crumbs">{data.rootClient.name}</div><h1 className="page-title">Invoices</h1></div></div>
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="k">Outstanding</div><div className="v" style={{ color: unpaid.length ? 'var(--warn)' : undefined }}>{unpaid.length ? sumByCurrency(unpaid, (i) => invoiceTotals(i).total) : 'Nothing due'}</div></div>
        <div className="card stat"><div className="k">Paid</div><div className="v" style={{ color: list.some((i) => i.status === 'Paid') ? 'var(--success)' : undefined }}>{list.some((i) => i.status === 'Paid') ? sumByCurrency(list.filter((i) => i.status === 'Paid'), (i) => invoiceTotals(i).total) : 'Nothing yet'}</div></div>
        <div className="card stat"><div className="k">Invoices</div><div className="v">{list.length}</div></div>
      </div>
      {list.length === 0 ? <div className="card"><Empty icon={Receipt} title="No invoices yet">Invoices from {data.agencyName} will appear here.</Empty></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Number</th><th>Issued</th><th>Due</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th><th aria-label="Actions" /></tr></thead>
            <tbody>{list.map((i) => (
              <tr key={i.id} className="click" onClick={() => setOpen(i)}>
                <td style={{ fontWeight: 600 }}>{i.number}</td>
                <td className="num">{shortDate(i.issueDate)}</td>
                <td className="num">{shortDate(i.dueDate)}</td>
                <td><InvoiceStatus inv={i} today={data.today} /></td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{money(invoiceTotals(i).total, i.currency)}</td>
                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  {i.pdfUrl && <a className="btn btn-sm" href={i.pdfUrl} target="_blank" rel="noopener noreferrer"><Download />PDF</a>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {open && <InvoiceView inv={open} agencyName={data.agencyName} billTo={(byId[open.clientId] || data.rootClient).name} onClose={() => setOpen(null)} />}
    </div></main>
  );
}
