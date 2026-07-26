/* app.js — views, chat flow, and friend lifecycle. */

const AVATAR_COLORS = ['#7c6cff', '#4dc6a8', '#ff8fb3', '#ffb454', '#5aa9ff', '#ff5d73', '#9b59b6', '#2ecc71'];

const $ = (sel) => document.querySelector(sel);
const views = ['view-friends', 'view-gallery', 'view-customize', 'view-editor', 'view-chat', 'view-relationship', 'view-settings'];

let currentFriend = null;       // friend object while chatting/editing
let editingId = null;           // friend id being edited, null = creating
let customizeTemplate = null;   // persona template on the customize screen
let sending = false;

/* ---------------- helpers ---------------- */

function showView(id) {
  views.forEach(v => $('#' + v).classList.toggle('hidden', v !== id));
}

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function uid() {
  return ClaudeAPI._now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function initials(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

function fmtClock(t) {
  return new Date(t || ClaudeAPI._now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

let clockTimer = null;
function updateChatClock() {
  const el = $('#chat-status');
  // never stomp transient states (typing…, reconnecting…)
  if (el.textContent === '' || /[AP]M|^\d/.test(el.textContent)) el.textContent = fmtClock();
}

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'Today ' + time;
  if (diffDays === 1) return 'Yesterday ' + time;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + time;
}

/* ---------------- friends list ---------------- */

async function renderFriendsList() {
  const friends = await DB.listFriends();
  friends.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  const list = $('#friends-list');
  list.innerHTML = '';
  $('#friends-empty').classList.toggle('hidden', friends.length > 0);

  for (const f of friends) {
    const item = document.createElement('div');
    item.className = 'friend-item';
    const badge = f.profile.type === 'romantic'
      ? '<span class="friend-badge romantic">romance</span>'
      : (f.profile.type === 'close_friend' ? '<span class="friend-badge">close</span>' : '');
    item.innerHTML = `
      <div class="avatar" style="background:${f.profile.color}">${initials(f.profile.name)}</div>
      <div class="friend-meta">
        <div class="friend-name">${escapeHtml(f.profile.name)}${badge}</div>
        <div class="friend-preview">${escapeHtml(f.lastPreview || 'Say hi 👋')}</div>
      </div>`;
    item.addEventListener('click', () => openChat(f.id));
    list.appendChild(item);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- new message: template gallery ---------------- */

function openGallery() {
  const grid = $('#template-gallery');
  grid.innerHTML = '';
  for (const t of Personas.templates) {
    const card = document.createElement('div');
    card.className = 'template-card';
    const badgeClass = t.type === 'romantic' ? 'friend-badge romantic' : 'friend-badge';
    card.innerHTML = `
      <div class="avatar" style="background:${t.color}">${initials(t.name)}</div>
      <div class="tpl-meta">
        <div class="tpl-name">${escapeHtml(t.name)} <span class="tpl-age">${t.age}</span><span class="${badgeClass}">${escapeHtml(t.tag)}</span></div>
        <div class="tpl-hook">${escapeHtml(t.hook)}</div>
      </div>`;
    card.addEventListener('click', () => openCustomize(t));
    grid.appendChild(card);
  }
  const blank = document.createElement('div');
  blank.className = 'template-card blank';
  blank.id = 'tpl-blank';
  blank.innerHTML = `
    <div class="avatar" style="background:var(--bg3)">+</div>
    <div class="tpl-meta">
      <div class="tpl-name">Blank / custom</div>
      <div class="tpl-hook">Build someone from scratch with the full editor.</div>
    </div>`;
  blank.addEventListener('click', () => openEditor(null));
  grid.appendChild(blank);
  showView('view-gallery');
}

/* ---------------- new message: customize ---------------- */

const SLIDER_DEFS = [
  { key: 'closeness', label: 'Closeness', low: 'strangers', high: 'inseparable' },
  { key: 'flirtiness', label: 'Flirtiness', low: 'none', high: 'shameless' },
  { key: 'warmth', label: 'Warmth', low: 'reserved', high: 'cute' },
  { key: 'confidence', label: 'Confidence', low: 'unsure', high: 'bulletproof' },
  { key: 'attraction', label: 'Attraction', low: 'not yet', high: 'already hers', romanticOnly: true }
];

function renderSliders(t) {
  const wrap = $('#c-sliders');
  wrap.innerHTML = '';
  for (const def of SLIDER_DEFS) {
    if (def.romanticOnly && t.type !== 'romantic') continue;
    const val = def.key in t.sliders ? t.sliders[def.key] : 50;
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.innerHTML = `
      <div class="slider-head"><span>${def.label}</span><span class="slider-val">${val}</span></div>
      <input type="range" min="0" max="100" value="${val}" id="sl-${def.key}">
      <div class="slider-ends"><span>${def.low}</span><span>${def.high}</span></div>`;
    const input = row.querySelector('input');
    input.addEventListener('input', () => { row.querySelector('.slider-val').textContent = input.value; });
    wrap.appendChild(row);
  }
}

function readSliders(t) {
  const out = Object.assign({}, t.sliders);
  for (const def of SLIDER_DEFS) {
    const el = document.getElementById('sl-' + def.key);
    if (el) out[def.key] = parseInt(el.value, 10) || 0;
  }
  return out;
}

function openCustomize(t) {
  customizeTemplate = t;
  $('#customize-title').textContent = t.name;
  $('#c-avatar').textContent = initials(t.name);
  $('#c-avatar').style.background = t.color;
  $('#c-hook').textContent = t.hook;
  $('#c-name').value = t.name;
  $('#c-age').value = t.age;
  $('#c-username').value = localStorage.getItem('frenz-user-name') || '';
  $('#c-usergender').value = localStorage.getItem('frenz-user-gender') || 'male';
  $('#c-personality').value = t.personality;
  $('#c-interests').value = t.interests;
  $('#c-style').value = t.style;
  $('#c-backstory').value = t.backstory;
  renderSliders(t);
  showView('view-customize');
}

async function startConversation(e) {
  e.preventDefault();
  const t = customizeTemplate;
  if (!t) return;
  const name = $('#c-name').value.trim();
  if (!name) { toast('Give her a name'); return; }

  const sliders = readSliders(t);
  // Flirtiness/warmth/confidence get woven into her personality and texting
  // style so they change how she actually behaves, not just numbers in a field.
  const notes = Personas.sliderText(sliders);
  const personality = $('#c-personality').value.trim();
  const style = $('#c-style').value.trim();

  const profile = {
    name,
    type: t.type,
    age: parseInt($('#c-age').value, 10) || t.age,
    gender: t.gender,
    personality: (personality ? personality + ' ' : '') + notes.personality,
    interests: $('#c-interests').value.trim(),
    style: (style ? style + ' ' : '') + notes.style,
    backstory: $('#c-backstory').value.trim(),
    userName: $('#c-username').value.trim(),
    userGender: $('#c-usergender').value,
    plist: t.plist || '',
    reveals: t.reveals || [],
    color: t.color
  };
  localStorage.setItem('frenz-user-name', profile.userName);
  localStorage.setItem('frenz-user-gender', profile.userGender);

  const friend = {
    id: uid(),
    profile,
    // closeness/attraction seed the private state directly from the sliders
    state: {
      mood: t.mood || 'curious, easygoing',
      comfort: Math.min(95, sliders.closeness + 15),
      closeness: sliders.closeness,
      attraction: sliders.attraction || 0,
      opinion_notes: t.opinion || 'Just starting to get to know them. No strong impressions yet.'
    },
    memories: [],
    createdAt: ClaudeAPI._now(),
    lastActivity: ClaudeAPI._now(),
    lastPreview: ''
  };

  // Her opening text seeds the register — the model picks up style and length
  // from the first message more than from anything else.
  const greeting = t.greeting || [];
  if (greeting.length) friend.lastPreview = greeting[greeting.length - 1];
  await DB.saveFriend(friend);
  for (const g of greeting) {
    await DB.addMessage({ friendId: friend.id, role: 'assistant', text: g, ts: ClaudeAPI._now() });
  }
  await renderFriendsList();
  customizeTemplate = null;
  openChat(friend.id);
}

/* ---------------- friend editor ---------------- */

function renderColorPicker(selected) {
  const wrap = $('#f-colors');
  wrap.innerHTML = '';
  AVATAR_COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'color-dot' + (c === selected ? ' selected' : '');
    dot.style.background = c;
    dot.addEventListener('click', () => {
      wrap.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
      dot.dataset.selected = 'true';
      wrap.dataset.color = c;
    });
    wrap.appendChild(dot);
  });
  wrap.dataset.color = selected;
}

function openEditor(friend) {
  editingId = friend ? friend.id : null;
  $('#editor-title').textContent = friend ? 'Edit friend' : 'New friend';
  $('#btn-save-friend').textContent = friend ? 'Save changes' : 'Create friend';
  $('#btn-delete-friend').classList.toggle('hidden', !friend);

  const p = friend ? friend.profile : {};
  $('#f-name').value = p.name || '';
  $('#f-type').value = p.type || 'friend';
  $('#f-age').value = p.age || 25;
  $('#f-gender').value = p.gender || '';
  $('#f-personality').value = p.personality || '';
  $('#f-plist').value = p.plist || '';
  $('#f-interests').value = p.interests || '';
  $('#f-style').value = p.style || '';
  $('#f-backstory').value = p.backstory || '';
  $('#f-username').value = p.userName || '';
  $('#f-usergender').value = p.userGender || 'male';
  renderColorPicker(p.color || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
  showView('view-editor');
}

async function saveFriendFromForm(e) {
  e.preventDefault();
  const type = $('#f-type').value;
  const profile = {
    name: $('#f-name').value.trim(),
    type,
    age: parseInt($('#f-age').value, 10) || null,
    gender: $('#f-gender').value.trim(),
    personality: $('#f-personality').value.trim(),
    plist: $('#f-plist').value.trim(),
    interests: $('#f-interests').value.trim(),
    style: $('#f-style').value.trim(),
    backstory: $('#f-backstory').value.trim(),
    userName: $('#f-username').value.trim(),
    userGender: $('#f-usergender').value,
    color: $('#f-colors').dataset.color || AVATAR_COLORS[0]
  };
  if (!profile.name) { toast('Give them a name'); return; }

  let friend;
  if (editingId) {
    friend = await DB.getFriend(editingId);
    // MERGE, never replace: the form covers only some fields — a wholesale
    // swap silently destroyed reveals, sliders, and greetings on every edit.
    Object.assign(friend.profile, profile);
  } else {
    friend = {
      id: uid(),
      profile,
      // starting private state — a new acquaintance, warmer if "close friend"
      state: {
        mood: 'curious, easygoing',
        comfort: type === 'close_friend' ? 70 : 35,
        closeness: type === 'close_friend' ? 65 : 15,
        attraction: type === 'romantic' ? 15 : 0,
        opinion_notes: 'Just starting to get to know them. No strong impressions yet.'
      },
      memories: [],
      createdAt: ClaudeAPI._now(),
      lastActivity: ClaudeAPI._now(),
      lastPreview: ''
    };
  }
  await DB.saveFriend(friend);
  await renderFriendsList();
  if (editingId) {
    toast('Saved — takes effect on her next reply.');
    openChat(friend.id);
  } else {
    showView('view-friends');
  }
  editingId = null;
}

/* ---------------- chat ---------------- */

async function openChat(friendId) {
  currentFriend = await DB.getFriend(friendId);
  if (!currentFriend) return;
  const p = currentFriend.profile;
  $('#chat-name').textContent = p.name;
  $('#chat-avatar').textContent = initials(p.name);
  $('#chat-avatar').style.background = p.color;
  $('#chat-status').textContent = fmtClock();
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(updateChatClock, 30000);
  await renderMessages();
  showView('view-chat');
  scrollChat(false);
  maybeOpener(currentFriend);
}

/* ---------------- relationship graph (tap her name in chat) ----------------
   The state-delta ledger is replayed into per-element time series: newer
   events carry absolute `after` values; older ones are reconstructed by
   walking their `applied` deltas backward from the current state. */

const REL_DIMS = [
  { key: 'closeness', label: 'Closeness', color: '#5aa9ff' },
  { key: 'comfort', label: 'Comfort', color: '#4dc6a8' },
  { key: 'attraction', label: 'Attraction', color: '#ff8fb3' },
  { key: 'tension', label: 'Tension', color: '#ffb454' }
];
let relSelected = null; // highlighted dim key, null = all

function relSeries(friend, events) {
  const clamp = v => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const evs = (events || [])
    .filter(e => e && (e.after || e.applied || typeof e.tension === 'number') && e.ts)
    .sort((a, b) => a.ts - b.ts)
    .slice(-400);
  const cur = friend.state || {};
  const nowPt = { ts: ClaudeAPI._now(), closeness: clamp(cur.closeness), comfort: clamp(cur.comfort), attraction: clamp(cur.attraction), tension: clamp(cur.tension) };
  let vals = Object.assign({}, nowPt);
  const pts = new Array(evs.length);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e.after) {
      vals = { closeness: clamp(e.after.closeness), comfort: clamp(e.after.comfort), attraction: clamp(e.after.attraction), tension: clamp(e.after.tension) };
    } else if (typeof e.tension === 'number') {
      vals = Object.assign({}, vals, { tension: clamp(e.tension) });
    }
    pts[i] = Object.assign({ ts: e.ts }, vals);
    const ap = e.applied || {};
    vals = {
      closeness: clamp(vals.closeness - (ap.closeness || 0)),
      comfort: clamp(vals.comfort - (ap.comfort || 0)),
      attraction: clamp(vals.attraction - (ap.attraction || 0)),
      tension: vals.tension
    };
  }
  // prepend where she STARTED (state before the first event) — otherwise a
  // climb that happened on day one never renders as a slope
  if (evs.length) pts.unshift(Object.assign({ ts: evs[0].ts - 60000 }, vals));
  pts.push(nowPt);
  return pts;
}

function relTrend(pts, key) {
  const now = pts[pts.length - 1];
  if (pts.length < 2) return { word: 'just starting', arrow: '·', delta: 0, cls: 'steady' };
  const weekAgo = ClaudeAPI._now() - 7 * 86400000;
  let base = pts[0];
  for (const p of pts) { if (p.ts <= weekAgo) base = p; else break; }
  const delta = now[key] - base[key];
  const lastEvent = pts.length >= 2 ? pts[pts.length - 2].ts : 0;
  if (ClaudeAPI._now() - lastEvent > 5 * 86400000) return { word: 'gone quiet', arrow: '…', delta, cls: 'stale' };
  if (delta >= 3) return { word: 'progressing', arrow: '↑', delta, cls: 'up' };
  if (delta <= -3) return { word: 'declining', arrow: '↓', delta, cls: 'down' };
  return { word: 'holding steady', arrow: '→', delta, cls: 'steady' };
}

/* Long histories sample to one point per (5am-rolled) day so weeks stay
   readable; young histories keep every event point. */
function relLinePoints(pts) {
  if (!pts || pts.length < 2) return pts || [];
  const span = pts[pts.length - 1].ts - pts[0].ts;
  if (span <= 2 * 86400000 || pts.length <= 40) return pts;
  const byDay = new Map();
  for (const p of pts) byDay.set(ClaudeAPI._dayKey(p.ts), p); // last per day
  const out = [...byDay.values()].sort((a, b) => a.ts - b.ts);
  if (out[out.length - 1].ts !== pts[pts.length - 1].ts) out.push(pts[pts.length - 1]);
  return out;
}

/* The line graph, done right this time: the Y axis zooms to where the data
   actually lives (a +2 day is a visible slope, not a flat pixel on 0-100),
   and zooms tighter still when one element is focused. */
function drawRelChart(pts) {
  const svg = $('#rel-chart');
  if (!svg) return;
  const W = 640, H = 240, L = 34, R = 10, T = 12, B = 24;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const data = relLinePoints(pts);
  if (!data.length) { svg.innerHTML = ''; return; }
  const t1 = data[data.length - 1].ts;
  const span = Math.max(t1 - data[0].ts, 3600000);
  const dims = relSelected ? REL_DIMS.filter(d => d.key === relSelected) : REL_DIMS;
  let lo = 100, hi = 0;
  for (const p of data) for (const d of dims) { lo = Math.min(lo, p[d.key]); hi = Math.max(hi, p[d.key]); }
  lo = Math.max(0, Math.floor((lo - 4) / 10) * 10);
  hi = Math.min(100, Math.ceil((hi + 4) / 10) * 10);
  if (hi - lo < 20) { hi = Math.min(100, lo + 20); lo = Math.max(0, hi - 20); }
  const x = ts => (W - R) - ((t1 - ts) / span) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let out = '';
  for (let g = 0; g <= 4; g++) {
    const val = Math.round(lo + g * (hi - lo) / 4);
    out += `<line x1="${L}" y1="${y(val)}" x2="${W - R}" y2="${y(val)}" class="rel-grid"/>` +
           `<text x="${L - 6}" y="${y(val) + 3}" class="rel-axis" text-anchor="end">${val}</text>`;
  }
  const left = t1 - span;
  const sameDay = new Date(left).toDateString() === new Date(t1).toDateString();
  const fmt = ts => sameDay
    ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  out += `<text x="${L}" y="${H - 6}" class="rel-axis">${fmt(left)}</text>` +
         `<text x="${W - R}" y="${H - 6}" class="rel-axis" text-anchor="end">${sameDay ? 'now' : 'today'}</text>`;
  for (const d of REL_DIMS) {
    const focused = !relSelected || relSelected === d.key;
    if (!focused) continue; // focused view hides the others entirely — cleaner than dimming on a zoomed axis
    const path = data.map((p, i) => (i ? 'L' : 'M') + x(p.ts).toFixed(1) + ' ' + y(p[d.key]).toFixed(1)).join(' ');
    out += `<path d="${path}" fill="none" stroke="${d.color}" class="rel-line" data-dim="${d.key}"/>`;
    const last = data[data.length - 1];
    out += `<circle cx="${x(last.ts).toFixed(1)}" cy="${y(last[d.key]).toFixed(1)}" r="3.5" fill="${d.color}"/>`;
  }
  svg.innerHTML = out;
  svg.querySelectorAll('.rel-line').forEach(pth => pth.addEventListener('click', () => {
    relSelected = relSelected === pth.dataset.dim ? null : pth.dataset.dim;
    renderRelationship();
  }));
}

let relPts = null; // reconstructed absolute series

function renderRelationship() {
  const friend = currentFriend;
  if (!friend || !relPts) return;
  const pts = relPts;
  drawRelChart(pts);
  const cards = $('#rel-cards');
  cards.innerHTML = '';
  const now = pts[pts.length - 1];
  const first = pts[0];
  for (const d of REL_DIMS) {
    const t = relTrend(pts, d.key);
    const sel = relSelected === d.key;
    const card = document.createElement('div');
    card.className = 'rel-card' + (sel ? ' selected' : '');
    const total = now[d.key] - first[d.key];
    const sign = n => (n > 0 ? '+' : '') + n;
    card.innerHTML = `
      <div class="rel-card-head"><span class="rel-dot" style="background:${d.color}"></span>${d.label}
        <span class="rel-trend ${t.cls}">${t.arrow} ${t.word}</span></div>
      <div class="rel-meter"><div class="rel-meter-fill" style="width:${now[d.key]}%;background:${d.color}"></div></div>
      <div class="rel-card-detail${sel ? '' : ' hidden'}">${now[d.key]} now · ${sign(t.delta)} this week · ${sign(total)} since the graph began</div>`;
    card.addEventListener('click', () => {
      relSelected = sel ? null : d.key;
      renderRelationship();
    });
    cards.appendChild(card);
  }
}

async function openRelationship() {
  if (!currentFriend) return;
  $('#rel-title').textContent = currentFriend.profile.name;
  let events = [];
  try { events = await DB.getEvents(currentFriend.id); } catch { /* graph just starts today */ }
  relPts = relSeries(currentFriend, events);
  $('#rel-empty').classList.toggle('hidden', relPts.length > 1);
  relSelected = null;
  renderRelationship();
  showView('view-relationship');
}

/* Some days, when he opens a chat after a real gap, she's already typing —
   she texts FIRST, seeded from her day, her life, and hanging threads.
   Fire-and-forget; any failure is silent (the chat is simply as he left it). */
async function maybeOpener(friend) {
  if (sending) return;
  try {
    const msgs = await DB.getMessages(friend.id);
    const last = msgs[msgs.length - 1];
    if (!ClaudeAPI.openerDue(friend, msgs)) return;
    // mark first so a slow request can't double-fire
    friend.lastOpenerDay = ClaudeAPI._dayKey(ClaudeAPI._now());
    friend.lastOpenerAt = ClaudeAPI._now(); // second-surprise spacing reads this
    friend.vibeSeed = ClaudeAPI._now() % 1e9; // openers always start a fresh burst
    await DB.saveFriend(friend);

    sending = true;
    $('#typing').classList.remove('hidden');
    $('#chat-status').textContent = 'typing…';
    scrollChat();

    const settings = Settings.get();
    const history = msgs.map(m => ({ role: m.role, text: m.text }));
    // The nudge rides as an unsaved synthetic turn — it exists only in this
    // one request, never in stored history.
    const nudge = { role: 'user', text: ClaudeAPI.openerNudge(ClaudeAPI._now() - last.ts, last.role === 'assistant', friend) };
    const result = await ClaudeAPI.chat(friend, history.concat([nudge]), settings, last.ts, null);
    let openerPreviews = result.bubbles.filter(b => !PHOTO_MARKER.test(b));
    if (!currentFriend || currentFriend.id !== friend.id) {
      // he left the chat mid-generation — save quietly, no rendering. Photo
      // markers are dropped: generating into a chat nobody is watching
      // spends money on an image she can simply take next time.
      for (const b of openerPreviews) await DB.addMessage({ friendId: friend.id, role: 'assistant', text: b, ts: ClaudeAPI._now() });
    } else {
      $('#typing').classList.add('hidden');
      openerPreviews = [];
      for (let i = 0; i < result.bubbles.length; i++) {
        const b = result.bubbles[i];
        if (i > 0) {
          $('#typing').classList.remove('hidden');
          scrollChat();
          await new Promise(r => setTimeout(r, Math.min(2200, 400 + b.length * 18)));
          $('#typing').classList.add('hidden');
        }
        const p = await deliverBubble(friend, b);
        if (p) openerPreviews.push(p);
      }
      maybeFallbackNote(result);
    }
    if (result.state) {
      const outcome = ClaudeAPI.applyStateDeltas(friend, result.state, { history, gapMs: ClaudeAPI._now() - last.ts });
      friend.state = outcome.state;
      DB.addEvent(Object.assign({ friendId: friend.id, ts: ClaudeAPI._now() }, outcome.event)).catch(() => {});
      if (result.state.new_memories.length) ClaudeAPI.mergeMemories(friend, result.state.new_memories);
    }
    friend.lastActivity = ClaudeAPI._now();
    if (openerPreviews.length) friend.lastPreview = openerPreviews[openerPreviews.length - 1];
    await DB.saveFriend(friend);
    renderFriendsList();
  } catch { /* silent — she just didn't text first today */ } finally {
    sending = false;
    $('#typing').classList.add('hidden');
    $('#chat-status').textContent = fmtClock();
  }
}

async function renderMessages() {
  const msgs = await DB.getMessages(currentFriend.id);
  const box = $('#chat-messages');
  box.innerHTML = '';
  let lastTs = 0;
  for (const m of msgs) {
    if (m.ts - lastTs > 30 * 60000) {
      const t = document.createElement('div');
      t.className = 'msg-time';
      t.textContent = fmtTime(m.ts);
      box.appendChild(t);
    }
    lastTs = m.ts;
    const el = bubbleEl(m.role, m.text, m);
    armMessageDelete(el, m.id);
    box.appendChild(el);
  }
  if (!msgs.length) {
    const hint = document.createElement('div');
    hint.id = 'chat-start-hint';
    hint.className = 'msg sys';
    hint.textContent = `This is the beginning of your conversation with ${currentFriend.profile.name}. Send the first message.`;
    box.appendChild(hint);
  }
  refreshTails();
}

function bubbleEl(role, text, msg) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'me' : role === 'sys' ? 'sys' : 'them');
  if (msg && msg.photo) {
    div.classList.add('photo-msg');
    const img = document.createElement('img');
    img.src = msg.photo;
    img.alt = 'photo';
    img.addEventListener('click', () => {
      const viewer = $('#photo-viewer');
      viewer.querySelector('img').src = msg.photo;
      viewer.classList.remove('hidden');
    });
    div.appendChild(img);
  } else {
    div.textContent = text;
  }
  return div;
}

