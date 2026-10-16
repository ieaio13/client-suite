// Plans, prices and limits. Edit here: the pricing section on the homepage, the
// Plan page in Settings and the limits the server enforces all read this file.
// A limit of null means unlimited. "clients" counts every active (not archived)
// client, main clients and sub-clients alike.

export const TRIAL_DAYS = 14;
export const PRICE_CURRENCY = 'USD';

export const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 19,
    blurb: 'For freelancers and small studios.',
    limits: { clients: 10, seats: 2 },
    features: ['Content calendar, board and table', 'Client portal links with approvals', 'Invoices with PDF and email', 'Live updates']
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 49,
    blurb: 'For growing agencies with a team.',
    popular: true,
    limits: { clients: 40, seats: 8 },
    features: ['Everything in Starter', 'Custom board columns', 'Client links with edit access', 'Tag library and roles']
  },
  {
    id: 'agency',
    name: 'Agency',
    price: 99,
    blurb: 'For established agencies.',
    limits: { clients: null, seats: 25 },
    features: ['Everything in Growth', 'Priority support', 'Help moving your existing content in']
  }
];

// Plans that aren't sold: the free trial (Growth limits), your own workspace
// (unlimited, never expires) and a paused workspace (read-only).
const INTERNAL = {
  trial: { id: 'trial', name: 'Free trial', limits: PLANS[1].limits },
  owner: { id: 'owner', name: 'Unlimited', limits: { clients: null, seats: null } },
  paused: { id: 'paused', name: 'Paused', limits: PLANS[1].limits }
};

export function planById(id) {
  return PLANS.find((p) => p.id === id) || INTERNAL[id] || INTERNAL.trial;
}

// What the app needs to know about a workspace's plan right now.
export function planState(ws, now = Date.now()) {
  const plan = planById(ws && ws.plan);
  const isTrial = plan.id === 'trial';
  const endsAt = isTrial && ws.trial_ends_at ? new Date(ws.trial_ends_at).getTime() : 0;
  const daysLeft = isTrial && endsAt ? Math.max(0, Math.ceil((endsAt - now) / 86400000)) : null;
  const expired = plan.id === 'paused' || (isTrial && endsAt > 0 && endsAt <= now);
  return {
    plan: plan.id,
    planName: plan.name,
    isTrial,
    trialEndsAt: isTrial ? ws.trial_ends_at || '' : '',
    daysLeft,
    expired,
    unlimited: plan.id === 'owner',
    limits: plan.limits,
    requestedPlan: (ws && ws.requested_plan) || ''
  };
}

export function publicPlans() {
  return PLANS.map((p) => ({ ...p, currency: PRICE_CURRENCY }));
}
