import { useState } from 'react';

// Whether the right summary panel is open (remembered; closed by default on small screens).
export function usePanel() {
  const [open, setOpenState] = useState(() => {
    try {
      const v = localStorage.getItem('cf_panel');
      if (v) return v === '1';
    } catch (e) {}
    return window.innerWidth > 1180;
  });
  const setOpen = (v) => {
    setOpenState(v);
    try { localStorage.setItem('cf_panel', v ? '1' : '0'); } catch (e) {}
  };
  return [open, setOpen];
}
