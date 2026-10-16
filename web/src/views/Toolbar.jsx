import { CalendarDays, Columns3, PanelRightOpen, Search, SlidersHorizontal, Table2, X } from 'lucide-react';
import { Popover, Seg } from '../components/ui.jsx';
import { PLATFORMS, STATUSES } from '../lib/util.js';

export const EMPTY_FILTERS = { search: '', status: '', platform: '', tag: '', assignee: '' };

export function ViewSwitch({ value, onChange, table = true }) {
  const options = [
    { value: 'calendar', label: 'Calendar', icon: CalendarDays },
    { value: 'board', label: 'Board', icon: Columns3 }
  ];
  if (table) options.push({ value: 'table', label: 'Table', icon: Table2 });
  return <Seg value={value} onChange={onChange} options={options} label="View" />;
}

export function Toolbar({ view, onView, filters, onFilters, tags, team, showAssignee, table = true, panelOpen, onTogglePanel, extra }) {
  const set = (k, v) => onFilters({ ...filters, [k]: v });
  const active = ['status', 'platform', 'tag', 'assignee'].filter((k) => filters[k]);
  const teamName = (email) => {
    if (email === '__none__') return 'Unassigned';
    const m = (team || []).find((t) => t.email === email);
    return m ? m.name : email;
  };
  return (
    <>
      <div className="toolbar">
        <div className="row wrap">
          <ViewSwitch value={view} onChange={onView} table={table} />
          {extra}
        </div>
        <div className="toolbar-right">
          <div className="input-group" style={{ width: 220 }}>
            <Search />
            <input className="input" placeholder="Search posts" value={filters.search} onChange={(e) => set('search', e.target.value)} aria-label="Search posts" />
          </div>
          <Popover pad trigger={({ toggle, open }) => (
            <button type="button" className="btn" onClick={toggle} aria-expanded={open}>
              <SlidersHorizontal />Filters{active.length > 0 && <span className="badge accent">{active.length}</span>}
            </button>
          )}>
            <label className="field"><span className="label">Status</span>
              <select className="select" value={filters.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select></label>
            <label className="field"><span className="label">Platform</span>
              <select className="select" value={filters.platform} onChange={(e) => set('platform', e.target.value)}>
                <option value="">All platforms</option>{PLATFORMS.map((s) => <option key={s}>{s}</option>)}
              </select></label>
            <label className="field"><span className="label">Tag</span>
              <select className="select" value={filters.tag} onChange={(e) => set('tag', e.target.value)}>
                <option value="">All tags</option>{(tags || []).map((t) => <option key={t}>{t}</option>)}
              </select></label>
            {showAssignee && (
              <label className="field"><span className="label">Assignee</span>
                <select className="select" value={filters.assignee} onChange={(e) => set('assignee', e.target.value)}>
                  <option value="">Anyone</option><option value="__none__">Unassigned</option>
                  {(team || []).map((t) => <option key={t.email} value={t.email}>{t.name}</option>)}
                </select></label>
            )}
            {active.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFilters({ ...EMPTY_FILTERS, search: filters.search })}>Clear filters</button>}
          </Popover>
          {onTogglePanel && !panelOpen && (
            <button type="button" className="btn btn-icon" onClick={onTogglePanel} title="Show summary" aria-label="Show summary"><PanelRightOpen /></button>
          )}
        </div>
      </div>
      {active.length > 0 && (
        <div className="filter-chips">
          {active.map((k) => (
            <button key={k} type="button" className="filter-chip" onClick={() => set(k, '')} aria-label={'Remove filter ' + filters[k]}>
              {k === 'assignee' ? teamName(filters[k]) : filters[k]}<X />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
