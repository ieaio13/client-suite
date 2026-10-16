import { Images, MessageSquare, Play } from 'lucide-react';
import { Dot, StatusPill, TagChip } from '../components/ui.jsx';
import { postCover, relDay } from '../lib/util.js';

export function tagColorMap(tags) {
  const m = {};
  for (const t of tags || []) m[t.name.toLowerCase()] = t.color;
  return m;
}

export function Cover({ post, className, videoClass }) {
  const cover = postCover(post);
  if (!cover) return null;
  if (cover.asset.thumbUrl) return <img className={className} src={cover.asset.thumbUrl} alt="" loading="lazy" draggable={false} />;
  return <div className={videoClass}><Play size={18} /></div>;
}

// Card used on the board.
export function PostCard({ post, client, showBrand, tagColors, commentCount, statusLabel, draggable, onOpen, onDragStart, onDragEnd, dragging, today }) {
  const cover = postCover(post);
  return (
    <div className={'kcard' + (dragging ? ' dragging' : '')} role="button" tabIndex={0}
      draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      {cover && (
        <div className="k-media">
          <Cover post={post} className="k-img" videoClass="k-img tile-vid" />
          <div className="k-badges">
            <span>{cover.isRef && <span className="k-badge">Reference</span>}</span>
            {cover.count > 1 && <span className="k-badge"><Images />{cover.count}</span>}
          </div>
        </div>
      )}
      <div className="k-body">
        {showBrand && client && <div className="row" style={{ gap: 6, fontSize: 12, color: 'var(--muted)' }}><Dot color={client.color} size={8} />{client.name}</div>}
        <div className="k-text clamp-3">{post.text || <span className="soft">No copy yet</span>}</div>
        {(post.platforms.length > 0 || post.tags.length > 0) && (
          <div className="chip-row">
            {post.platforms.map((p) => <span key={p} className="chip">{p}</span>)}
            {post.tags.map((t) => <TagChip key={t} name={t} color={tagColors[t.toLowerCase()]} />)}
          </div>
        )}
        <div className="k-foot">
          <span>{relDay(post.date, today)}{post.createdBy ? ' · ' + post.createdBy : ''}</span>
          <span className="row">
            {statusLabel && <StatusPill status={post.status} label={statusLabel} />}
            {commentCount > 0 && <span className="row" style={{ gap: 3 }}><MessageSquare />{commentCount}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

// Compact tile used on calendar days.
export function PostTile({ post, client, showBrand, draggable, onOpen, onDragStart }) {
  return (
    <button type="button" className="tile" draggable={draggable} onDragStart={onDragStart} onClick={onOpen} title={post.status + ' · ' + (post.text || '')}>
      <Cover post={post} className="tile-img" videoClass="tile-vid" />
      <span className="row" style={{ gap: 6, justifyContent: 'space-between' }}>
        <StatusPill status={post.status} />
        {showBrand && client && <Dot color={client.color} size={8} />}
      </span>
      <span className="tile-txt clamp-2">{post.text || 'No copy yet'}</span>
    </button>
  );
}
