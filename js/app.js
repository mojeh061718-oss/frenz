/* app.js — views, chat flow, and friend lifecycle. */

const AVATAR_COLORS = ['#7c6cff', '#4dc6a8', '#ff8fb3', '#ffb454', '#5aa9ff', '#ff5d73', '#9b59b6', '#2ecc71'];

const $ = (sel) => document.querySelector(sel);
const views = ['view-friends', 'view-gallery', 'view-customize', 'view-editor', 'view-chat', 'view-settings'];

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
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function initials(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

function fmtTime(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return today ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
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
    createdAt: Date.now(),
    lastActivity: Date.now(),
    lastPreview: ''
  };

  // Her opening text seeds the register — the model picks up style and length
  // from the first message more than from anything else.
  const greeting = t.greeting || [];
  if (greeting.length) friend.lastPreview = greeting[greeting.length - 1];
  await DB.saveFriend(friend);
  for (const g of greeting) {
    await DB.addMessage({ friendId: friend.id, role: 'assistant', text: g, ts: Date.now() });
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
    profile.plist = friend.profile.plist || ''; // keep the compact trait list templates carry
    friend.profile = profile;
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
      createdAt: Date.now(),
      lastActivity: Date.now(),
      lastPreview: ''
    };
  }
  await DB.saveFriend(friend);
  await renderFriendsList();
  if (editingId) openChat(friend.id); else showView('view-friends');
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
  $('#chat-status').textContent = 'online';
  await renderMessages();
  showView('view-chat');
  scrollChat(false);
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
    box.appendChild(bubbleEl(m.role, m.text));
  }
  if (!msgs.length) {
    const hint = document.createElement('div');
    hint.id = 'chat-start-hint';
    hint.className = 'msg sys';
    hint.textContent = `This is the beginning of your conversation with ${currentFriend.profile.name}. Send the first message.`;
    box.appendChild(hint);
  }
}

function bubbleEl(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'me' : role === 'sys' ? 'sys' : 'them');
  div.textContent = text;
  return div;
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
  // she noticed the absence
  if (lastTs) ClaudeAPI.applyAbsenceDrift(friend, Date.now() - lastTs);

  // show + persist the user's message
  const startHint = $('#chat-start-hint');
  if (startHint) startHint.remove();
  document.querySelectorAll('.transient-note').forEach(n => n.remove());
  $('#chat-messages').appendChild(bubbleEl('user', text));
  scrollChat();
  await DB.addMessage({ friendId: friend.id, role: 'user', text, ts: Date.now() });

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
    for (let i = 0; i < result.bubbles.length; i++) {
      const b = result.bubbles[i];
      if (i > 0) {
        $('#typing').classList.remove('hidden');
        scrollChat();
        await new Promise(r => setTimeout(r, Math.min(2200, 400 + b.length * 18)));
        $('#typing').classList.add('hidden');
      }
      $('#chat-messages').appendChild(bubbleEl('assistant', b));
      scrollChat();
      await DB.addMessage({ friendId: friend.id, role: 'assistant', text: b, ts: Date.now() });
    }

    // apply the friend's private state deltas — the model proposes, the app
    // disposes (clamps, dampens, gates, caps). Persisted, never displayed.
    // A missing state simply carries the previous state forward unchanged.
    if (result.state) {
      const outcome = ClaudeAPI.applyStateDeltas(friend, result.state, {
        history,
        gapMs: lastTs ? Date.now() - lastTs : null
      });
      friend.state = outcome.state;
      // every delta + reason lands in the ledger — the debugging window
      DB.addEvent(Object.assign({ friendId: friend.id, ts: Date.now() }, outcome.event)).catch(() => {});
      if (result.state.new_memories.length) {
        const now = Date.now();
        friend.memories = (friend.memories || []).concat(
          result.state.new_memories.map(m => Object.assign({ ts: now, lastAccessed: now, pinned: false }, m))
        );
      }
    }
    friend.lastActivity = Date.now();
    friend.lastPreview = result.bubbles.length ? result.bubbles[result.bubbles.length - 1] : text;
    await DB.saveFriend(friend);
    renderFriendsList();

    // fold old chapters into an immutable scene record when enough history
    // has slipped past the context window — fire-and-forget, best-effort
    const fullLen = history.length + result.bubbles.length;
    if (ClaudeAPI.sceneStale(friend, fullLen)) {
      const fullHistory = history.concat(result.bubbles.map(b => ({ role: 'assistant', text: b })));
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
    $('#chat-status').textContent = 'online';
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
  showView('view-settings');
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
    model: '',
    contextTokens: preset.contextTokens,
    enabled: true
  };
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
  renderPool();
  if (e.kind === 'openai' && e.baseUrl) refreshEntryModels(!e.model);
}

async function refreshEntryModels(pickDefault) {
  const e = draftEntry(selectedEntryId);
  if (!e || e.kind !== 'openai' || !e.baseUrl) return;
  let models;
  try { models = await ClaudeAPI.listModels(e.baseUrl, e.apiKey); }
  catch { models = ClaudeAPI.FALLBACK_OAI_MODELS; }
  if (!models.length) models = ClaudeAPI.FALLBACK_OAI_MODELS;
  const dl = $('#e-models');
  dl.innerHTML = '';
  for (const m of models) {
    const o = document.createElement('option');
    o.value = m.id;
    dl.appendChild(o);
  }
  if ((pickDefault || !e.model) && models.length) {
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

function init() {
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

  const composer = $('#composer');
  const input = $('#composer-input');
  composer.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
  input.addEventListener('input', () => autoGrow(input));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  $('#btn-settings').addEventListener('click', openSettings);
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
