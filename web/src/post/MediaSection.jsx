import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleCheck, ImagePlus, Images, Link, LoaderCircle, Play, Trash2 } from 'lucide-react';
import { rpc, uploadFile } from '../lib/api.js';
import { useUi } from '../components/ui.jsx';
import { cx, formatBytes } from '../lib/util.js';

// One media area: 'ref' (reference images) or 'final' (finished design).
export default function MediaSection({ kind, items, onChange, editable, clientId, onPreview }) {
  const { toast } = useUi();
  const input = useRef(null);
  const [busy, setBusy] = useState('');
  const [drag, setDrag] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const isFinal = kind === 'final';

  const addFiles = async (files) => {
    const list = Array.from(files || []);
    let current = items;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setBusy((list.length > 1 ? (i + 1) + '/' + list.length + ' ' : '') + 'Uploading…');
      try {
        const r = await uploadFile(f, { clientId });
        if (r.after < r.before) toast('Compressed ' + f.name + ': ' + formatBytes(r.before) + ' → ' + formatBytes(r.after), 'success');
        current = current.concat([r.asset]);
        onChange(current);
      } catch (e) {
        toast(e.message, 'error');
      }
    }
    setBusy('');
  };
  const addLink = async () => {
    if (!link.trim()) return;
    try {
      const r = await rpc('resolveDriveLink', { url: link.trim() });
      onChange(items.concat([r.asset]));
      setLink('');
      setLinkOpen(false);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const Icon = isFinal ? CircleCheck : Images;
  return (
    <section className={cx('media-sec', isFinal && 'final')}
      onPaste={editable ? (e) => { const fs = Array.from(e.clipboardData.files || []); if (fs.length) { e.preventDefault(); addFiles(fs); } } : undefined}>
      <div className="row-between">
        <h3><Icon />{isFinal ? 'Final design' : 'Reference images'}{items.length > 0 && <span className="badge">{items.length}</span>}</h3>
        {editable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinkOpen(!linkOpen)}><Link />Add from link</button>}
      </div>
      <div className="hint" style={{ marginTop: -4 }}>
        {isFinal ? 'The finished artwork, uploaded once the work is done. This is what the client approves.' : 'Brief, inspiration, logos or photos to work from.'}
        {editable && ' Photos are compressed automatically (max 20 MB).'}
      </div>
      {linkOpen && (
        <div className="row">
          <input className="input input-sm grow" placeholder="Paste a Google Drive link (shared as “Anyone with the link”)" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }} autoFocus />
          <button type="button" className="btn btn-sm" onClick={addLink}>Add</button>
        </div>
      )}
      {(items.length > 0 || editable) ? (
        <div className="media-grid">
          {items.map((a, i) => (
            <div key={a.id + i} className="media-item">
              {a.thumbUrl ? (
                <button type="button" style={{ padding: 0, border: 0, width: '100%', height: '100%', cursor: 'zoom-in' }} onClick={() => onPreview(a)} aria-label={'Preview ' + a.name}>
                  <img src={a.thumbUrl} alt={a.name} />
                </button>
              ) : (
                <a className="vid" href={a.viewUrl} target="_blank" rel="noopener noreferrer" aria-label={'Open ' + a.name}><Play size={22} /></a>
              )}
              {editable && (
                <div className="acts">
                  <span className="row" style={{ gap: 4 }}>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier"><ChevronLeft /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move later"><ChevronRight /></button>
                  </span>
                  <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label="Remove"><Trash2 /></button>
                </div>
              )}
            </div>
          ))}
          {editable && (
            <button type="button" className={cx('upload-tile', drag && 'drag', busy && 'busy')} disabled={Boolean(busy)}
              onClick={() => input.current && input.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
              {busy ? <LoaderCircle className="spin" /> : <ImagePlus />}
              <span>{busy || 'Upload, drop or paste'}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="soft" style={{ fontSize: 13 }}>{isFinal ? 'The final design hasn’t been uploaded yet.' : 'No reference images.'}</div>
      )}
      <input ref={input} type="file" multiple accept="image/*,video/*" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
    </section>
  );
}
