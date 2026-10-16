import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { rpc, session, setAuthExpiredHandler } from './lib/api.js';
import { useLive } from './lib/live.js';
import { DataContext } from './data.jsx';
import { useUi } from './components/ui.jsx';
import { SetupScreen, LoginScreen, CodeScreen } from './auth/Auth.jsx';
import AgencyApp from './agency/AgencyApp.jsx';
import PortalApp from './portal/PortalApp.jsx';

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [codeChallenge, setCodeChallenge] = useState(null);
  const { toast } = useUi();
  const loading = useRef(false);

  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const d = await rpc('boot', {});
      setData(d);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    setAuthExpiredHandler((msg) => {
      session.set('');
      setData((d) => (d ? { mode: 'login', agencyName: d.agencyName || d.settings?.agencyName, authError: msg } : d));
    });
    refresh();
  }, [refresh]);

  const liveMode = useLive(data && (data.mode === 'agency' || data.mode === 'portal') ? data.live : null, refresh);

  const patch = useCallback((fn) => setData((d) => (d ? fn(d) : d)), []);

  if (error && !data) {
    return (
      <div className="auth"><div className="card auth-card">
        <h1>Unable to load</h1>
        <p className="sub">{error}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
      </div></div>
    );
  }
  if (!data) {
    return <div className="auth"><LoaderCircle className="spin" style={{ width: 28, height: 28, color: 'var(--muted)' }} /></div>;
  }

  const onSignedIn = (d) => {
    if (d.sessionToken) session.set(d.sessionToken);
    setCodeChallenge(null);
    setData(d);
  };

  if (codeChallenge) {
    return <CodeScreen agencyName={data.agencyName} challenge={codeChallenge} onDone={onSignedIn}
      onBack={(msg) => { setCodeChallenge(null); setData({ ...data, mode: 'login', authError: msg || '' }); }} />;
  }
  if (data.mode === 'setup') return <SetupScreen agencyName={data.agencyName} onDone={onSignedIn} />;
  if (data.mode === 'login') {
    return <LoginScreen agencyName={data.agencyName} authError={data.authError} onDone={onSignedIn} onNeedsCode={setCodeChallenge} />;
  }

  const ctx = {
    data, refresh, patch, liveMode,
    signOut: async () => {
      try { await rpc('logout', {}); } catch (e) {}
      session.set('');
      setData({ mode: 'login', agencyName: data.settings ? data.settings.agencyName : data.agencyName });
      toast('Signed out');
    }
  };
  return (
    <DataContext.Provider value={ctx}>
      {data.mode === 'portal' ? <PortalApp /> : <AgencyApp />}
    </DataContext.Provider>
  );
}
