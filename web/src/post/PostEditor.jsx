import { useMemo, useState } from 'react';
import { CircleCheck, Info, MessageSquare, History, RotateCcw, Trash2, X } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData, upsert, remove } from '../data.jsx';
import { Dot, Field, Lightbox, Modal, Seg, StatusPill, useUi } from '../components/ui.jsx';
import { LOCKED_FOR_CLIENTS, PLATFORMS, STATUSES, cx, stamp } from '../lib/util.js';
import { buildColumns } from '../views/Board.jsx';
import MediaSection from './MediaSection.jsx';
import Comments from './Comments.jsx';

function blankPost(clientId, date) {
  return { id: '', clientId, text: '', status: 'Draft', columnId: '', tags: [], platforms: [], date: date || '', time: '10:00',
    assets: [], refAssets: [], liveUrl: '', metrics: { reach: '', likes: '', comments: '', shares: '' }, assignee: '' };
}

// Opens for an existing post (post) or a new one (newFor: { clientId, date }).
export default function PostEditor({ post, newFor, onClose }) {
  const { data, patch } = useData();
  const { toast, confirm } = useUi();
  const portal = data.mode === 'portal';
  const original = post || null;
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(post || blankPost(newFor.clientId, newFor.date))));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [side, setSide] = useState('comments');
  const [preview, setPreview] = useState('');
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState(false);

  const client = data.clients.find((c) => c.id === draft.clientId);
  const canEditPortal = portal && data.rootClient.access === 'edit' && (!original || !LOCKED_FOR_CLIENTS.includes(original.status));
  const canEdit = !portal || canEditPortal;
  const canDelete = original && (!portal || (canEditPortal && original.createdByType === 'client'));
  const comments = useMemo(() => (original ? data.comments.filter((c) => c.postId === original.id) : []), [data.comments, original]);
  const activity = useMemo(() => (!portal && original ? data.activity.filter((a) => a.postId === original.id).slice().reverse() : []), [data.activity, original, portal]);
  const columns = useMemo(() => buildColumns((data.boardColumns || []).filter((c) => c.clientId === draft.clientId)), [data.boardColumns, draft.clientId]);
  const tagLib = data.tags || [];

  const set = (k, v) => { setDraft((d) => ({ ...d, [k]: v })); setDirty(true); };
  const toggle = (k, v) => set(k, draft[k].includes(v) ? draft[k].filter((x) => x !== v) : draft[k].concat([v]));
  const toggleTag = (name) => {
    const has = draft.tags.some((t) => t.toLowerCase() === name.toLowerCase());
    set('tags', has ? draft.tags.filter((t) => t.toLowerCase() !== name.toLowerCase()) : draft.tags.concat([name]));
  };
  const [tagInput, setTagInput] = useState('');
  const addCustomTag = () => {
    const t = tagInput.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (t && !draft.tags.some((x) => x.toLowerCase() === t.toLowerCase())) set('tags', draft.tags.concat([t]));
    setTagInput('');
  };

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Discard changes?', message: 'You have unsaved changes to this post.', confirmLabel: 'Discard', danger: true }))) return;
    onClose();
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await rpc('savePost', draft, { long: true });
      patch((d) => ({ ...d, posts: upsert(d.posts, r.post), activity: r.activity ? d.activity.concat([r.activity]) : d.activity }));
      toast(portal ? 'Post saved. The agency team has been notified.' : 'Post saved', 'success');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
      setSaving(false);
    }
  };

  const del = async () => {
    if (!(await confirm({ title: 'Delete this post?', message: 'The post and its comments will be removed permanently.', confirmLabel: 'Delete post', danger: true }))) return;
    try {
      await rpc('deletePost', { postId: original.id });
      patch((d) => ({ ...d, posts: remove(d.posts, original.id) }));
      toast('Post deleted', 'success');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const decide = async (decision) => {
    if (decision === 'changes' && !note.trim()) { toast('Please add a note explaining the changes.', 'error'); return; }
    setDeciding(true);
    try {
      const r = await rpc('clientDecision', { postId: original.id, decision, comment: note.trim() });
      patch((d) => ({ ...d, posts: upsert(d.posts, r.post), comments: r.comment ? d.comments.concat([r.comment]) : d.comments }));
      toast(decision === 'approve' ? 'Post approved' : 'Changes requested', 'success');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
      setDeciding(false);
    }
  };

  const onComment = (c, act) => patch((d) => ({ ...d, comments: d.comments.concat([c]), activity: act ? d.activity.concat([act]) : d.activity }));

  const libLower = tagLib.map((t) => t.name.toLowerCase());
  const extraTags = draft.tags.filter((t) => !libLower.includes(t.toLowerCase()));
  const stageKey = draft.columnId || draft.status;

  const metaLine = original && (
    <div className="meta-line">
      <span>Added by <b>{original.createdBy || 'Unknown'}{original.createdByType === 'client' ? ' (client)' : ''}</b>{original.createdAt ? ' · ' + stamp(original.createdAt) : ''}</span>
      {original.updatedAt && original.updatedAt !== original.createdAt && <span>Updated{original.updatedBy ? ' by ' : ''}<b>{original.updatedBy}</b> · {stamp(original.updatedAt)}</span>}
    </div>
  );

  return (
    <Modal size="xl" onClose={close} dismissable={!dirty}
      title={<><Dot color={client && client.color} />{original ? (canEdit ? 'Edit post' : 'Post') : portal ? 'Add a post' : 'New post'}<span className="muted" style={{ fontWeight: 400 }}>· {client ? client.name : ''}</span></>}
      subtitle={metaLine}
      footer={<>
        <div>{canDelete && <button type="button" className="btn btn-danger-ghost" onClick={del}><Trash2 />Delete</button>}</div>
        <div className="row">
          <button type="button" className="btn" onClick={close}>{canEdit ? 'Cancel' : 'Close'}</button>
          {canEdit && <button type="button" className="btn btn-primary" onClick={save} disabled={saving || (original && !dirty)}>{saving ? 'Saving…' : original ? 'Save changes' : portal ? 'Add post' : 'Create post'}</button>}
        </div>
      </>}>
      <div className="editor">
        <div className="editor-main">
          {portal && original && original.status === 'In Review' && (
            <div className="decision">
              <h4><Info size={16} />This post is waiting for your approval</h4>
              <textarea className="textarea" style={{ minHeight: 64 }} placeholder="Add a note (required if you request changes)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row wrap">
                <button type="button" className="btn btn-primary" style={{ background: 'var(--success)', borderColor: 'var(--success)' }} onClick={() => decide('approve')} disabled={deciding}><CircleCheck />Approve</button>
                <button type="button" className="btn" onClick={() => decide('changes')} disabled={deciding}><RotateCcw />Request changes</button>
              </div>
            </div>
          )}
          {portal && !original && <div className="notice"><Info /><span>Your post is saved as a <b>Draft</b>, and the agency team is notified by email.</span></div>}
          {portal && !original && data.clients.length > 1 && (
            <Field label="Brand">
              <select className="select" value={draft.clientId} onChange={(e) => set('clientId', e.target.value)}>
                {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Post copy" htmlFor="post-copy">
            {canEdit
              ? <textarea id="post-copy" className="textarea" style={{ minHeight: 140 }} placeholder="Caption, hooks and hashtags…" value={draft.text} onChange={(e) => set('text', e.target.value)} />
              : <div className="card card-pad" style={{ whiteSpace: 'pre-wrap', boxShadow: 'none' }}>{draft.text || <span className="soft">No copy yet</span>}</div>}
          </Field>
          <MediaSection kind="final" items={draft.assets} editable={!portal} clientId={draft.clientId} onChange={(v) => set('assets', v)} onPreview={(a) => setPreview(a.viewUrl)} />
          <MediaSection kind="ref" items={draft.refAssets || []} editable={canEdit} clientId={draft.clientId} onChange={(v) => set('refAssets', v)} onPreview={(a) => setPreview(a.viewUrl)} />
          {!portal && draft.status === 'Published' && (
            <section className="media-sec">
              <h3>Results</h3>
              <Field label="Live post URL"><input className="input" type="url" placeholder="https://" value={draft.liveUrl} onChange={(e) => set('liveUrl', e.target.value)} /></Field>
              <div className="grid grid-4" style={{ gap: 10 }}>
                {['reach', 'likes', 'comments', 'shares'].map((k) => (
                  <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><input className="input num" inputMode="numeric" value={draft.metrics[k]} onChange={(e) => set('metrics', { ...draft.metrics, [k]: e.target.value })} /></Field>
                ))}
              </div>
            </section>
          )}
          {portal && draft.liveUrl && <a href={draft.liveUrl} target="_blank" rel="noopener noreferrer">View the live post</a>}
        </div>

        <div className="editor-side">
          <div className="side-sec">
            <Field label="Status">
              {portal ? <div><StatusPill status={draft.status} label={(columns.find((c) => c.key === stageKey) || {}).name || draft.status} /></div> : (
                <select className="select" value={stageKey} onChange={(e) => {
                  const col = columns.find((c) => c.key === e.target.value);
                  setDraft((d) => ({ ...d, status: col.status, columnId: col.core ? '' : col.id }));
                  setDirty(true);
                }}>
                  {columns.map((c) => <option key={c.key} value={c.key}>{c.core ? c.name : ' ' + c.name + ' (' + c.status + ')'}</option>)}
                </select>
              )}
            </Field>
            <div className="grid grid-2" style={{ gap: 10 }}>
              <Field label="Date"><input className="input" type="date" value={draft.date} disabled={!canEdit} onChange={(e) => set('date', e.target.value)} /></Field>
              <Field label="Time"><input className="input" type="time" value={draft.time} disabled={!canEdit} onChange={(e) => set('time', e.target.value)} /></Field>
            </div>
            {!portal && (
              <Field label="Assignee">
                <select className="select" value={draft.assignee} onChange={(e) => set('assignee', e.target.value)}>
                  <option value="">Unassigned</option>
                  {data.team.map((t) => <option key={t.email} value={t.email}>{t.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Platforms">
              <div className="chip-row">
                {PLATFORMS.map((pl) => {
                  const on = draft.platforms.includes(pl);
                  return <button key={pl} type="button" className={cx('chip', !on && 'off')} style={on ? { background: 'var(--accent-soft)', color: 'var(--accent-text)' } : undefined}
                    aria-pressed={on} disabled={!canEdit} onClick={() => toggle('platforms', pl)}>{pl}</button>;
                })}
              </div>
            </Field>
            <Field label="Tags" hint={!portal && !tagLib.length ? 'Create reusable tags in Settings → Tags.' : undefined}>
              <div className="chip-row">
                {tagLib.map((t) => {
                  const on = draft.tags.some((x) => x.toLowerCase() === t.name.toLowerCase());
                  return <button key={t.id} type="button" className={cx('chip tag', !on && 'off')} style={t.color ? { '--c': t.color } : undefined} aria-pressed={on} disabled={!canEdit} onClick={() => toggleTag(t.name)}>{t.name}</button>;
                })}
                {extraTags.map((t) => (
                  <button key={t} type="button" className="chip tag" disabled={!canEdit} onClick={() => toggleTag(t)} aria-label={'Remove tag ' + t}>{t}{canEdit && <X size={12} />}</button>
                ))}
              </div>
              {canEdit && <input className="input input-sm" placeholder="Add another tag and press Enter" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCustomTag(); } }} />}
            </Field>
          </div>
          {original && (
            <div className="side-sec" style={{ borderBottom: 0, flex: 1 }}>
              {!portal && <Seg value={side} onChange={setSide} label="Discussion" options={[
                { value: 'comments', label: 'Comments (' + comments.length + ')', icon: MessageSquare },
                { value: 'history', label: 'History', icon: History }]} />}
              {portal && <div className="label">Comments ({comments.length})</div>}
              {side === 'comments' || portal ? <Comments post={original} comments={comments} onAdded={onComment} /> : (
                <div className="history">
                  {activity.length === 0 && <div className="soft">No history yet.</div>}
                  {activity.map((a) => (
                    <div key={a.id} className="history-item">
                      <div><b>{a.actor}</b> {a.action}</div>
                      {a.details && <div className="muted" style={{ fontSize: 12.5 }}>{a.details}</div>}
                      <div className="when">{stamp(a.createdAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {preview && <Lightbox src={preview} onClose={() => setPreview('')} />}
    </Modal>
  );
}