/* ---- live state movement ----
   The engine moves every message now; show it. After her reply, whatever
   actually shifted flashes briefly under her name ("closeness +1 ·
   attraction +1"), then the clock returns. Adaptation you can SEE. */
let stateFlashTimer = null;
function flashStateChange(applied) {
  const parts = [];
  for (const k of ['closeness', 'comfort', 'attraction']) {
    const v = (applied && applied[k]) || 0;
    if (v) parts.push(`${k} ${v > 0 ? '+' : ''}${v}`);
  }
  if (!parts.length) return;
  const el = $('#chat-status');
  el.textContent = parts.join(' · ');
  clearTimeout(stateFlashTimer);
  stateFlashTimer = setTimeout(() => { el.textContent = fmtClock(); }, 3200);
}

/* ---- message pruning ----
   Long-press any bubble to delete it. The point isn't tidiness: when a bad
   provider day writes nonsense into the thread, that nonsense is HISTORY —
   every later reply sees it and builds on it. Pruning the junk is how a
   derailed conversation gets its voice back. */
function armMessageDelete(el, msgId) {
  if (!msgId) return;
  let timer = null;
  el.addEventListener('pointerdown', () => {
    timer = setTimeout(async () => {
      timer = null;
      if (!confirm('Delete this message? It disappears from the conversation and from what she sees from now on.')) return;
      await DB.deleteMessage(msgId);
      el.remove();
      refreshTails();
    }, 550);
  });
  for (const ev of ['pointerup', 'pointermove', 'pointercancel', 'pointerleave']) {
    el.addEventListener(ev, () => { if (timer) { clearTimeout(timer); timer = null; } });
  }
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/* ---- provider-downgrade visibility ----
   When the provider the user actually set up (Bedrock, Anthropic, any keyed
   entry) fails or is cooling down and a FREE backup model writes the reply,
   the voice quality visibly drops — and with no explanation it reads as the
   personas regressing. Surface it: one small transient line in the chat,
   naming who was skipped, why, and who answered. Throttled so an outage
   doesn't stamp every message. */
let fallbackNoteAt = 0;
function maybeFallbackNote(result) {
  if (!result || result.providerKeyed) return; // the good provider answered
  const skippedKeyed = (result.skipped || []).filter(s => s.keyed);
  if (!skippedKeyed.length) return;            // nothing better exists to miss
  if (ClaudeAPI._now() - fallbackNoteAt < 10 * 60000) return;
  fallbackNoteAt = ClaudeAPI._now();
  const s = skippedKeyed[0];
  const note = document.createElement('div');
  note.className = 'msg sys transient-note';
  note.textContent = `⚠️ ${s.label} didn't answer (${s.reason}) — a free backup model (${result.provider}) wrote this, so her voice may be off until it recovers. It retries automatically.`;
  $('#chat-messages').appendChild(note);
  scrollChat();
}

/* ---- her photos (Bedrock image model, optional) ----
   The model marks a photo by making one bubble "[photo] <what it shows>".
   The marker never renders: it either becomes a generated image bubble or,
   when no image model is configured / generation fails, disappears. */
const PHOTO_MARKER = /^\s*\[\s*photo\s*\]?\s*[:\-—]?\s*/i;

async function deliverBubble(friend, b) {
  const isPhoto = PHOTO_MARKER.test(b);
  if (!isPhoto) {
    const el = bubbleEl('assistant', b);
    $('#chat-messages').appendChild(el);
    refreshTails();
    scrollChat();
    armMessageDelete(el, await DB.addMessage({ friendId: friend.id, role: 'assistant', text: b, ts: ClaudeAPI._now() }));
    return b;
  }
  const desc = b.replace(PHOTO_MARKER, '').trim();
  const entry = ClaudeAPI.imageEntry(Settings.get());
  if (!entry || !desc) return null;
  $('#typing').classList.remove('hidden');
  $('#chat-status').textContent = 'sending a photo…';
  scrollChat();
  try {
    const dataUrl = await ClaudeAPI.generateImage(entry, desc);
    $('#typing').classList.add('hidden');
    const msg = { friendId: friend.id, role: 'assistant', text: '', photo: dataUrl, photoDesc: desc, ts: ClaudeAPI._now() };
    const el = bubbleEl('assistant', '', msg);
    $('#chat-messages').appendChild(el);
    refreshTails();
    scrollChat();
    armMessageDelete(el, await DB.addMessage(msg));
    return '📷 Photo';
  } catch (e) {
    $('#typing').classList.add('hidden');
    toast('Her photo didn\'t send — ' + e.message, 6000);
    return null;
  } finally {
    $('#chat-status').textContent = fmtClock();
  }
}

/* iMessage grouping: consecutive bubbles from the same side sit 2px apart and
   only the last one gets the tail; anything else (other side, a timestamp, a
   system note) closes the group. Also maintains the "Delivered" receipt under
   the newest sent message. Cheap enough to re-run after every append. */
function refreshTails() {
  const box = $('#chat-messages');
  if (!box) return;
  box.querySelectorAll('.delivered').forEach(d => d.remove());
  const kids = [...box.children];
  kids.forEach((el, i) => {
    const side = el.classList.contains('me') ? 'me' : el.classList.contains('them') ? 'them' : null;
    if (!side) return;
    el.classList.remove('tail', 'grouped');
    const next = kids[i + 1];
    if (!next || !next.classList.contains(side)) el.classList.add('tail');
    const prev = kids[i - 1];
    if (prev && prev.classList.contains(side)) el.classList.add('grouped');
  });
  const mine = box.querySelectorAll('.msg.me');
  if (mine.length) {
    const d = document.createElement('div');
    d.className = 'delivered';
    d.textContent = 'Delivered';
    mine[mine.length - 1].after(d);
  }
}

function updateSendButton() {
  const input = $('#composer-input');
  $('#btn-send').classList.toggle('show', !!input.value.trim());
}

function scrollChat(smooth = true) {
  const box = $('#chat-messages');
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

async function sendMessage() {
  if (sending || !currentFriend) return;
  const input = $('#composer-input');
  const text = input.value.trim();
  if (!text) return;

  const settings = Settings.get();
  if (!ClaudeAPI.activeEntries(settings).length) {
    toast('No provider configured — add a key in Settings');
    showView('view-settings');
    return;
  }

  sending = true;
  $('#btn-send').disabled = true;
  input.value = '';
  input.style.height = 'auto';

  const friend = currentFriend;
  const priorMsgs = await DB.getMessages(friend.id);
  const lastTs = priorMsgs.length ? priorMsgs[priorMsgs.length - 1].ts : null;

  // a multi-day silence cools her comfort a little before we even ask —
  // she noticed the absence. It goes in the ledger like any other movement:
  // an invisible drift made the graph disagree with the meter.
  if (lastTs) {
    const cooled = ClaudeAPI.applyAbsenceDrift(friend, ClaudeAPI._now() - lastTs);
    if (cooled) {
      DB.addEvent({
        friendId: friend.id, ts: ClaudeAPI._now(), reason: 'absence — days without a word', confidence: 1,
        deltas: { comfort: -cooled, closeness: 0, attraction: 0 },
        applied: { comfort: -cooled, closeness: 0, attraction: 0 },
        tension: Number(friend.state.tension) || 0,
        after: { comfort: friend.state.comfort, closeness: friend.state.closeness, attraction: friend.state.attraction, tension: Number(friend.state.tension) || 0 }
      }).catch(() => {});
    }
  }

  // a fresh conversation burst rerolls tonight's dice — same afternoon,
  // different sit-down, different her
  if (!lastTs || ClaudeAPI._now() - lastTs > 90 * 60000) friend.vibeSeed = ClaudeAPI._now() % 1e9;

  // show + persist the user's message
  const startHint = $('#chat-start-hint');
  if (startHint) startHint.remove();
  document.querySelectorAll('.transient-note').forEach(n => n.remove());
  const meEl = bubbleEl('user', text);
  $('#chat-messages').appendChild(meEl);
  refreshTails();
  updateSendButton();
  scrollChat();
  armMessageDelete(meEl, await DB.addMessage({ friendId: friend.id, role: 'user', text, ts: ClaudeAPI._now() }));

  const history = priorMsgs
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, text: m.text }));
  history.push({ role: 'user', text });

  $('#typing').classList.remove('hidden');
  $('#chat-status').textContent = 'typing…';

  try {
    const result = await ClaudeAPI.chat(friend, history, settings, lastTs, (attempt) => {
      $('#chat-status').textContent = `reconnecting… (${attempt})`;
    });

    if (result.refusal) {
      // Not persisted — a hiccup here shouldn't leave a permanent scar in the
      // conversation or in their memory of you. Show a transient note instead.
      $('#typing').classList.add('hidden');
      const note = document.createElement('div');
      note.className = 'msg sys transient-note';
      note.textContent = 'That one didn\'t send. Try putting it a different way.';
      $('#chat-messages').appendChild(note);
      scrollChat();
      return;
    }

    $('#typing').classList.add('hidden');

    // reveal bubbles one by one with human-ish pacing
    const previews = [];
    for (let i = 0; i < result.bubbles.length; i++) {
      const b = result.bubbles[i];
      if (i > 0) {
        $('#typing').classList.remove('hidden');
        scrollChat();
        await new Promise(r => setTimeout(r, Math.min(2200, 400 + b.length * 18)));
        $('#typing').classList.add('hidden');
      }
      const p = await deliverBubble(friend, b);
      if (p) previews.push(p);
    }
    maybeFallbackNote(result);

    // apply the friend's private state deltas — the model proposes, the app
    // disposes (clamps, dampens, gates, caps). Persisted, never displayed.
    // A missing state simply carries the previous state forward unchanged.
    if (result.state) {
      const outcome = ClaudeAPI.applyStateDeltas(friend, result.state, {
        history,
        gapMs: lastTs ? ClaudeAPI._now() - lastTs : null
      });
      friend.state = outcome.state;
      // every delta + reason lands in the ledger — the debugging window
      DB.addEvent(Object.assign({ friendId: friend.id, ts: ClaudeAPI._now() }, outcome.event)).catch(() => {});
      flashStateChange(outcome.event.applied);
      if (result.state.new_memories.length) {
        // near-duplicates strengthen the original instead of piling up
        ClaudeAPI.mergeMemories(friend, result.state.new_memories);
      }
    }
    friend.lastActivity = ClaudeAPI._now();
    friend.lastPreview = previews.length ? previews[previews.length - 1] : text;
    await DB.saveFriend(friend);
    renderFriendsList();

    // fold old chapters into an immutable scene record when enough history
    // has slipped past the context window — fire-and-forget, best-effort
    const fullLen = history.length + result.bubbles.length;
    if (ClaudeAPI.sceneStale(friend, fullLen)) {
      const fullHistory = history.concat(result.bubbles.filter(b => !PHOTO_MARKER.test(b)).map(b => ({ role: 'assistant', text: b })));
      ClaudeAPI.recordScene(friend, fullHistory, settings).then(async (rec) => {
        if (!rec) return;
        const f = await DB.getFriend(friend.id);
        if (!f) return;
        f.scenes = (f.scenes || []).concat([rec.scene]);
        f.scenesCovered = rec.covered;
        await DB.saveFriend(f);
        if (currentFriend && currentFriend.id === f.id) {
          currentFriend.scenes = f.scenes;
          currentFriend.scenesCovered = f.scenesCovered;
        }
      }).catch(() => { /* next turn will try again */ });
    }
  } catch (err) {
    $('#typing').classList.add('hidden');
    toast(err.message || 'Something went wrong', 5000);
  } finally {
    sending = false;
    $('#btn-send').disabled = false;
    $('#chat-status').textContent = fmtClock();
  }
}

