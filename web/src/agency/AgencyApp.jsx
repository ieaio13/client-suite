import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Clock, FolderKanban, LayoutDashboard, Plus, Settings as SettingsIcon } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData } from '../data.jsx';
import { go, useRoute } from '../lib/route.js';
import { Avatar, Dot, useUi } from '../components/ui.jsx';
import { LiveBadge, TopBar } from '../components/Shell.jsx';
import { cx, sortClients } from '../lib/util.js';
import Overview from './Overview.jsx';
import { ParentPage, BrandPage } from './ClientPages.jsx';
import Settings from './Settings.jsx';
import { PlanBanner } from './Plan.jsx';
import ProjectsPage from '../work/Projects.jsx';
import ProjectPage from '../work/ProjectPage.jsx';
import TimePage from '../work/TimePage.jsx';
import { TimerBadge } from '../work/Timer.jsx';
import { ClientModal } from './ClientModals.jsx';

const OPEN_KEY = 'cf_tree_closed';
function readClosed() {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch (e) { return {}; }
}

export default function AgencyApp() {
  const { data, liveMode } = useData();
  const route = useRoute();
  const [drawer, setDrawer] = useState(false);
  const [newClient, setNewClient] = useState(null);
  useEffect(() => { setDrawer(false); }, [route.page, route.id]);

  const client = route.page === 'client' ? data.clients.find((c) => c.id === route.id) : null;
  let content;
  const project = route.page === 'project' ? (data.projects || []).find((p) => p.id === route.id) : null;
  if (route.page === 'settings') content = <Settings tab={route.id || 'profile'} />;
  else if (route.page === 'projects') content = <ProjectsPage clientId={route.id} />;
  else if (project) content = <ProjectPage project={project} />;
  else if (route.page === 'time') content = <TimePage />;
  else if (client && !client.parentId) content = <ParentPage client={client} onAddSub={() => setNewClient({ parentId: client.id })} />;
  else if (client) content = <BrandPage client={client} view={route.sub || 'calendar'} />;
  else content = <Overview />;

  return (
    <div className="app">
      <TopBar name={data.settings.agencyName} onMenu={() => setDrawer(!drawer)}
        nav={(
          <nav className="topnav" aria-label="Main">
            <button type="button" className={route.page !== 'settings' ? 'on' : ''} onClick={() => go('overview')}><LayoutDashboard /><span>Workspace</span></button>
            <button type="button" className={route.page === 'settings' ? 'on' : ''} onClick={() => go('settings', 'profile')}><SettingsIcon /><span>Settings</span></button>
          </nav>
        )}
        right={(<>
          <TimerBadge />
          <LiveBadge mode={liveMode} />
          <button type="button" className="btn btn-ghost" style={{ padding: '0 6px' }} onClick={() => go('settings', 'profile')} title="Your profile">
            <Avatar person={data.user} /><span className="hide-mobile" style={{ fontWeight: 500 }}>{data.user.name}</span>
          </button>
        </>)} />
      <PlanBanner />
      <div className="shell">
        <Sidebar open={drawer} page={client ? 'client' : route.page === 'project' ? 'projects' : route.page} activeId={client ? client.id : ''} onAdd={(parentId) => setNewClient({ parentId: parentId || '' })} />
        {drawer && <div className="drawer-overlay only-mobile" onClick={() => setDrawer(false)} />}
        {content}
      </div>
      {newClient && <ClientModal parentId={newClient.parentId} onClose={() => setNewClient(null)} />}
    </div>
  );
}

