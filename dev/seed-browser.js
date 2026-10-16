// Fills a fresh preview with sample data. Runs in the browser (it draws sample images
// with <canvas>) and talks only to the public API, so it works with any frontend.
// Returns { adminEmail, sessionToken, deviceToken, portalEdit, portalView }.
async function seedPreview() {
  async function rpc(action, auth, payload) {
    const r = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, auth, payload }) });
    const j = await r.json();
    if (!j.ok) throw new Error(action + ': ' + j.error);
    return j.data;
  }
  const email = 'preview-admin@example.test';
  const setup = await rpc('setupAdmin', {}, { setupCode: 'preview-setup-code', name: 'Arjun Karki', email, password: 'Preview-' + Math.random().toString(36).slice(2, 12), deviceLabel: 'Preview' });
  const A = { sessionToken: setup.sessionToken };
  const mk = async (name, parentId, color, notifyEmail) => (await rpc('saveClient', A, { name, parentId, color, notifyEmail })).client;
  const acme = await mk('Acme Group', '', '#3b82f6', 'marketing@acme.example');
  const zeta = await mk('Zeta Foods', '', '#22c55e', 'hello@zeta.example');
  const coffee = await mk('Acme Coffee', acme.id, '#f97316');
  const tea = await mk('Acme Tea', acme.id, '#a855f7');
  const bakery = await mk('Zeta Bakery', zeta.id, '#ec4899');
  const deli = await mk('Zeta Deli', zeta.id, '#14b8a6');
  await rpc('saveTags', A, { tags: [
    { name: 'Launch', color: '#3b82f6' }, { name: 'Reel', color: '#a855f7' }, { name: 'Offer', color: '#f59e0b' },
    { name: 'Behind the scenes', color: '#14b8a6' }, { name: 'Festival', color: '#ef4444' }
  ] });

  async function img(c1, c2, label) {
    const cv = document.createElement('canvas');
    cv.width = 800; cv.height = 800;
    const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 800, 800);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.fillRect(0, 0, 800, 800);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.beginPath(); g.arc(620, 180, 220, 0, 7); g.fill();
    g.beginPath(); g.arc(150, 680, 160, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.fillText(label, 400, 420);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    return new File([blob], label.replace(/\W+/g, '-') + '.png', { type: 'image/png' });
  }
  async function upload(clientId, file, auth) {
    const res = await rpc('createUpload', auth || A, { clientId, name: file.name, mimeType: file.type, size: file.size });
    const fd = new FormData();
    fd.append('cacheControl', '3600');
    fd.append('', file);
    await fetch(res.uploadUrl, { method: 'PUT', body: fd });
    return res.asset;
  }
  const today = setup.today;
  const D = (n) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  const plan = [
    [coffee, 'Autumn menu launch — pumpkin spice is back for the season.', 'In Review', 0, ['Launch', 'Reel'], ['#f97316', '#b45309', 'Autumn Menu'], ['#fde68a', '#f59e0b', 'Moodboard']],
    [coffee, 'Barista tips: how to pour the perfect flat white at home.', 'Draft', 2, ['Reel'], null, ['#a16207', '#422006', 'Ref: Latte art']],
    [coffee, 'Weekend 2-for-1 on all lattes, Saturday and Sunday only.', 'Approved', 4, ['Offer'], ['#f59e0b', '#ef4444', '2 for 1'], null],
    [coffee, 'Inside our roastery: from green bean to your cup.', 'Scheduled', 6, ['Behind the scenes'], ['#78350f', '#1c1917', 'Roastery'], null],
    [coffee, 'Thank you for 10k followers!', 'Published', -3, ['Launch'], ['#3b82f6', '#a855f7', '10K!'], null],
    [coffee, 'Dashain greetings from all of us at Acme Coffee.', 'Draft', 9, ['Festival'], null, null],
    [coffee, 'New oat-milk options now in every store.', 'In Review', 11, ['Launch'], ['#84cc16', '#15803d', 'Oat Milk'], null],
    [tea, 'Masala chai week starts Monday.', 'In Review', 1, ['Launch'], ['#a855f7', '#ec4899', 'Chai Week'], null],
    [tea, 'How we pick our Ilam tea leaves.', 'Approved', 5, ['Behind the scenes'], ['#16a34a', '#065f46', 'Ilam Tea'], null],
    [bakery, 'Fresh croissants every morning.', 'Scheduled', 3, ['Offer'], ['#ec4899', '#f97316', 'Croissants'], null],
    [deli, 'New sandwich menu drops Friday.', 'Draft', 7, ['Launch'], ['#14b8a6', '#0ea5e9', 'Deli Menu'], null]
  ];
  for (const [cl, text, status, off, tags, fin, ref] of plan) {
    const assets = fin ? [await upload(cl.id, await img(fin[0], fin[1], fin[2]))] : [];
    const refAssets = ref ? [await upload(cl.id, await img(ref[0], ref[1], ref[2]))] : [];
    await rpc('savePost', A, { clientId: cl.id, text, status, tags, platforms: ['Instagram', 'Facebook'], date: D(off), time: '10:00', assets, refAssets });
  }
  const boot = await rpc('boot', A, {});
  const autumn = boot.posts.find((p) => p.text.startsWith('Autumn'));
  await rpc('addComment', A, { postId: autumn.id, text: 'Copy is final. Waiting on the client to approve.' });
  await rpc('saveInvoice', A, { clientId: acme.id, items: [{ description: 'Monthly social media retainer (Coffee + Tea)', qty: '1', rate: '65000' }], taxPct: '13', notes: 'Thank you!' });
  await rpc('saveInvoice', A, { clientId: zeta.id, items: [{ description: 'Launch campaign', qty: '1', rate: '30000' }], issueDate: D(-30), dueDate: D(-10) });
  const editLink = await rpc('manageClientToken', A, { clientId: acme.id, mode: 'create', access: 'edit' });
  const viewLink = await rpc('manageClientToken', A, { clientId: zeta.id, mode: 'create', access: 'view' });
  return {
    adminEmail: email,
    sessionToken: setup.sessionToken,
    deviceToken: setup.deviceToken,
    portalEdit: '/app?t=' + editLink.token,
    portalView: '/app?t=' + viewLink.token
  };
}