/* ---------------- settings: provider pool ---------------- */

let poolDraft = null;       // working copy of the provider list while settings are open
let selectedEntryId = null; // pool entry being edited

function draftEntry(id) {
  return (poolDraft || []).find(e => e.id === id) || null;
}

function openSettings() {
  const s = Settings.get();
  poolDraft = JSON.parse(JSON.stringify(s.pool));
  selectedEntryId = null;
  $('#s-apikey').value = s.apiKey;
  $('#s-model').value = s.model;
  $('#s-effort').value = s.effort;
  $('#entry-editor').classList.add('hidden');
  $('#e-test-result').textContent = '';
  renderPool();
  renderPoolStatus();
  renderTimeStatus();
  showView('view-settings');
}

function renderTimeStatus() {
  const off = ClaudeAPI._timeOffset || 0;
  const el = $('#time-status');
  if (!el) return;
  el.textContent = off
    ? `In-app time: ${new Date(ClaudeAPI._now()).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} — about ${Math.round(off / 3600000)}h ahead of your phone.`
    : 'Running on real time.';
}

function saveSettings() {
  const s = Settings.get();
  const hadKey = !!s.apiKey;
  s.apiKey = $('#s-apikey').value.trim();
  s.model = $('#s-model').value;
  s.effort = $('#s-effort').value;
  const before = Settings.get();
  if (poolDraft) s.pool = poolDraft;

  // Adding a key to ANY provider is the quality upgrade — Claude, Gemini,
  // Groq, whatever. Promote it above the keyless tier so it actually answers,
  // instead of parking it below models it was chosen to beat.
  const newlyKeyed = s.pool.filter(e => {
    if (!entryHasKey(e, s)) return false;
    const prior = e.kind === 'anthropic'
      ? (hadKey ? e : null)
      : (before.pool || []).find(p => p.id === e.id && p.apiKey && p.apiKey.trim());
    return !prior;
  });

  if (newlyKeyed.length) {
    // Straight to the front. Configuring a provider is an explicit choice, so
    // it should take effect immediately rather than landing behind whatever
    // was there before — and it stays reorderable afterwards.
    const ids = new Set(newlyKeyed.map(e => e.id));
    s.pool = [...s.pool.filter(e => ids.has(e.id)), ...s.pool.filter(e => !ids.has(e.id))];
    Settings.set(s);
    toast(`${newlyKeyed[0].label} key saved — it answers first now`);
  } else {
    Settings.set(s);
    toast('Settings saved');
  }
  showView('view-friends');
}

