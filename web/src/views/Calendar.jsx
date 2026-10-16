import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Empty, Modal, Seg } from '../components/ui.jsx';
import { addDays, cx, monthLabel, parseYmd, prettyDate, ymd } from '../lib/util.js';
import { PostTile } from './PostBits.jsx';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LIMIT = 2;

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}

export default function Calendar({ posts, today, clientsById, showBrand, canAdd, canMove, onOpen, onNew, onMoveDate }) {
  const [mode, setModeState] = useState(() => readPref('cf_cal_mode', 'month'));
  const [cursor, setCursor] = useState(today);
  const [dropDay, setDropDay] = useState('');
  const [dayModal, setDayModal] = useState('');
  const setMode = (m) => { setModeState(m); try { localStorage.setItem('cf_cal_mode', m); } catch (e) {} };

  const byDate = useMemo(() => {
    const m = {};
    for (const p of posts) {
      if (!p.date) continue;
      (m[p.date] = m[p.date] || []).push(p);
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    return m;
  }, [posts]);

  const days = useMemo(() => {
    const c = parseYmd(cursor);
    if (mode === 'week') {
      const start = new Date(c);
      start.setDate(start.getDate() - start.getDay());
      return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return { date: ymd(d), out: false }; });
    }
    const first = new Date(c.getFullYear(), c.getMonth(), 1, 12);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    const last = new Date(c.getFullYear(), c.getMonth() + 1, 0, 12);
    const count = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
    return Array.from({ length: count }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return { date: ymd(d), out: d.getMonth() !== c.getMonth() }; });
  }, [cursor, mode]);

  const go = (dir) => {
    if (dir === 0) return setCursor(today);
    if (mode === 'week') return setCursor(addDays(cursor, dir * 7));
    const d = parseYmd(cursor);
    d.setDate(1);
    d.setMonth(d.getMonth() + dir);
    setCursor(ymd(d));
  };

  const tile = (p) => (
    <PostTile key={p.id} post={p} client={clientsById[p.clientId]} showBrand={showBrand} draggable={canMove}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)} onOpen={() => onOpen(p)} />
  );

  const head = (
    <div className="toolbar" style={{ marginBottom: 12 }}>
      <div className="cal-head">
        <button type="button" className="btn btn-icon btn-sm" onClick={() => go(-1)} aria-label="Previous"><ChevronLeft /></button>
        <button type="button" className="btn btn-sm" onClick={() => go(0)}>Today</button>
        <button type="button" className="btn btn-icon btn-sm" onClick={() => go(1)} aria-label="Next"><ChevronRight /></button>
        <h2>{mode === 'week' ? 'Week of ' + prettyDate(days[0].date) : monthLabel(cursor)}</h2>
      </div>
      <Seg value={mode} onChange={setMode} label="Calendar range" options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'list', label: 'List' }]} />
    </div>
  );

  if (mode === 'list') {
    const dated = posts.filter((p) => p.date).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const undated = posts.filter((p) => !p.date);
    const groups = [];
    for (const p of dated) {
      const g = groups[groups.length - 1];
      if (g && g.date === p.date) g.items.push(p); else groups.push({ date: p.date, items: [p] });
    }
    if (undated.length) groups.push({ date: '', items: undated });
    return (
      <div>
        {head}
        {groups.length === 0 ? <div className="card"><Empty icon={CalendarDays} title="No posts match">Try clearing filters or add a new post.</Empty></div> : (
          <div className="agenda">
            {groups.map((g) => (
              <div key={g.date || 'none'} className="agenda-day">
                <h4>{g.date ? prettyDate(g.date) + (g.date === today ? ' · Today' : '') : 'No date'}</h4>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>{g.items.map(tile)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {head}
      <div className="cal">
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {days.map((d) => {
          const list = byDate[d.date] || [];
          const limit = mode === 'week' ? 99 : MONTH_LIMIT;
          return (
            <div key={d.date} className={cx('cal-cell', d.out && 'out', mode === 'week' && 'week', dropDay === d.date && 'drop')}
              onDragOver={canMove ? (e) => { e.preventDefault(); setDropDay(d.date); } : undefined}
              onDragLeave={canMove ? () => setDropDay('') : undefined}
              onDrop={canMove ? (e) => { e.preventDefault(); setDropDay(''); const id = e.dataTransfer.getData('text/plain'); if (id) onMoveDate(id, d.date); } : undefined}>
              <div className="cal-top">
                <span className={cx('cal-num', d.date === today && 'today')}>{parseYmd(d.date).getDate()}</span>
                {canAdd && <button type="button" className="btn btn-ghost btn-icon btn-sm cal-add" style={{ width: 22, height: 22 }} onClick={() => onNew(d.date)} aria-label={'Add post on ' + prettyDate(d.date)}><Plus /></button>}
              </div>
              {list.slice(0, limit).map(tile)}
              {list.length > limit && <button type="button" className="more-btn" onClick={() => setDayModal(d.date)}>+{list.length - limit} more</button>}
            </div>
          );
        })}
      </div>
      {dayModal && (
        <Modal title={prettyDate(dayModal)} onClose={() => setDayModal('')}>
          <div className="modal-body"><div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {(byDate[dayModal] || []).map((p) => <PostTile key={p.id} post={p} client={clientsById[p.clientId]} showBrand={showBrand} onOpen={() => { setDayModal(''); onOpen(p); }} />)}
          </div></div>
        </Modal>
      )}
    </div>
  );
}
