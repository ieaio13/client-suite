import { Menu } from 'lucide-react';
import { Logo } from '../auth/Auth.jsx';
import { ThemeButton } from './ui.jsx';
import { cx } from '../lib/util.js';

export function LiveBadge({ mode }) {
  const label = mode === 'live' ? 'Live' : mode === 'poll' ? 'Syncing' : 'Offline';
  const title = mode === 'live' ? 'Changes appear instantly' : mode === 'poll' ? 'Checking for changes every few seconds' : 'Not receiving live updates';
  return <span className={cx('live', mode === 'poll' && 'poll', mode === 'off' && 'off')} title={title} aria-label={title}><i />{label}</span>;
}

export function TopBar({ name, nav, right, onMenu }) {
  return (
    <header className="topbar">
      <div className="row" style={{ minWidth: 0 }}>
        {onMenu && <button type="button" className="btn btn-ghost btn-icon only-mobile" onClick={onMenu} aria-label="Open menu"><Menu /></button>}
        <span className="brand"><Logo />{name && name !== 'Flokey' && <><span className="brand-sep hide-mobile" aria-hidden="true" /><span className="hide-mobile ellipsis brand-name" style={{ maxWidth: 220 }}>{name}</span></>}</span>
        {nav}
      </div>
      <div className="row">{right}<ThemeButton /></div>
    </header>
  );
}