function renderPool() {
  const list = $('#pool-list');
  list.innerHTML = '';
  poolDraft.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'pool-row' + (e.id === selectedEntryId ? ' selected' : '');
    const info = ClaudeAPI.usageInfo(e);
    const preset = e.preset ? ClaudeAPI.POOL_PRESETS[e.preset] : null;
    let sub;
    if (e.kind === 'anthropic') {
      sub = $('#s-apikey').value.trim() ? $('#s-model').value : 'optional — add a key below for the best personas';
    } else {
      sub = e.model || 'not configured yet';
      if (preset && preset.keyless) sub += ' · no key needed';
    }
    if (info.rpdHint) sub += ` · ${info.requestsToday}/${info.rpdHint} today`;
    else if (info.requestsToday) sub += ` · ${info.requestsToday} today`;
    if (info.blockedUntil) sub += ' · capped until ' + fmtTime(info.blockedUntil);
    row.innerHTML = `
      <input type="checkbox" ${e.enabled ? 'checked' : ''} title="Enabled">
      <div class="pool-meta">
        <div class="pool-name">${escapeHtml(e.label || e.id)}</div>
        <div class="pool-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="pool-actions">
        <button type="button" class="icon-btn" data-act="up" title="Higher priority">↑</button>
        <button type="button" class="icon-btn" data-act="down" title="Lower priority">↓</button>
        ${e.kind === 'anthropic' ? '' : '<button type="button" class="icon-btn" data-act="edit" title="Configure">⚙</button>'}
      </div>`;
    row.querySelector('input[type=checkbox]').addEventListener('change', (ev) => { e.enabled = ev.target.checked; });
    row.querySelector('[data-act=up]').addEventListener('click', () => movePoolEntry(i, -1));
    row.querySelector('[data-act=down]').addEventListener('click', () => movePoolEntry(i, 1));
    const edit = row.querySelector('[data-act=edit]');
    if (edit) edit.addEventListener('click', () => openEntryEditor(e.id));
    list.appendChild(row);
  });
}

