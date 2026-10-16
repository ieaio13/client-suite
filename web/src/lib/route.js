// Tiny hash router so the current page survives a refresh: #/client/abc/board
import { useEffect, useState } from 'react';

function parse() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  return { page: parts[0] || '', id: parts[1] || '', sub: parts[2] || '' };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(...parts) {
  const next = '#/' + parts.filter(Boolean).map(encodeURIComponent).join('/');
  if (window.location.hash !== next) window.location.hash = next;
}
