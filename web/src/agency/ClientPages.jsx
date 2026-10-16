import { useMemo, useState } from 'react';
import { ChevronRight, Pencil, Plus, Share2, Users } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData, upsert, remove } from '../data.jsx';
import { go } from '../lib/route.js';
import { Dot, Empty, useUi } from '../components/ui.jsx';
import { STATUSES, STATUS_VAR, filterPosts, sortClients } from '../lib/util.js';
import { EMPTY_FILTERS, Toolbar } from '../views/Toolbar.jsx';
import Calendar from '../views/Calendar.jsx';
import Board from '../views/Board.jsx';
import TableView from '../views/TableView.jsx';
import SummaryPanel from '../views/SummaryPanel.jsx';
import PostEditor from '../post/PostEditor.jsx';
import { InvoiceList } from '../invoices/Invoices.jsx';
import { ClientModal, ShareModal } from './ClientModals.jsx';
import { usePanel } from './usePanel.js';

/* ---------- Main (parent) client: brands + invoices ---------- */
export function ParentPage({ client, onAddSub }) {
  const { data } = useData();
  const [panel, setPanel] = usePanel();
  const [modal, setModal] = useState('');
  const [editor, setEditor] = useState(null);
  const subs = sortClients(data.clients.filter((c) => c.parentId === client.id && !c.archived));
  const subIds = new Set(subs.map((s) => s.id));
  const posts = data.posts.filter((p) => subIds.has(p.clientId));
  return (
    <>
      <main className="main"><div className="main-inner rise" key={client.id}>
        <div className="page-head">
          <div>
            <div className="crumbs">Main client</div>
            <h1 className="page-title"><Dot color={client.color} size={12} />{client.name}</h1>
          </div>
          {data.isBilling && (
            <div className="page-actions">
              <button type="button" className="btn" onClick={() => setModal('share')}><Share2 />Share</button>
              <button type="button" className="btn" onClick={() => setModal('edit')}><Pencil />Edit client</button>
              <button type="button" className="btn btn-primary" onClick={onAddSub}><Plus />Add sub-client</button>
            </div>
          )}
        </div>
        <div className="stack" style={{ gap: 28 }}>
          <section className="stack" style={{ gap: 14 }}>
            <div className="row-between"><h2 className="section-title">Brands</h2>{!panel && <button type="button" className="btn btn-sm" onClick={() => setPanel(true)}>Show summary</button>}</div>
            {subs.length === 0 ? <div className="card"><Empty icon={Users} title="No sub-clients yet">Add a sub-client (brand) to start planning content.</Empty></div> : (
              <div className="grid grid-3">
                {subs.map((s) => {
                  const list = data.posts.filter((p) => p.clientId === s.id);
                  return (
                    <button key={s.id} type="button" className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }} onClick={() => go('client', s.id)}>
                      <div className="row-between"><span className="row" style={{ fontWeight: 600 }}><Dot color={s.color} />{s.name}</span><ChevronRight size={16} className="soft" /></div>
                      <div className="bar">{STATUSES.map((st) => { const n = list.filter((p) => p.status === st).length; return n > 0 && <span key={st} style={{ width: (100 * n / list.length) + '%', background: STATUS_VAR[st] }} />; })}</div>
                      <div className="row wrap" style={{ gap: 12, fontSize: 12.5, color: 'var(--muted)' }}>
                        <span><b className="num" style={{ color: 'var(--text)' }}>{list.length}</b> posts</span>
                        <span><b className="num" style={{ color: 'var(--st-review)' }}>{list.filter((p) => p.status === 'In Review').length}</b> in review</span>
                        <span><b className="num" style={{ color: 'var(--st-scheduled)' }}>{list.filter((p) => p.status === 'Scheduled').length}</b> scheduled</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          {data.isBilling && <InvoiceList client={client} />}
        </div>
      </div></main>
      {panel && <SummaryPanel title={'All ' + client.name + ' brands'} posts={posts} today={data.today} onOpen={(p) => setEditor({ post: p })} onClose={() => setPanel(false)} />}
      {modal === 'edit' && <ClientModal client={client} onClose={() => setModal('')} />}
      {modal === 'share' && <ShareModal client={client} onClose={() => setModal('')} />}
      {editor && <PostEditor post={editor.post} onClose={() => setEditor(null)} />}
    </>
  );
}

/* ---------- Brand (sub-client): calendar / board / table ---------- */
export function BrandPage({ client, view }) {
  const { data, patch } = useData();
  const { toast, confirm } = useUi();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [panel, setPanel] = usePanel();
  const [editor, setEditor] = useState(null);
  const [modal, setModal] = useState('');
  const parent = data.clients.find((c) => c.id === client.parentId);
  const all = useMemo(() => data.posts.filter((p) => p.clientId === client.id), [data.posts, client.id]);
  const posts = useMemo(() => filterPosts(all, filters), [all, filters]);
  const clientsById = useMemo(() => Object.fromEntries(data.clients.map((c) => [c.id, c])), [data.clients]);
  const columns = (data.boardColumns || []).filter((c) => c.clientId === client.id);
  const tagNames = useMemo(() => [...new Set(all.flatMap((p) => p.tags))].sort(), [all]);
  const currentView = ['calendar', 'board', 'table'].includes(view) ? view : 'calendar';

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
  const saveColumn = async (c) => {
    try {
      const r = await rpc('saveBoardColumn', { ...c, clientId: client.id });
      patch((d) => ({ ...d, boardColumns: upsert(d.boardColumns || [], r.column) }));
      toast(c.id ? 'Column updated' : 'Column added', 'success');
    } catch (e) { toast(e.message, 'error'); throw e; }
  };
  const deleteColumn = async (c) => {
    if (!(await confirm({ title: 'Delete "' + c.name + '"?', message: 'Posts in this column move back to the ' + c.afterStatus + ' column. Nothing is deleted.', confirmLabel: 'Delete column', danger: true }))) return;
    try {
      await rpc('deleteBoardColumn', { id: c.id });
      patch((d) => ({ ...d, boardColumns: remove(d.boardColumns || [], c.id), posts: d.posts.map((p) => (p.columnId === c.id ? { ...p, columnId: '' } : p)) }));
    } catch (e) { toast(e.message, 'error'); }
  };

  const shared = { clientsById, showBrand: false, today: data.today, onOpen: (p) => setEditor({ post: p }) };
  return (
    <>
      <main className="main"><div className="main-inner rise" key={client.id}>
        <div className="page-head">
          <div>
            <div className="crumbs">{parent && <><button type="button" onClick={() => go('client', parent.id)}>{parent.name}</button><ChevronRight size={14} /></>}Brand</div>
            <h1 className="page-title"><Dot color={client.color} size={12} />{client.name}</h1>
          </div>
          <div className="page-actions">
            {data.isBilling && <button type="button" className="btn" onClick={() => setModal('share')}><Share2 />Share</button>}
            {data.isBilling && <button type="button" className="btn btn-icon" onClick={() => setModal('edit')} title="Client settings" aria-label="Client settings"><Pencil /></button>}
            <button type="button" className="btn btn-primary" onClick={() => setEditor({ newFor: { clientId: client.id, date: data.today } })}><Plus />New post</button>
          </div>
        </div>
        <Toolbar view={currentView} onView={(v) => go('client', client.id, v)} filters={filters} onFilters={setFilters}
          tags={tagNames} team={data.team} showAssignee panelOpen={panel} onTogglePanel={() => setPanel(true)} />
        {currentView === 'calendar' && <Calendar {...shared} posts={posts} canAdd canMove onNew={(date) => setEditor({ newFor: { clientId: client.id, date } })} onMoveDate={(id, date) => move(id, { date })} />}
        {currentView === 'board' && <Board {...shared} posts={posts} columns={columns} tags={data.tags} comments={data.comments} canMove canManage onMove={move} onSaveColumn={saveColumn} onDeleteColumn={deleteColumn} />}
        {currentView === 'table' && <TableView {...shared} posts={posts} team={data.team} tags={data.tags} />}
      </div></main>
      {panel && <SummaryPanel title={client.name} posts={posts} today={data.today} onOpen={(p) => setEditor({ post: p })} onClose={() => setPanel(false)} />}
      {editor && <PostEditor post={editor.post} newFor={editor.newFor} onClose={() => setEditor(null)} />}
      {modal === 'edit' && <ClientModal client={client} onClose={() => setModal('')} />}
      {modal === 'share' && <ShareModal client={client} onClose={() => setModal('')} />}
    </>
  );
}