function Sidebar({ open, page, activeId, onAdd }) {
  const { data, patch } = useData();
  const { toast } = useUi();
  const [closed, setClosed] = useState(readClosed);
  const [reorder, setReorder] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const visible = (c) => showArchived || !c.archived;
  const parents = useMemo(() => sortClients(data.clients.filter((c) => !c.parentId && visible(c))), [data.clients, showArchived]); // eslint-disable-line react-hooks/exhaustive-deps
  const kids = (p) => sortClients(data.clients.filter((c) => c.parentId === p.id && visible(c)));
  const openProjects = (data.projects || []).filter((p) => p.status !== 'Done').length;
  const reviewCount = useMemo(() => {
    const m = {};
    for (const p of data.posts) if (p.status === 'In Review') m[p.clientId] = (m[p.clientId] || 0) + 1;
    return m;
  }, [data.posts]);

  const toggle = (id) => {
    const next = { ...closed, [id]: !closed[id] };
    setClosed(next);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch (e) {}
  };

  const move = async (c, dir) => {
    const group = sortClients(data.clients.filter((x) => (x.parentId || '') === (c.parentId || '')));
    const i = group.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= group.length) return;
    [group[i], group[j]] = [group[j], group[i]];
    const order = Object.fromEntries(group.map((x, k) => [x.id, k]));
    patch((d) => ({ ...d, clients: d.clients.map((x) => (x.id in order ? { ...x, sortOrder: order[x.id] } : x)) }));
    try { await rpc('reorderClients', { ids: group.map((x) => x.id) }); } catch (e) { toast(e.message, 'error'); }
  };

  const item = (c, isSub, idx, count) => {
    const badge = isSub ? reviewCount[c.id] : kids(c).reduce((n, k) => n + (reviewCount[k.id] || 0), 0);
    return (
      <div className={cx('navitem', isSub && 'sub', activeId === c.id && 'on')} role="button" tabIndex={0}
        onClick={() => !reorder && go('client', c.id)} onKeyDown={(e) => { if (e.key === 'Enter' && !reorder) go('client', c.id); }}>
        {!isSub && (
          <button type="button" className={cx('caret', !closed[c.id] && 'open')} onClick={(e) => { e.stopPropagation(); toggle(c.id); }} aria-label={(closed[c.id] ? 'Expand ' : 'Collapse ') + c.name} aria-expanded={!closed[c.id]}><ChevronRight /></button>
        )}
        <Dot color={c.color} />
        <span className="grow">{c.name}{c.archived ? ' (archived)' : ''}</span>
        {reorder ? (
          <span className="row" style={{ gap: 2 }}>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ width: 26, height: 26 }} disabled={idx === 0} onClick={(e) => { e.stopPropagation(); move(c, -1); }} aria-label={'Move ' + c.name + ' up'}><ArrowUp /></button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ width: 26, height: 26 }} disabled={idx === count - 1} onClick={(e) => { e.stopPropagation(); move(c, 1); }} aria-label={'Move ' + c.name + ' down'}><ArrowDown /></button>
          </span>
        ) : (<>
          {badge > 0 && <span className="badge warn" title={badge + ' waiting for client review'}>{badge}</span>}
          {!isSub && data.isBilling && (
            <button type="button" className="btn btn-ghost btn-icon btn-sm hover-act" style={{ width: 26, height: 26 }} onClick={(e) => { e.stopPropagation(); onAdd(c.id); }} aria-label={'Add sub-client to ' + c.name} title="Add sub-client"><Plus /></button>
          )}
        </>)}
      </div>
    );
  };

  return (
    <aside className={cx('sidebar', open && 'open')} aria-label="Clients">
      <div className="sidebar-scroll">
        <button type="button" className={cx('navitem', !activeId && !['projects', 'time'].includes(page) && 'on')} onClick={() => go('overview')}><LayoutDashboard /><span className="grow">Overview</span></button>
        <button type="button" className={cx('navitem', page === 'projects' && 'on')} onClick={() => go('projects')}><FolderKanban /><span className="grow">Projects</span>{openProjects > 0 && <span className="badge">{openProjects}</span>}</button>
        {data.clients.some((c) => c.timeTracking) && <button type="button" className={cx('navitem', page === 'time' && 'on')} onClick={() => go('time')}><Clock /><span className="grow">Time</span></button>}
        <div className="side-head" style={{ marginTop: 14 }}>
          <span>Clients</span>
          {data.isBilling && (
            <span className="row" style={{ gap: 2 }}>
              <button type="button" className={cx('btn btn-icon btn-sm', reorder ? 'btn-primary' : 'btn-ghost')} onClick={() => setReorder(!reorder)} title={reorder ? 'Done reordering' : 'Reorder clients'} aria-label="Reorder clients" aria-pressed={reorder}><ArrowUpDown /></button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onAdd('')} title="Add client" aria-label="Add client"><Plus /></button>
            </span>
          )}
        </div>
        {parents.length === 0 && <div className="soft" style={{ fontSize: 13, padding: '4px 10px' }}>No clients yet.{data.isBilling ? ' Use + to add your first client.' : ''}</div>}
        {parents.map((p, i) => {
          const list = kids(p);
          return (
            <div key={p.id} className="tree-group">
              {item(p, false, i, parents.length)}
              {!closed[p.id] && list.length > 0 && (
                <div className="tree-children">{list.map((k, j) => <div key={k.id}>{item(k, true, j, list.length)}</div>)}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="side-foot">
        <label className="checkbox"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
      </div>
    </aside>
  );
}
