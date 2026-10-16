import { useMemo } from 'react';
import { CircleAlert, Clock, PanelRightClose } from 'lucide-react';
import { StatusPill } from '../components/ui.jsx';
import { PLATFORMS, STATUSES, STATUS_VAR, addDays, postCover, relDay } from '../lib/util.js';

// Right-hand summary of whatever posts are in the current view.
export default function SummaryPanel({ title, posts, today, onOpen, onClose, extra }) {
  const s = useMemo(() => {
    const counts = {};
    STATUSES.forEach((x) => { counts[x] = 0; });
    const platforms = {};
    for (const p of posts) {
      counts[p.status] = (counts[p.status] || 0) + 1;
      for (const pl of p.platforms) platforms[pl] = (platforms[pl] || 0) + 1;
    }
    const in7 = addDays(today, 7);
    const upcoming = posts.filter((p) => p.date && p.date >= today && p.date <= in7 && p.status !== 'Published')
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const review = posts.filter((p) => p.status === 'In Review');
    const late = posts.filter((p) => p.date && p.date < today && !['Published', 'Scheduled'].includes(p.status));
    return { counts, platforms, upcoming, review, late, total: posts.length };
  }, [posts, today]);

  const item = (p, sub) => {
    const cover = postCover(p);
    return (
      <button key={p.id} type="button" className="mini-item" onClick={() => onOpen(p)}>
        {cover && cover.asset.thumbUrl ? <img className="thumb" src={cover.asset.thumbUrl} alt="" /> : <span className="thumb" />}
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t ellipsis" style={{ display: 'block' }}>{p.text || 'No copy yet'}</span>
          <span className="s">{sub}</span>
        </span>
      </button>
    );
  };

  return (
    <aside className="panel" aria-label="Summary">
      <div className="panel-head">
        <h3>{title || 'Summary'}</h3>
        {onClose && <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} title="Hide summary" aria-label="Hide summary"><PanelRightClose /></button>}
      </div>

      <div className="panel-sec">
        <h4>{s.total} post{s.total === 1 ? '' : 's'} in view</h4>
        <div className="bar" aria-hidden="true">
          {STATUSES.map((x) => s.counts[x] > 0 && <span key={x} style={{ width: (100 * s.counts[x] / Math.max(1, s.total)) + '%', background: STATUS_VAR[x] }} />)}
        </div>
        <div className="legend">
          {STATUSES.map((x) => (
            <div key={x} className="legend-row"><i style={{ background: STATUS_VAR[x] }} /><span className="grow">{x}</span><b className="num">{s.counts[x]}</b></div>
          ))}
        </div>
      </div>

      {extra}

      {(s.review.length > 0 || s.late.length > 0) && (
        <div className="panel-sec">
          <h4>Needs attention</h4>
          <div className="mini-list">
            {s.review.slice(0, 5).map((p) => item(p, <span className="row" style={{ gap: 4 }}><StatusPill status="In Review" label="Waiting for approval" /></span>))}
            {s.late.slice(0, 5).map((p) => item(p, <span className="row" style={{ gap: 4, color: 'var(--danger)' }}><CircleAlert size={13} />Date passed · {p.status}</span>))}
          </div>
        </div>
      )}

      <div className="panel-sec">
        <h4>Coming up · next 7 days</h4>
        {s.upcoming.length === 0 ? <div className="soft" style={{ fontSize: 13 }}>Nothing scheduled this week.</div> : (
          <div className="mini-list">{s.upcoming.slice(0, 8).map((p) => item(p, <span className="row" style={{ gap: 4 }}><Clock size={12} />{relDay(p.date, today)} · {p.status}</span>))}</div>
        )}
      </div>

      <div className="panel-sec" style={{ borderBottom: 0 }}>
        <h4>By platform</h4>
        <div className="legend" style={{ marginTop: 0 }}>
          {PLATFORMS.filter((pl) => s.platforms[pl]).map((pl) => (
            <div key={pl} className="legend-row"><span className="grow">{pl}</span><b className="num">{s.platforms[pl]}</b></div>
          ))}
          {Object.keys(s.platforms).length === 0 && <div className="soft" style={{ fontSize: 13 }}>No platforms set yet.</div>}
        </div>
      </div>
    </aside>
  );
}
