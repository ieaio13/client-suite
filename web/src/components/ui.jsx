import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Eye, EyeOff, Info, Monitor, Moon, Sun, X } from 'lucide-react';
import { cx, initials, statusClass } from '../lib/util.js';

/* ---------- Small pieces ---------- */

export function StatusPill({ status, label }) {
  return <span className={cx('pill', statusClass(status))}>{label || status}</span>;
}

export function TagChip({ name, color }) {
  return <span className="chip tag" style={color ? { '--c': color } : undefined}>{name}</span>;
}

export function Dot({ color, size }) {
  return <span className="dot" aria-hidden="true" style={{ background: color || undefined, width: size, height: size }} />;
}

export function Avatar({ person, large }) {
  const url = person && person.avatarUrl;
  return (
    <span className={cx('avatar', large && 'lg')} aria-hidden="true">
      {url ? <img src={url} alt="" /> : initials(person && person.name)}
    </span>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="empty">
      {Icon && <Icon />}
      {title && <strong>{title}</strong>}
      {children && <div>{children}</div>}
    </div>
  );
}

export function Seg({ value, onChange, options, label }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <o.icon />}<span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete, placeholder, required, minLength }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-group">
      <input id={id} className="input" style={{ paddingRight: 42 }} type={show ? 'text' : 'password'} value={value} onChange={onChange}
        autoComplete={autoComplete} placeholder={placeholder} required={required} minLength={minLength} />
      <button type="button" className="btn btn-ghost btn-icon btn-sm input-action" onClick={() => setShow(!show)}
        aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

export function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/* ---------- Theme ---------- */

const THEME_KEY = 'cocs_theme';
function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
}
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}

export function ThemeButton() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const next = () => {
    const order = ['system', 'light', 'dark'];
    const t = order[(order.indexOf(theme) + 1) % order.length];
    try { if (t === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch (e) {}
    setTheme(t);
  };
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const label = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Auto';
  return (
    <button type="button" className="btn btn-ghost btn-icon" onClick={next} title={'Theme: ' + label + ' (click to change)'} aria-label={'Theme: ' + label + '. Click to change.'}>
      <Icon />
    </button>
  );
}

/* ---------- Modal ---------- */

export function Modal({ title, subtitle, onClose, children, footer, size, dismissable = true }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, dismissable]);
  // Rendered at the end of <body> so animated page sections can't trap the overlay.
  return createPortal(
    <div className="modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissable) onClose(); }}>
      <div className={cx('modal', size)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        {title !== undefined && (
          <div className="modal-head">
            <div className="grow">
              <h2>{title}</h2>
              {subtitle}
            </div>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close"><X /></button>
          </div>
        )}
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ---------- Popover ---------- */

export function Popover({ trigger, children, align, pad, open: controlled, onOpenChange }) {
  const [inner, setInner] = useState(false);
  const open = controlled !== undefined ? controlled : inner;
  const setOpen = (v) => { if (onOpenChange) onOpenChange(v); else setInner(v); };
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pop-anchor" ref={ref}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && <div className={cx('popover', align === 'left' && 'left', pad && 'pad')}>{typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}</div>}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, onClick, danger }) {
  return (
    <button type="button" className={cx('menu-item', danger && 'danger')} onClick={onClick}>
      {Icon && <Icon />}<span className="grow">{children}</span>
    </button>
  );
}

export function Lightbox({ src, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(<div className="lightbox" onClick={onClose} role="dialog" aria-label="Image preview"><img src={src} alt="" /></div>, document.body);
}

/* ---------- Toasts & confirm dialogs ---------- */

const UiContext = createContext(null);
export const useUi = () => useContext(UiContext);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const toast = useCallback((message, type) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => t.concat([{ id, message, type: type || 'info' }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6500 : 4000);
  }, []);
  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ ...opts, resolve });
  }), []);
  const close = (v) => { dialog.resolve(v); setDialog(null); };
  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.type === 'success' ? CircleCheck : t.type === 'error' ? CircleAlert : Info;
          return (
            <div key={t.id} className={cx('toast', t.type)}>
              <Icon /><span>{t.message}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X size={15} /></button>
            </div>
          );
        })}
      </div>
      {dialog && (
        <Modal title={dialog.title} onClose={() => close(false)}
          footer={<><span /><div className="row">
            <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
            <button type="button" className={cx('btn', dialog.danger ? 'btn-danger' : 'btn-primary')} onClick={() => close(true)} autoFocus>{dialog.confirmLabel || 'Confirm'}</button>
          </div></>}>
          <div className="modal-body"><p style={{ margin: 0, color: 'var(--text-2)' }}>{dialog.message}</p></div>
        </Modal>
      )}
    </UiContext.Provider>
  );
}
