import { useEffect, useState } from 'react';
import { useStore } from './lib/store.js';
import { BottomNav } from './components/ui.jsx';
import { useVoiceFlow } from './voice/useVoiceFlow.js';
import Home from './screens/Home.jsx';
import Customers from './screens/Customers.jsx';
import CustomerDetail from './screens/CustomerDetail.jsx';
import Settings from './screens/Settings.jsx';
import Statement from './screens/Statement.jsx';
import Lab from './screens/Lab.jsx';
import { Login, Onboarding } from './screens/Login.jsx';

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [route, id] = h.split('/');
  if (route === 'customers') return { route: 'customers' };
  if (route === 'customer' && id) return { route: 'customer', id };
  if (route === 'settings') return { route: 'settings' };
  if (route === 'statement' && id) return { route: 'statement', id };
  if (route === 'lab') return { route: 'lab' };
  return { route: 'home' };
}

function useHashRoute() {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const on = () => {
      setR(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

const go = (href) => {
  location.hash = href;
};

export default function App() {
  const s = useStore();
  const r = useHashRoute();
  const flow = useVoiceFlow();

  if (!s.ready) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <img src="/icon-192.png" alt="" className="h-20 w-20 animate-pulse rounded-3xl" />
      </div>
    );
  }
  if (s.mode === 'cloud' && !s.session) return <Login />;
  if (s.mode === 'cloud' && !s.shop) return <Onboarding />;

  return (
    <>
      {r.route === 'home' && <Home flow={flow} go={go} />}
      {r.route === 'customers' && <Customers go={go} />}
      {r.route === 'customer' && <CustomerDetail id={r.id} go={go} />}
      {r.route === 'settings' && <Settings go={go} />}
      {r.route === 'statement' && <Statement id={r.id} go={go} />}
      {r.route === 'lab' && <Lab go={go} />}
      <BottomNav route={r.route} go={go} />
    </>
  );
}