function movePoolEntry(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= poolDraft.length) return;
  const [e] = poolDraft.splice(i, 1);
  poolDraft.splice(j, 0, e);
  renderPool();
}

function addPreset(name) {
  const preset = ClaudeAPI.POOL_PRESETS[name];
  if (!preset) return;
  const entry = {
    id: uid(),
    kind: preset.kind,
    label: preset.label,
    baseUrl: preset.baseUrl,
    apiKey: '',
    model: (preset.models && preset.models[0]) || '',
    contextTokens: preset.contextTokens,
    enabled: true
  };
  if (preset.kind === 'bedrock') entry.region = 'us-east-1';
  if (name !== 'custom') entry.preset = name;
  // A provider you deliberately add is an upgrade over the keyless tier, so it
  // goes above it rather than at the bottom where it would rarely be reached.
  const at = poolDraft.findIndex(isKeylessEntry);
  if (at >= 0) poolDraft.splice(at, 0, entry); else poolDraft.push(entry);
  renderPool();
  openEntryEditor(entry.id);
}

/* Keyless entries always work but are the weakest models — they're the floor,
   not the preference. Anything you've given a key to should outrank them. */
function isKeylessEntry(e) {
  const p = e && e.preset ? ClaudeAPI.POOL_PRESETS[e.preset] : null;
  return !!(p && p.keyless);
}

