import { useMemo, useState } from 'react';
import { Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import { Field, MenuItem, Modal, Popover } from '../components/ui.jsx';
import { COLORS, STATUSES, STATUS_VAR, cx } from '../lib/util.js';
import { PostCard, tagColorMap } from './PostBits.jsx';

// Core stages always exist; custom columns (per brand) sit right after the stage they belong to.
export function buildColumns(customColumns) {
  const cols = [];
  for (const s of STATUSES) {
    cols.push({ key: s, status: s, name: s, color: STATUS_VAR[s], core: true });
    customColumns.filter((c) => c.afterStatus === s).sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((c) => cols.push({ key: c.id, id: c.id, status: s, name: c.name, color: c.color || STATUS_VAR[s], core: false, raw: c }));
  }
  return cols;
}

export default function Board({ posts, columns, clientsById, showBrand, tags, comments, today, canMove, canManage, onOpen, onMove, onSaveColumn, onDeleteColumn }) {
  const [drop, setDrop] = useState('');
  const [dragId, setDragId] = useState('');
  const [editing, setEditing] = useState(null); // column draft
  const cols = useMemo(() => buildColumns(columns || []), [columns]);
  const tagColors = useMemo(() => tagColorMap(tags), [tags]);
  const commentCounts = useMemo(() => {
    const m = {};
    for (const c of comments || []) m[c.postId] = (m[c.postId] || 0) + 1;
    return m;
  }, [comments]);
  const customIds = new Set((columns || []).map((c) => c.id));

  const inCol = (col) => posts.filter((p) => {
    const custom = p.columnId && customIds.has(p.columnId);
    return col.core ? p.status === col.status && !custom : p.columnId === col.id;
  });

  return (
    <div className="board">
      {cols.map((col) => {
        const list = inCol(col);
        return (
          <section key={col.key} className={cx('col', !col.core && 'custom', drop === col.key && 'drop')} style={!col.core ? { '--cc': col.color } : undefined}
            onDragOver={canMove ? (e) => { e.preventDefault(); setDrop(col.key); } : undefined}
            onDragLeave={canMove ? () => setDrop('') : undefined}
            onDrop={canMove ? (e) => {
              e.preventDefault(); setDrop('');
              const id = e.dataTransfer.getData('text/plain');
              if (id) onMove(id, col.core ? { status: col.status, columnId: '' } : { columnId: col.id });
            } : undefined}
            aria-label={col.name + ' column'}>
            <header className="col-head">
              <span className="bar-c" style={{ background: col.color }} />
              <span className="name grow ellipsis">{col.name}</span>
              {!col.core && <span className="soft" style={{ fontSize: 11.5 }}>{col.status}</span>}
              <span className="badge">{list.length}</span>
              {!col.core && canManage && (
                <Popover trigger={({ toggle }) => <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ width: 26, height: 26 }} onClick={toggle} aria-label={'Column options for ' + col.name}><Ellipsis /></button>}>
                  {({ close }) => (<>
                    <MenuItem icon={Pencil} onClick={() => { close(); setEditing({ ...col.raw }); }}>Edit column</MenuItem>
                    <MenuItem icon={Trash2} danger onClick={() => { close(); onDeleteColumn(col.raw); }}>Delete column</MenuItem>
                  </>)}
                </Popover>
              )}
            </header>
            <div className="col-body">
              {list.map((p) => (
                <PostCard key={p.id} post={p} client={clientsById[p.clientId]} showBrand={showBrand} tagColors={tagColors} today={today}
                  commentCount={commentCounts[p.id] || 0} draggable={canMove} dragging={dragId === p.id}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); setDragId(p.id); }} onDragEnd={() => setDragId('')}
                  onOpen={() => onOpen(p)} />
              ))}
              {list.length === 0 && <div className="soft" style={{ fontSize: 12.5, padding: '6px 4px' }}>{canMove ? 'Drop posts here' : 'Nothing here'}</div>}
            </div>
          </section>
        );
      })}
      {canManage && (
        <div className="col-add">
          <button type="button" className="btn btn-block" style={{ height: 44, borderStyle: 'dashed' }} onClick={() => setEditing({ name: '', color: COLORS[(columns || []).length % COLORS.length], afterStatus: 'Draft' })}>
            <Plus />Add column
          </button>
        </div>
      )}
      {editing && (
        <ColumnEditor draft={editing} onClose={() => setEditing(null)}
          onSave={async (d) => { await onSaveColumn(d); setEditing(null); }} />
      )}
    </div>
  );
}

function ColumnEditor({ draft, onClose, onSave }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await onSave(d); } finally { setBusy(false); }
  };
  return (
    <Modal title={d.id ? 'Edit column' : 'Add a column'} onClose={onClose}
      footer={<><span /><div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" form="col-form" className="btn btn-primary" disabled={busy || !d.name.trim()}>{d.id ? 'Save' : 'Add column'}</button></div></>}>
      <form id="col-form" className="modal-body stack" onSubmit={save}>
        <Field label="Name" htmlFor="col-name"><input id="col-name" className="input" value={d.name} maxLength={40} autoFocus placeholder="e.g. Shooting, Editing" onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Comes after" hint="Posts in this column count as this stage for approvals and emails.">
          <select className="select" value={d.afterStatus} onChange={(e) => setD({ ...d, afterStatus: e.target.value })}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Color">
          <div className="row wrap" style={{ gap: 8 }}>
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setD({ ...d, color: c })} aria-label={'Color ' + c} aria-pressed={d.color === c}
                style={{ width: 28, height: 28, borderRadius: 999, border: d.color === c ? '2px solid var(--text)' : '2px solid transparent', background: c, cursor: 'pointer', boxShadow: 'inset 0 0 0 2px var(--surface)' }} />
            ))}
          </div>
        </Field>
      </form>
    </Modal>
  );
}
