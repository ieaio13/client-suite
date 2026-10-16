import { Play, Table2 } from 'lucide-react';
import { Dot, Empty, StatusPill, TagChip } from '../components/ui.jsx';
import { postCover, shortDate } from '../lib/util.js';
import { tagColorMap } from './PostBits.jsx';

export default function TableView({ posts, clientsById, showBrand, team, tags, onOpen }) {
  const tagColors = tagColorMap(tags);
  const teamName = (email) => { const m = (team || []).find((t) => t.email === email); return m ? m.name : email; };
  const sorted = posts.slice().sort((a, b) => ((a.date || '9') + a.time).localeCompare((b.date || '9') + b.time));
  if (!sorted.length) return <div className="card"><Empty icon={Table2} title="No posts match">Try clearing filters or add a new post.</Empty></div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>
          <th style={{ width: 56 }} aria-label="Media" />
          <th>Post</th>
          {showBrand && <th>Brand</th>}
          <th>Status</th><th>Platforms</th><th>Tags</th><th>Date</th>
          {team && <th>Assignee</th>}
          <th>Added by</th>
        </tr></thead>
        <tbody>
          {sorted.map((p) => {
            const cover = postCover(p);
            const c = clientsById[p.clientId];
            return (
              <tr key={p.id} className="click" onClick={() => onOpen(p)}>
                <td>{cover ? (cover.asset.thumbUrl ? <img className="thumb-sm" src={cover.asset.thumbUrl} alt="" loading="lazy" /> : <div className="thumb-sm row" style={{ justifyContent: 'center' }}><Play size={14} /></div>) : <div className="thumb-sm" />}</td>
                <td style={{ maxWidth: 340 }}><div className="clamp-2">{p.text || <span className="soft">No copy yet</span>}</div></td>
                {showBrand && <td><span className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}><Dot color={c && c.color} size={8} />{c ? c.name : ''}</span></td>}
                <td><StatusPill status={p.status} /></td>
                <td><div className="chip-row">{p.platforms.map((x) => <span key={x} className="chip">{x}</span>)}</div></td>
                <td><div className="chip-row">{p.tags.map((t) => <TagChip key={t} name={t} color={tagColors[t.toLowerCase()]} />)}</div></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{shortDate(p.date)}</td>
                {team && <td style={{ whiteSpace: 'nowrap' }}>{p.assignee ? teamName(p.assignee) : <span className="soft">Unassigned</span>}</td>}
                <td style={{ whiteSpace: 'nowrap' }} className="muted">{p.createdBy ? p.createdBy + (p.createdByType === 'client' ? ' (client)' : '') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