function entryHasKey(e, settings) {
  if (!e) return false;
  if (e.kind === 'anthropic') return !!(settings && settings.apiKey);
  return !!(e.apiKey && e.apiKey.trim());
}

function openEntryEditor(id) {
  selectedEntryId = id;
  const e = draftEntry(id);
  if (!e) return;
  const preset = e.preset ? ClaudeAPI.POOL_PRESETS[e.preset] : null;
  $('#entry-editor').classList.remove('hidden');
  $('#e-label').value = e.label || '';
  $('#e-url').value = e.baseUrl || '';
  $('#e-key').value = e.apiKey || '';
  $('#e-keyhint').textContent = preset ? preset.keyHint : (e.kind === 'ollama' ? 'No key needed.' : 'Some local endpoints need no key.');
  $('#e-key-label').classList.toggle('hidden', e.kind === 'ollama' || !!(preset && preset.keyless));
  $('#e-model').value = e.model || '';
  $('#e-ctx').value = e.contextTokens || 8000;
  $('#e-test-result').textContent = '';
  // Bedrock is addressed by region rather than a base URL, and its model list
  // is fixed rather than fetched.
  const isBedrock = e.kind === 'bedrock';
  $('#e-region-label').classList.toggle('hidden', !isBedrock);
  $('#e-url').parentElement.classList.toggle('hidden', isBedrock);
  $('#e-image-wrap').classList.toggle('hidden', !isBedrock);
  $('#btn-test-image').classList.toggle('hidden', !isBedrock);
  $('#e-img-preview').classList.add('hidden');
  if (isBedrock) {
    $('#e-img-model').value = e.imageModel || '';
    $('#e-img-region').value = e.imageRegion || '';
  }
  $('#e-modelhint').textContent = isBedrock
    ? 'Claude models are listed. For anything else on Bedrock — Grok, GLM, Kimi — open the model in the AWS console and paste its Model ID here exactly.'
    : 'Fetched live from the provider, so the list is never stale.';
  if (isBedrock) {
    $('#e-region').value = e.region || 'us-east-1';
    const dl = $('#e-models');
    dl.innerHTML = '';
    for (const m of (preset && preset.models) || []) {
      const o = document.createElement('option');
      o.value = m;
      dl.appendChild(o);
    }
    if (!e.model) { e.model = (preset.models || [])[0] || ''; $('#e-model').value = e.model; }
  }
  renderPool();
  if (e.kind === 'openai' && e.baseUrl) refreshEntryModels(!e.model);
}

