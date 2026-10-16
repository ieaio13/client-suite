import { useState } from 'react';
import { Check, CircleAlert, Clock, Infinity as InfinityIcon, Sparkles } from 'lucide-react';
import { rpc } from '../lib/api.js';
import { useData } from '../data.jsx';
import { go } from '../lib/route.js';
import { cx, shortDate } from '../lib/util.js';
import { useUi } from '../components/ui.jsx';

const limitText = (n, word) => (n === null || n === undefined ? 'Unlimited ' + word : 'Up to ' + n + ' ' + word);

// Thin bar under the top bar while a workspace is on its free trial or has run out.
export function PlanBanner() {
  const { data } = useData();
  const ws = data.workspace;
  if (!ws || ws.unlimited || (!ws.isTrial && !ws.expired)) return null;
  const cta = data.isAdmin && <button type="button" className="btn btn-sm btn-primary" onClick={() => go('settings', 'plan')}>Choose a plan</button>;
  if (ws.expired) {
    return (
      <div className="plan-bar warn" role="status">
        <CircleAlert />
        <span className="grow">{ws.plan === 'paused' ? 'This workspace is paused.' : 'Your free trial has ended.'} Your data is safe, but changes are turned off until you choose a plan.</span>
        {cta}
      </div>
    );
  }
  return (
    <div className="plan-bar" role="status">
      <Clock />
      <span className="grow"><b>Free trial:</b> {ws.daysLeft} {ws.daysLeft === 1 ? 'day' : 'days'} left{ws.trialEndsAt ? ' (ends ' + shortDate(ws.trialEndsAt.slice(0, 10)) + ')' : ''}.</span>
      {cta}
    </div>
  );
}

function Usage({ label, used, max }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="usage">
      <div className="row-between"><span>{label}</span><span className="num muted">{used}{max ? ' / ' + max : ''}</span></div>
      <div className="bar"><span style={{ width: (max ? pct : 4) + '%', background: pct >= 90 ? 'var(--warn)' : 'var(--accent)' }} /></div>
    </div>
  );
}

export default function PlanSettings() {
  const { data, patch } = useData();
  const { toast } = useUi();
  const [busy, setBusy] = useState('');
  const ws = data.workspace || {};
  const plans = data.plans || [];

  const request = async (plan) => {
    setBusy(plan.id);
    try {
      const r = await rpc('requestUpgrade', { plan: plan.id });
      patch((d) => ({ ...d, workspace: { ...d.workspace, requestedPlan: r.requestedPlan } }));
      toast('Request sent for ' + plan.name + '. We will be in touch to activate it.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (<>
    <section className="card">
      <div className="card-head"><h3 className="row"><Sparkles size={16} className="muted" />Your plan</h3>
        <span className={cx('badge', ws.expired ? 'warn' : 'accent')}>{ws.expired ? (ws.plan === 'paused' ? 'Paused' : 'Trial ended') : ws.planName}</span>
      </div>
      <div className="card-pad stack" style={{ gap: 16 }}>
        {ws.unlimited ? (
          <p className="muted row" style={{ margin: 0, fontSize: 14 }}><InfinityIcon size={16} />This is the main workspace: no limits and no expiry.</p>
        ) : (<>
          {ws.isTrial && !ws.expired && <p style={{ margin: 0, fontSize: 14 }}>Your free trial has <b>{ws.daysLeft} {ws.daysLeft === 1 ? 'day' : 'days'}</b> left. During the trial you get the Growth plan's limits.</p>}
          {ws.expired && <p style={{ margin: 0, fontSize: 14 }}>Changes are turned off until a plan is active. Everything you added is kept.</p>}
          <div className="grid grid-2" style={{ gap: 16 }}>
            <Usage label="Active clients" used={ws.usage ? ws.usage.clients : 0} max={ws.limits && ws.limits.clients} />
            <Usage label="Team members" used={ws.usage ? ws.usage.seats : 0} max={ws.limits && ws.limits.seats} />
          </div>
        </>)}
      </div>
    </section>

    {!ws.unlimited && (<>
      <div className="plans">
        {plans.map((p) => {
          const current = ws.plan === p.id;
          const requested = ws.requestedPlan === p.id;
          return (
            <section key={p.id} className={cx('card plan-card', p.popular && 'popular')}>
              {p.popular && <span className="plan-flag">Most popular</span>}
              <h3>{p.name}</h3>
              <p className="muted plan-blurb">{p.blurb}</p>
              <div className="plan-price"><span className="num">${p.price}</span><span className="muted">/ month</span></div>
              <ul className="plan-list">
                <li><Check />{limitText(p.limits.clients, 'clients')}</li>
                <li><Check />{limitText(p.limits.seats, 'team members')}</li>
                {p.features.map((f) => <li key={f}><Check />{f}</li>)}
              </ul>
              {data.isAdmin && (
                <button type="button" className={cx('btn btn-block', p.popular && !current ? 'btn-primary' : '')} disabled={current || requested || busy === p.id} onClick={() => request(p)}>
                  {current ? 'Current plan' : requested ? 'Requested' : busy === p.id ? 'Sending…' : 'Request ' + p.name}
                </button>
              )}
            </section>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Online payment is coming soon. For now, request a plan and it will be activated for you. Prices are in US dollars.</p>
    </>)}
  </>);
}
