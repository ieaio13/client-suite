import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Send, X } from 'lucide-react';
import { rpc, uploadFile } from '../lib/api.js';
import { Avatar, Lightbox, useUi } from '../components/ui.jsx';
import { stamp } from '../lib/util.js';

// Comment thread with image attachments (clients can attach images too).
export default function Comments({ post, comments, onAdded }) {
  const { toast } = useUi();
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]); // uploaded assets not yet posted
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState('');
  const input = useRef(null);

  const attach = async (files) => {
    const list = Array.from(files || []).filter((f) => f.type.indexOf('image/') === 0);
    if (!list.length) return;
    setUploading(true);
    let next = pending;
    for (const f of list.slice(0, 6 - pending.length)) {
      try {
        const r = await uploadFile(f, { clientId: post.clientId, purpose: 'comment' });
        next = next.concat([r.asset]);
        setPending(next);
      } catch (e) {
        toast(e.message, 'error');
      }
    }
    setUploading(false);
  };
  const send = async () => {
    if (sending || uploading || (!text.trim() && !pending.length)) return;
    setSending(true);
    try {
      const r = await rpc('addComment', { postId: post.id, text: text.trim(), attachments: pending });
      setText('');
      setPending([]);
      onAdded(r.comment, r.activity);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="stack">
      <div className="comments">
        {comments.length === 0 && <div className="soft" style={{ fontSize: 13 }}>No comments yet. Start the conversation below.</div>}
        {comments.map((c) => (
          <div key={c.id} className="comment">
            <Avatar person={{ name: c.author }} />
            <div className="bubble">
              <div className="who"><span><b>{c.author}</b>{c.role ? ' · ' + c.role : ''}</span><span>{stamp(c.createdAt)}</span></div>
              {c.text && <div className="txt">{c.text}</div>}
              {c.attachments && c.attachments.length > 0 && (
                <div className="imgs">
                  {c.attachments.map((a) => (
                    <button key={a.id} type="button" onClick={() => setPreview(a.viewUrl)} aria-label="View image"><img src={a.thumbUrl} alt="" loading="lazy" /></button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="composer" onPaste={(e) => { const fs = Array.from(e.clipboardData.files || []); if (fs.length) { e.preventDefault(); attach(fs); } }}>
        <textarea placeholder="Write a comment…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Write a comment"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
        {pending.length > 0 && (
          <div className="pending-imgs">
            {pending.map((a, i) => (
              <span key={a.id} className="p"><img src={a.thumbUrl} alt="" />
                <button type="button" onClick={() => setPending(pending.filter((_, k) => k !== i))} aria-label="Remove image"><X /></button></span>
            ))}
          </div>
        )}
        <div className="bar2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current && input.current.click()} disabled={uploading || pending.length >= 6}>
            {uploading ? <LoaderCircle className="spin" /> : <ImagePlus />}Add image
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={sending || uploading || (!text.trim() && !pending.length)}><Send />Send</button>
        </div>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { attach(e.target.files); e.target.value = ''; }} />
      </div>
      {preview && <Lightbox src={preview} onClose={() => setPreview('')} />}
    </div>
  );
}