async function refreshEntryModels(pickDefault) {
  const e = draftEntry(selectedEntryId);
  if (!e || e.kind !== 'openai' || !e.baseUrl) return;
  let models, listFailed = false;
  try { models = await ClaudeAPI.listModels(e.baseUrl, e.apiKey); }
  catch { models = []; listFailed = true; }
  if (!models.length) {
    // Fall back only to THIS provider's own models — never a generic list,
    // which is how a Gemini entry ended up set to a Llama model.
    models = ClaudeAPI.fallbackModelsFor(e.preset);
    listFailed = true;
  }
  if (listFailed && !models.length) {
    toast(`Couldn't load ${e.label || 'provider'} models — check the key or base URL, or type a model name.`, 5000);
  }
  const dl = $('#e-models');
  dl.innerHTML = '';
  for (const m of models) {
    const o = document.createElement('option');
    o.value = m.id;
    dl.appendChild(o);
  }
  // A model belonging to another provider is left over from the old shared
  // fallback list — replace it instead of making the user spot it.
  const contaminated = ClaudeAPI.isCrossProviderModel(e.preset, e.model);
  if (contaminated) toast(`${e.model} isn't a ${e.label || 'provider'} model — picking a valid one.`, 4500);
  if ((pickDefault || !e.model || contaminated) && models.length) {
    e.model = ClaudeAPI.pickDefaultModel(models, e.preset);
    $('#e-model').value = e.model;
    renderPool();
  }
}

function renderPoolStatus() {
  const parts = [];
  const last = ClaudeAPI.lastServed();
  if (last) parts.push('Last message served by ' + last.label + '.');
  for (const e of poolDraft) {
    if (e.kind === 'anthropic') continue;
    const info = ClaudeAPI.usageInfo(e);
    if (info.requestsToday || info.rpdHint) {
      parts.push(`${e.label}: ${info.requestsToday}${info.rpdHint ? ' of ~' + info.rpdHint : ''} requests today.`);
    }
  }
  parts.push('Free-tier limits change without warning — the app reads each provider\'s live rate-limit headers and adapts rather than trusting fixed numbers.');
  $('#pool-status').textContent = parts.join(' ');
}

