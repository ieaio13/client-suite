// Live updates. The server sends a tiny "changed" signal; we then refetch.
// Order of preference: Supabase Realtime (if configured) → Server-Sent Events → polling.
import { useEffect, useRef, useState } from 'react';

const POLL_MS = 10000;

export function useLive(config, onChange) {
  const [mode, setMode] = useState('off'); // 'live' | 'poll' | 'off'
  const cb = useRef(onChange);
  cb.current = onChange;
  const topic = config && config.topic;

  useEffect(() => {
    if (!config || !topic) return undefined;
    let closed = false;
    let es = null;
    let rt = null;
    let pollTimer = null;
    let debounce = null;
    const fire = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { if (!closed) cb.current(); }, 350);
    };
    const startPolling = () => {
      if (closed || pollTimer) return;
      setMode('poll');
      pollTimer = setInterval(() => { if (!document.hidden) cb.current(); }, POLL_MS);
    };
    const stopPolling = () => { clearInterval(pollTimer); pollTimer = null; };

    const startSse = () => {
      if (!window.EventSource) return startPolling();
      let gotHello = false;
      es = new EventSource(config.sse);
      const helloTimer = setTimeout(() => { if (!gotHello) { es.close(); startPolling(); } }, 8000);
      es.addEventListener('hello', () => {
        gotHello = true;
        clearTimeout(helloTimer);
        stopPolling();
        setMode('live');
      });
      es.addEventListener('changed', fire);
      es.onerror = () => {
        if (!gotHello) { clearTimeout(helloTimer); es.close(); startPolling(); }
        else setMode('poll'); // browser retries on its own; refresh on focus covers the gap
      };
    };

    if (config.supabaseUrl && config.anonKey) {
      import('@supabase/realtime-js').then(({ RealtimeClient }) => {
        if (closed) return;
        rt = new RealtimeClient(config.supabaseUrl.replace(/^http/, 'ws') + '/realtime/v1', { params: { apikey: config.anonKey } });
        const ch = rt.channel(topic);
        ch.on('broadcast', { event: 'changed' }, fire).subscribe((status) => {
          if (status === 'SUBSCRIBED') setMode('live');
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { if (!es) startSse(); }
        });
      }).catch(startSse);
      // SSE as well, in case the realtime service isn't reachable from this network.
      startSse();
    } else {
      startSse();
    }

    const onFocus = () => { if (!document.hidden) cb.current(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      closed = true;
      clearTimeout(debounce);
      stopPolling();
      if (es) es.close();
      if (rt) rt.disconnect();
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [topic]); // eslint-disable-line react-hooks/exhaustive-deps

  return mode;
}