async function exportBackup() {
  const data = await DB.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `frenz-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------- wiring ---------------- */

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

/* Repair damage older versions may have written to stored settings, without
   waiting for the user to stumble into the right screen: Gemini's "models/"
   id prefix (404s every send) and models assigned to the wrong provider by
   the old shared fallback list. */
function healStoredSettings() {
  const s = Settings.get();
  let changed = false;
  for (const e of s.pool || []) {
    if (e.kind !== 'openai') continue;
    if (e.model && /^models\//.test(e.model)) {
      e.model = e.model.replace(/^models\//, '');
      changed = true;
    }
    if (e.preset && ClaudeAPI.isCrossProviderModel(e.preset, e.model)) {
      const fb = ClaudeAPI.fallbackModelsFor(e.preset);
      if (fb.length) { e.model = fb[0].id; changed = true; }
    }
  }
  if (changed) Settings.set(s);
}

/* Older builds auto-picked Gemini flash-lite (chosen for its bigger daily
   quota). It is markedly worse at holding a persona, so a stored lite entry
   upgrades itself to the best non-lite flash — from the LIVE model list, so
   we only ever set a model this key can actually reach. Fire-and-forget. */
async function upgradeGeminiModel() {
  const s = Settings.get();
  const e = (s.pool || []).find(x => x.preset === 'gemini' && x.apiKey && /flash-lite/i.test(x.model || ''));
  if (!e) return;
  try {
    const models = await ClaudeAPI.listModels(e.baseUrl, e.apiKey);
    const best = ClaudeAPI.pickDefaultModel(models, 'gemini');
    if (best && !/flash-lite/i.test(best) && best !== e.model) {
      e.model = best;
      Settings.set(s);
      toast('Gemini switched to ' + best + ' — the stronger model for conversation.', 5000);
    }
  } catch { /* live list unavailable — keep what works */ }
}

/* A now-fixed bug let the model's private-state JSON render as chat bubbles
   and persist into history — where the model then saw its own leak and
   imitated it. Purge those artifacts from stored conversations (strict
   patterns only; real texts are never touched). Idempotent, runs each boot. */
async function purgeStateArtifacts() {
  const friends = await DB.listFriends();
  let removed = 0;
  for (const f of friends) {
    const msgs = await DB.getMessages(f.id);
    for (const m of msgs) {
      if (m.role === 'assistant' && !m.photo && ClaudeAPI._isArtifactBubble(String(m.text || '').trim())) {
        await DB.deleteMessage(m.id);
        removed++;
      }
    }
  }
  if (removed) {
    toast(`Cleaned ${removed} glitched message${removed === 1 ? '' : 's'} from your conversations.`, 4000);
    await renderFriendsList();
    if (currentFriend) await renderMessages();
  }
}

/* Template rewrites reach existing friends in place — history, memories, and
   relationship state all survive. Only unedited template text is touched. */
async function upgradeTemplateFriends() {
  const friends = await DB.listFriends();
  for (const f of friends) {
    let changed = Personas.upgradeProfile(f.profile);
    if (!f.profile.reveals || !f.profile.reveals.length) {
      const t = Personas.templates.find(x => x.name === f.profile.name);
      if (t && t.reveals) { f.profile.reveals = t.reveals; changed = true; }
    }
    {
      const t = Personas.templates.find(x => x.name === f.profile.name);
      if (t && t.established && !f.profile.established) { f.profile.established = true; changed = true; }
    }
    // One-time floor to the current template seed: a rounding bug froze all
    // positive state movement for weeks, so long-running friends sit at their
    // day-one numbers no matter what actually happened between them. Friends
    // below today's seed get lifted to it — never lowered, never repeated.
    if (!f.stateReseeded) {
      const t = Personas.templates.find(x => x.name === f.profile.name);
      if (t && t.sliders && f.state && (Number(f.state.attraction) || 0) < t.sliders.attraction) {
        f.state.attraction = t.sliders.attraction;
      }
      f.stateReseeded = true;
      changed = true;
    }
    if (changed) await DB.saveFriend(f);
  }
}

function init() {
  healStoredSettings();
  upgradeGeminiModel();
  purgeStateArtifacts();
  upgradeTemplateFriends();
  $('#btn-new-friend').addEventListener('click', openGallery);
  $('#btn-gallery-back').addEventListener('click', () => showView('view-friends'));
  $('#btn-customize-back').addEventListener('click', () => showView('view-gallery'));
  $('#customize-form').addEventListener('submit', startConversation);
  $('#btn-editor-back').addEventListener('click', () => {
    if (editingId && currentFriend) { openChat(currentFriend.id); }
    else showView('view-friends');
    editingId = null;
  });
  $('#friend-form').addEventListener('submit', saveFriendFromForm);
  $('#btn-delete-friend').addEventListener('click', async () => {
    if (!editingId) return;
    if (!confirm('Delete this friend and your entire conversation? This cannot be undone.')) return;
    await DB.deleteFriend(editingId);
    editingId = null;
    currentFriend = null;
    await renderFriendsList();
    showView('view-friends');
  });

  $('#btn-chat-back').addEventListener('click', () => { renderFriendsList(); showView('view-friends'); });
  $('#btn-chat-edit').addEventListener('click', () => openEditor(currentFriend));
  $('#chat-title-wrap').addEventListener('click', openRelationship);
  $('#photo-viewer').addEventListener('click', () => $('#photo-viewer').classList.add('hidden'));
  $('#btn-rel-back').addEventListener('click', () => { if (currentFriend) openChat(currentFriend.id); else showView('view-friends'); });

  const composer = $('#composer');
  const input = $('#composer-input');
  composer.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
  input.addEventListener('input', () => { autoGrow(input); updateSendButton(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-skip-6h').addEventListener('click', () => {
    ClaudeAPI.addTimeOffset(6 * 3600000);
    renderTimeStatus(); updateChatClock();
    toast('Skipped ahead 6 hours — it\'s now ' + fmtClock() + ' for everyone.');
  });
  $('#btn-skip-1d').addEventListener('click', () => {
    ClaudeAPI.addTimeOffset(24 * 3600000);
    renderTimeStatus(); updateChatClock();
    toast('Skipped ahead a day.');
  });
  $('#btn-time-reset').addEventListener('click', () => {
    ClaudeAPI.resetTimeOffset();
    renderTimeStatus(); updateChatClock();
    toast('Back to real time. Recently sent messages may show future timestamps until the clock catches up.');
  });
  $('#btn-settings-back').addEventListener('click', () => showView('view-friends'));
  $('#btn-save-settings').addEventListener('click', saveSettings);

  // provider pool editor
  document.querySelectorAll('.btn-preset').forEach(b => {
    b.addEventListener('click', () => addPreset(b.dataset.preset));
  });
  $('#e-label').addEventListener('input', () => {
    const e = draftEntry(selectedEntryId);
    if (e) { e.label = $('#e-label').value.trim() || e.label; renderPool(); }
  });
  $('#e-url').addEventListener('change', () => {
    const e = draftEntry(selectedEntryId);
    if (e) { e.baseUrl = $('#e-url').value.trim(); refreshEntryModels(!e.model); }
  });
  $('#e-key').addEventListener('change', () => {
    const e = draftEntry(selectedEntryId);
    if (e) { e.apiKey = $('#e-key').value.trim(); if (e.kind === 'openai') refreshEntryModels(!e.model); }
  });
  $('#e-model').addEventListener('input', () => {
    const e = draftEntry(selectedEntryId);
    if (e) { e.model = $('#e-model').value.trim(); renderPool(); }
  });
  $('#e-ctx').addEventListener('input', () => {
    const e = draftEntry(selectedEntryId);
    if (e) e.contextTokens = parseInt($('#e-ctx').value, 10) || 8000;
  });
  $('#e-region').addEventListener('input', () => {
    const e = draftEntry(selectedEntryId);
    if (e) e.region = $('#e-region').value.trim() || 'us-east-1';
  });
  $('#e-img-model').addEventListener('input', () => {
    const e = draftEntry(selectedEntryId);
    if (e) e.imageModel = $('#e-img-model').value.trim();
  });
  $('#e-img-region').addEventListener('input', () => {
    const e = draftEntry(selectedEntryId);
    if (e) e.imageRegion = $('#e-img-region').value.trim();
  });
  $('#btn-test-image').addEventListener('click', async () => {
    const e = draftEntry(selectedEntryId);
    if (!e) return;
    const out = $('#e-test-result');
    if (!e.apiKey) { out.textContent = '✗ Paste your Bedrock API key first.'; return; }
    if (!e.imageModel) {
      e.imageModel = 'amazon.nova-canvas-v1:0';
      $('#e-img-model').value = e.imageModel;
    }
    out.textContent = 'Generating a test image (can take ~15s)…';
    $('#e-img-preview').classList.add('hidden');
    try {
      const url = await ClaudeAPI.testImage(e);
      const img = $('#e-img-preview');
      img.src = url;
      img.classList.remove('hidden');
      out.textContent = `✓ ${e.imageModel} works — she can send photos now. Save settings to keep it.`;
    } catch (err) {
      out.textContent = '✗ ' + err.message;
    }
  });
  $('#btn-test-entry').addEventListener('click', async () => {
    const e = draftEntry(selectedEntryId);
    if (!e) return;
    const out = $('#e-test-result');
    out.textContent = 'Testing…';
    try {
      const r = await ClaudeAPI.testConnection(e, Settings.get());
      out.textContent = r.message;
      // never discover a too-small window mid-conversation: shrink the budget
      // to the detected context if needed
      if (r.context && r.context < (parseInt($('#e-ctx').value, 10) || 8000)) {
        e.contextTokens = Math.max(2000, r.context - 1024);
        $('#e-ctx').value = e.contextTokens;
        out.textContent += ' · budget lowered to fit';
      }
    } catch (err) {
      out.textContent = '✗ ' + err.message;
    }
  });
  $('#btn-remove-entry').addEventListener('click', () => {
    poolDraft = poolDraft.filter(e => e.id !== selectedEntryId);
    selectedEntryId = null;
    $('#entry-editor').classList.add('hidden');
    renderPool();
  });
  $('#btn-export').addEventListener('click', exportBackup);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await DB.importAll(data);
      toast('Backup imported');
      await renderFriendsList();
      showView('view-friends');
    } catch (err) {
      toast('Import failed: ' + err.message, 5000);
    }
    e.target.value = '';
  });
  $('#btn-wipe').addEventListener('click', async () => {
    if (!confirm('Erase ALL friends and conversations from this device?')) return;
    if (!confirm('Really sure? There is no undo.')) return;
    await DB.wipe();
    toast('All data erased');
    await renderFriendsList();
    showView('view-friends');
  });

  renderFriendsList();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is a bonus, not required */ });
  }
}

document.addEventListener('DOMContentLoaded', init);
