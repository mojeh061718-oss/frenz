/* app.js — views, chat flow, and friend lifecycle. */

/* Bumped with the index.html badge and sw.js CACHE. If this ever disagrees
   with the badge, the shell is a mixed-version chimera — the failure the
   atomic SW cache exists to prevent — and Settings will say so out loud. */
const APP_JS_VERSION = '10.23';

const AVATAR_COLORS = ['#7c6cff', '#4dc6a8', '#ff8fb3', '#ffb454', '#5aa9ff', '#ff5d73', '#9b59b6', '#2ecc71'];

const $ = (sel) => document.querySelector(sel);
const views = ['view-friends', 'view-gallery', 'view-builder', 'view-customize', 'view-editor', 'view-chat', 'view-relationship', 'view-settings'];

let currentFriend = null;       // friend object while chatting/editing
let editingId = null;           // friend id being edited, null = creating
let customizeTemplate = null;   // persona template on the customize screen
let sending = false;

/* THE COMPOSER MUST ALWAYS COME BACK.

   `sending` gates typing, and every path that raises it also lowers it in a
   finally — which is precisely the assumption that stranded one. A single
   wrong path and the composer is dead for the rest of the session, and
   because a stranded send used to re-arm itself in the outbox, closing and
   reopening the app walked straight back into the same lock.

   So the flag is no longer set by hand anywhere. It goes up through
   beginSend(), which arms an absolute ceiling, and comes down through
   endSend() or the watchdog. Whatever else is wrong, the app stays usable. */
/* 180s, not 300: every send path is bounded well under this (chat budget
   150s, photo budget 110s), so anything still "typing" at three minutes is
   dead and the composer comes back. Five minutes of locked composer was
   most of what "the app keeps freezing" actually was. */
const SEND_WATCHDOG_MS = 180000;
let sendWatchdog = 0;
function releaseComposer() {
  clearTimeout(sendWatchdog);
  sendWatchdog = 0;
  sending = false;
  const btn = $('#btn-send');
  if (btn) btn.disabled = false;
}
function beginSend() {
  sending = true;
  const btn = $('#btn-send');
  if (btn) btn.disabled = true;
  clearTimeout(sendWatchdog);
  sendWatchdog = setTimeout(() => {
    if (!sending) return;
    releaseComposer();
    const t = $('#typing'); if (t) t.classList.add('hidden');
    const s = $('#chat-status'); if (s) s.textContent = fmtClock();
    toast('That one never came back. Your message is still here — send it again.', 6000);
  }, SEND_WATCHDOG_MS);
}
function endSend() { releaseComposer(); }

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
    const unread = Number(f.unread) || 0;
    if (unread) item.classList.add('has-unread');
    item.innerHTML = `
      <div class="avatar" style="background:${f.profile.color}">${initials(f.profile.name)}</div>
      <div class="friend-meta">
        <div class="friend-name">${escapeHtml(f.profile.name)}${badge}<span class="friend-when">${f.lastActivity ? fmtTime(f.lastActivity).replace(/^Today /, '') : ''}</span></div>
        <div class="friend-preview">${escapeHtml(f.lastPreview || 'Say hi 👋')}</div>
      </div>
      ${unread ? `<span class="unread-dot">${unread > 9 ? '9+' : unread}</span>` : ''}`;
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
  // The guided builder sits beside "Blank / custom": same dashed card
  // language (both are build-your-own doors), different promise — the
  // interview compiles a full persona from the user's answers.
  const guided = document.createElement('div');
  guided.className = 'template-card blank';
  guided.id = 'tpl-builder';
  guided.innerHTML = `
    <div class="avatar" style="background:var(--bg3)">✎</div>
    <div class="tpl-meta">
      <div class="tpl-name">Guided builder</div>
      <div class="tpl-hook">Answer questions about her — everything she knows comes from your answers, nothing invented.</div>
    </div>`;
  guided.addEventListener('click', openBuilder);
  grid.appendChild(guided);
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
  { key: 'curiosity', label: 'Curiosity', low: 'incurious', high: 'asks anything' },
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
  $('#c-appearance').value = t.appearance || '';
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
  // seeded by her name so two friends on the same slider positions don't end
  // up carrying byte-identical personality sentences; the template's own
  // slider values are passed so untouched dials add nothing (her authored
  // personality already covers them better than a generic clause can)
  const notes = Personas.sliderText(sliders, name, t.sliders);
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
    // Blank here means she can never say his name — fall back to the one he
    // gave last time rather than shipping a nameless relationship.
    userName: $('#c-username').value.trim() || localStorage.getItem('frenz-user-name') || '',
    userGender: $('#c-usergender').value,
    plist: t.plist || '',
    appearance: $('#c-appearance').value.trim() || t.appearance || '',
    beats: t.beats || [],
    textures: t.textures || [],
    opening: t.opening || null,
    // A template may opt out of the shared world map: the guided builder
    // compiles world:'' because her world is exactly what the user's answers
    // gave — inheriting Jon's family would be a hallucinated backstory.
    // Shipped templates carry no world field, so they keep WORLD as before.
    world: t.world !== undefined ? t.world : (Personas.WORLD || ''),
    photoCandor: t.photoCandor || 'guarded',
    templateRev: t.templateRev || 0,
    reveals: t.reveals || [],
    established: !!t.established,
    sliders,
    color: t.color,
    // Builder-made personas keep their interview (re-editing can reopen it
    // prefilled) and a template id that marks them as user-authored, so
    // name-matched _UPGRADES rules never rewrite a person the user built.
    template: t.template || null,
    builder: t.builder || null
  };
  // Only remember a REAL answer. This used to store whatever was in the box,
  // so creating one friend with the name left blank wiped the remembered
  // name for every friend made afterwards — which is exactly how a thread
  // that once said "Jon" started rendering as "Him".
  if (profile.userName) localStorage.setItem('frenz-user-name', profile.userName);
  if (profile.userGender) localStorage.setItem('frenz-user-gender', profile.userGender);

  const friend = {
    id: uid(),
    profile,
    // closeness/attraction seed the private state directly from the sliders.
    // The derivation lives in Personas.seedState — shared with the verify
    // harness so the suite tests the exact states friends are created in.
    state: Personas.seedState(t, sliders, ClaudeAPI._now()),
    // The relationship's origin lives in `backstory` prose, which the state
    // model never records as a memory — it is asked for facts established in
    // THIS exchange, and the walk-in/lake/desk-lunch all predate message one.
    // The archive showed the cost: 20 messages in, "nothing recorded yet".
    // Seeding them makes the founding facts durable from the start.
    memories: (t.seedMemories || []).map(m => ClaudeAPI._normMemory(
      Object.assign({ ts: ClaudeAPI._now(), lastAccessed: ClaudeAPI._now() }, m))),
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
  // she exists now — the builder draft has served its purpose
  if (t.template === 'builder') localStorage.removeItem(BUILDER_DRAFT_KEY);
  customizeTemplate = null;
  openChat(friend.id);
}

/* ---------------- guided builder ---------------- */

/* An interview that builds a maximally specific persona: ~50 questions, one
   section per screen, every one skippable. The compiler (Personas.compileBuilder)
   is deterministic and never invents a fact — a skipped question just leaves
   that part of her unwritten, which is the entire anti-hallucination bargain.
   Answers autosave to localStorage on every keystroke; reopening the builder
   resumes the draft. */

const BUILDER_DRAFT_KEY = 'frenz-builder-draft';

const BUILDER_SECTIONS = [
  { title: 'Basics', blurb: 'Who she is and where you two stand. Skip anything — a skipped answer is left out, never made up.', questions: [
    { id: 'b_name', label: 'Her name', type: 'text', ph: 'e.g. Maya' },
    { id: 'b_age', label: 'Her age', type: 'number' },
    { id: 'b_rel', label: 'What is she to you?', type: 'choice', options: [['friend', 'Friend'], ['close_friend', 'Close friend'], ['romantic', 'Romantic interest']] },
    { id: 'b_met', label: 'How did you two meet? The actual incident, in your own words', type: 'textarea', ph: 'e.g. She rear-ended my car in the gym parking lot and left a note that was 80% apology, 20% joke.' },
    { id: 'b_known', label: 'How long have you known each other?', type: 'text', ph: 'e.g. about three years' },
    { id: 'b_freq', label: 'How often do you two talk?', type: 'text', ph: 'e.g. most days, in bursts' },
    { id: 'b_first', label: 'Who usually texts first?', type: 'choice', options: [['her', 'Usually her'], ['you', 'Usually you'], ['even', 'About even']] }
  ] },
  { title: 'Looks', blurb: 'Used only for the photos she sends. Her face is never shown — describe her neck-down (build, hair, body markers), and it stays the same person every photo.', questions: [
    { id: 'l_build', label: 'Height and build', type: 'text', ph: 'e.g. tall and soft-curvy' },
    { id: 'l_hair', label: 'Her hair', type: 'text', ph: 'e.g. long dark brown, usually in a claw clip' },
    { id: 'l_marks', label: 'Body identity markers — tattoos, freckles on her shoulders, scars, jewelry she never takes off', type: 'textarea' },
    { id: 'l_home', label: 'What she wears around the house', type: 'text' },
    { id: 'l_out', label: 'What she wears going out', type: 'text' },
    { id: 'l_proud', label: "One thing about her look she's proud of — or self-conscious about", type: 'text' }
  ] },
  { title: 'Texting voice', blurb: 'How her messages actually read. This is the strongest anti-clone signal she has.', questions: [
    { id: 'v_caps', label: 'Capitalization and punctuation', type: 'choice', options: [['lowercase', 'all lowercase, punctuation optional'], ['sentence', 'Sentence case, casual punctuation'], ['punctuated', 'Properly punctuated and capitalized']] },
    { id: 'v_rhythm', label: 'Bubble rhythm', type: 'choice', options: [['one', 'One-liners'], ['burst', 'Bursts of 2-3 bubbles'], ['para', 'Paragraphs']] },
    { id: 'v_sig', label: 'Her ONE signature marker', type: 'text', ph: 'e.g. keysmashes, rates things out of ten, parenthetical asides (like this), a specific emoji' },
    { id: 'v_laugh', label: 'Her laugh, in text', type: 'text', ph: 'e.g. "LMAOOO", a single "lol", 😭, dead silence then "im crying"' },
    { id: 'v_night', label: 'How she says goodnight', type: 'text' },
    { id: 'v_drunk', label: "How her texting changes when she's been drinking", type: 'text' },
    { id: 'v_sincere', label: 'Her sincere-tell — how you can tell she actually means it', type: 'text', ph: 'e.g. the jokes stop and she types full sentences' },
    { id: 'v_typos', label: 'Typo habits', type: 'text', ph: 'e.g. never fixes them / corrects with * a message late' }
  ] },
  { title: 'Personality & moods', blurb: 'Who she is on a good day, a bad day, and lately.', questions: [
    { id: 'p_traits', label: 'Three traits that define her', type: 'text', ph: 'e.g. dry, loyal, stubborn' },
    { id: 'p_happy', label: "What she's like when she's happy", type: 'text' },
    { id: 'p_stress', label: "What she's like stressed", type: 'text' },
    { id: 'p_annoyed', label: "What she does when she's annoyed with YOU", type: 'text', ph: 'e.g. one-word replies until you notice' },
    { id: 'p_mood', label: 'Her mood lately — and why', type: 'text' },
    { id: 'p_cheer', label: 'What reliably cheers her up', type: 'text' },
    { id: 'p_peeve', label: 'A pet peeve', type: 'text' },
    { id: 'p_never', label: "Something she'd never admit publicly", type: 'textarea' }
  ] },
  { title: 'Her world', blurb: 'The life that keeps running when you two are not texting. Names matter — she will never contradict them.', questions: [
    { id: 'w_people', label: 'People in her life, by name — family, roommates, pets', type: 'textarea', ph: 'e.g. her sister Ro, roommate Dana, an ancient cat named Bug' },
    { id: 'w_job', label: 'Her job or school — and how she feels about it', type: 'textarea' },
    { id: 'w_place', label: 'Her place', type: 'text', ph: 'e.g. a third-floor walkup with a fire-escape garden' },
    { id: 'w_bff', label: 'Her best friend', type: 'text' },
    { id: 'w_anchors', label: 'Weekly anchors — shifts, practices, classes, standing plans', type: 'textarea', ph: 'e.g. Tuesday closing shifts, Sunday dinner at her mom\'s' },
    { id: 'w_story', label: 'An ongoing storyline in her life right now', type: 'textarea', ph: 'e.g. slowly losing the war with her landlord over the broken heater' },
    { id: 'w_logi', label: 'Everyday logistics color — car, money, commute', type: 'text' }
  ] },
  { title: 'Interests', blurb: 'What she actually cares about, not a dating-profile list.', questions: [
    { id: 'i_three', label: "Three things she's genuinely into", type: 'text' },
    { id: 'i_over', label: 'The one she overshares about', type: 'text' },
    { id: 'i_media', label: 'What she watches / reads / listens to', type: 'text' },
    { id: 'i_evening', label: 'How she spends a free evening', type: 'textarea', ph: 'e.g. wine and trash TV, sometimes baking at midnight' },
    { id: 'i_bad', label: 'Something she loves but is bad at', type: 'text' }
  ] },
  { title: 'Your history together', blurb: 'Shared memories become durable from message one — she will treat them as things you both lived, never recap them at you.', questions: [
    { id: 'h_mem1', label: 'A favorite memory of you two — what happened, roughly when', type: 'textarea' },
    { id: 'h_mem2', label: 'A second memory', type: 'textarea' },
    { id: 'h_joke', label: 'An inside joke or phrase you two use', type: 'text' },
    { id: 'h_last', label: 'The last thing you did together', type: 'text' },
    { id: 'h_open', label: 'Anything unresolved or charged between you right now?', type: 'textarea' }
  ] },
  { title: 'Under the surface', blurb: 'The private layer. She acts shaped by these — she never announces them.', questions: [
    { id: 'u_noticed', label: "Things you've noticed about her that she doesn't know you've noticed", type: 'textarea' },
    { id: 'u_feels', label: 'What you think she secretly feels about you but would never say', type: 'textarea', hint: "This becomes her private unspoken side — it colors her tone and choices; she will never state it outright." },
    { id: 'u_avoid', label: 'A topic she avoids', type: 'text' },
    { id: 'u_gone', label: "How she'd react if you disappeared for a week", type: 'text' }
  ] }
];

/* The review step shows every compiled field editable; hand-edits are final. */
const BUILDER_REVIEW_FIELDS = [
  ['plist', 'Core traits — the binding short list', 2, 'text'],
  ['style', 'Texting style — the FIRST sentence is the one that binds her voice', 3, 'text'],
  ['personality', 'Personality', 4, 'text'],
  ['interests', 'Life & interests', 4, 'text'],
  ['appearance', 'Appearance — photos only, her face is never shown', 3, 'text'],
  ['backstory', 'How you know each other', 3, 'text'],
  ['greeting', 'Her opening texts — one bubble per line', 2, 'lines'],
  ['beats', 'Life beats — things that happen in her world, one per line', 5, 'lines'],
  ['textures', 'Her evenings — scenery lines, one per line', 3, 'lines'],
  ['mood', 'Her mood as the thread opens', 1, 'text'],
  ['unsaidSeed', 'On her mind, unsaid — shapes her, never spoken', 2, 'text'],
  ['significantSeed', 'The charged thing between you (leave empty for none)', 1, 'text']
];

let builderStep = 0;           // 0..7 = sections, 8 = review
let builderAnswers = {};
let builderCompiled = null;    // the compiled template while the review is open

function builderSaveDraft() {
  try { localStorage.setItem(BUILDER_DRAFT_KEY, JSON.stringify({ answers: builderAnswers, step: builderStep })); } catch (e) { /* storage full: the session copy still works */ }
}

function builderLoadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(BUILDER_DRAFT_KEY) || 'null');
    if (d && d.answers && typeof d.answers === 'object') {
      builderAnswers = d.answers;
      builderStep = Math.min(Number(d.step) || 0, BUILDER_SECTIONS.length - 1);
      return true;
    }
  } catch (e) { /* corrupt draft: start clean */ }
  return false;
}

function openBuilder() {
  builderAnswers = {};
  builderStep = 0;
  builderCompiled = null;
  if (builderLoadDraft()) toast('Draft restored — pick up where you left off.');
  renderBuilderStep();
  showView('view-builder');
}

function renderBuilderStep() {
  builderCompiled = null;
  const total = BUILDER_SECTIONS.length;
  const sec = BUILDER_SECTIONS[builderStep];
  $('#builder-step').textContent = 'Section ' + (builderStep + 1) + ' of ' + total + ' — ' + sec.title;
  $('#builder-bar-fill').style.width = Math.round(((builderStep) / (total + 1)) * 100) + '%';
  $('#builder-blurb').textContent = sec.blurb;
  const body = $('#builder-body');
  body.innerHTML = '';
  for (const q of sec.questions) {
    const label = document.createElement('label');
    label.textContent = q.label;
    let input;
    if (q.type === 'choice') {
      input = document.createElement('select');
      const skip = document.createElement('option');
      skip.value = ''; skip.textContent = '— skip —';
      input.appendChild(skip);
      for (const [val, text] of q.options) {
        const o = document.createElement('option');
        o.value = val; o.textContent = text;
        input.appendChild(o);
      }
    } else if (q.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.type = q.type === 'number' ? 'number' : 'text';
      if (q.type === 'number') { input.min = 18; input.max = 99; }
    }
    if (q.ph) input.placeholder = q.ph;
    input.value = builderAnswers[q.id] != null ? builderAnswers[q.id] : '';
    input.addEventListener('input', () => {
      builderAnswers[q.id] = input.value;
      builderSaveDraft();
    });
    label.appendChild(input);
    if (q.hint) {
      const s = document.createElement('small');
      s.textContent = q.hint;
      label.appendChild(s);
    }
    body.appendChild(label);
  }
  $('#btn-builder-prev').textContent = builderStep === 0 ? '← Gallery' : '← Back';
  $('#btn-builder-next').textContent = builderStep === total - 1 ? 'Review her →' : 'Next →';
  $('#builder-form').scrollTop = 0;
}

function renderBuilderReview() {
  const tpl = Personas.compileBuilder(builderAnswers);
  builderCompiled = tpl;
  $('#builder-step').textContent = 'Review — your words, compiled';
  $('#builder-bar-fill').style.width = Math.round((BUILDER_SECTIONS.length / (BUILDER_SECTIONS.length + 1)) * 100) + '%';
  $('#builder-blurb').textContent = 'Everything below was compiled from your answers and nothing else. Edit any field — your edits are final. Sliders come next.';
  const body = $('#builder-body');
  body.innerHTML = '';
  // sanitizer + dedupe notes first, so the user sees WHY a phrase moved
  for (const w of tpl.warnings || []) {
    const div = document.createElement('div');
    div.className = 'builder-warn';
    div.textContent = w;
    body.appendChild(div);
  }
  for (const [field, labelText, rows, kind] of BUILDER_REVIEW_FIELDS) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const ta = document.createElement('textarea');
    ta.rows = rows;
    ta.dataset.field = field;
    ta.dataset.kind = kind;
    const v = tpl[field];
    ta.value = kind === 'lines' ? (Array.isArray(v) ? v.join('\n') : '') : (v || '');
    label.appendChild(ta);
    body.appendChild(label);
  }
  $('#btn-builder-prev').textContent = '← Back to questions';
  $('#btn-builder-next').textContent = 'Looks right — set her sliders';
  $('#builder-form').scrollTop = 0;
}

/* Hand-edits from the review textareas are the final say. */
function builderApplyReviewEdits() {
  const tpl = builderCompiled;
  document.querySelectorAll('#builder-body textarea[data-field]').forEach(ta => {
    const field = ta.dataset.field;
    if (ta.dataset.kind === 'lines') {
      tpl[field] = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
    } else {
      tpl[field] = ta.value.trim();
    }
  });
  if (!tpl.significantSeed) tpl.significantSeed = null;
  if (!tpl.mood) tpl.mood = '';
  return tpl;
}

function builderNext() {
  if (builderStep < BUILDER_SECTIONS.length - 1) {
    builderStep++;
    builderSaveDraft();
    renderBuilderStep();
  } else if (builderStep === BUILDER_SECTIONS.length - 1) {
    builderStep = BUILDER_SECTIONS.length;
    renderBuilderReview();
  } else {
    // review accepted: hand the compiled template to the EXISTING customize
    // flow — sliders show the derived defaults, and Start conversation runs
    // the same startConversation as every other template. The draft stays
    // until she is actually created, so backing out loses nothing.
    const tpl = builderApplyReviewEdits();
    openCustomize(tpl);
  }
}

function builderPrev() {
  if (builderStep === 0) { showView('view-gallery'); return; }
  if (builderStep >= BUILDER_SECTIONS.length) {
    builderStep = BUILDER_SECTIONS.length - 1;
    renderBuilderStep();
    return;
  }
  builderStep--;
  builderSaveDraft();
  renderBuilderStep();
}

function builderRestart() {
  if (!confirm('Clear the whole draft and start the interview over?')) return;
  localStorage.removeItem(BUILDER_DRAFT_KEY);
  builderAnswers = {};
  builderStep = 0;
  builderCompiled = null;
  renderBuilderStep();
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
  $('#f-appearance').value = p.appearance || '';
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
    appearance: $('#f-appearance').value.trim(),
    backstory: $('#f-backstory').value.trim(),
    userName: $('#f-username').value.trim() || localStorage.getItem('frenz-user-name') || '',
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
  if (currentFriend.unread) { currentFriend.unread = 0; await DB.saveFriend(currentFriend); }
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
  // Opening the thread is the ONLY trigger for finishing a send that was cut
  // off — you are already here, looking at your own unanswered message, so a
  // reply arriving reads as her getting back to you. Deliberately not on
  // boot: recovery must never decide which conversation you are in.
  resumeIfStranded(currentFriend)
    .then(() => { if (!sending) maybeOpener(currentFriend); })
    .catch(() => maybeOpener(currentFriend));
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
/* Sweep every friend at launch so unread messages are ALREADY on the main
   screen when he opens the app, instead of materialising when he taps into a
   chat. Runs quietly in the background, one friend at a time so a provider
   never gets hammered, and never touches the friend he's currently reading. */
/* One sweep per quarter hour, not one per app-foregrounding. On a phone the
   app goes visible dozens of times a day, and every sweep spends the SAME
   per-minute provider quota the user's own sends need — sweeping on each
   return quietly starved real messages into 429 backoff, which reads as
   "the app just stopped responding". Explicit time-skips bypass the
   cooldown (the user asked for that jump; silence after it would make the
   skip pointless). */
let lastSweepAt = 0;
const SWEEP_COOLDOWN_MS = 15 * 60000;
async function sweepOpeners(force) {
  const nowT = Date.now();
  if (!force && nowT - lastSweepAt < SWEEP_COOLDOWN_MS) return;
  lastSweepAt = nowT;
  let friends = [];
  try { friends = await DB.listFriends(); } catch { return; }
  friends.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  // The sweep spends the SAME per-minute provider quota the user's own sends
  // need. Unthrottled, a launch with several due openers burned the whole
  // minute's budget in the background — and the user's first send then sat
  // in 429 backoff looking frozen, "randomly" recovering whenever the window
  // reset. So: the user's live send always wins (bail), a launch fires at
  // most two background firsts (the rest keep their per-day roll and fire on
  // a later open), a breath between requests spreads the load, and an
  // already-rate-limited session doesn't dig the hole deeper.
  let fired = 0;
  for (const f of friends) {
    if (sending || ClaudeAPI._underPressure()) break;
    if (currentFriend && currentFriend.id === f.id) continue;
    try {
      const msgs = await DB.getMessages(f.id);
      if (!msgs.length || !ClaudeAPI.openerDue(f, msgs)) continue;
      if (fired > 0) await new Promise(r => setTimeout(r, 8000));
      if (sending || ClaudeAPI._underPressure()) break;
      await maybeOpener(f, true);
      if (++fired >= 2) break;
    } catch { /* one friend failing never stops the sweep */ }
  }
}

/* HER INITIATIVE NEVER LOCKS HIS KEYBOARD.

   The foreground opener used to run through beginSend(), which gated
   sendMessage — so "she's typing…" (her own idea, not a reply he asked for)
   made the composer silently eat every tap for up to the full 150s send
   budget. Chained after a stranded-send resume (also up to 150s), that is
   minutes of an app that shows a typing indicator and responds to nothing:
   the reported freeze, reproduced. Now an in-flight opener is a token the
   user can trump — if he starts talking first, her opener is quietly
   discarded (she just didn't text first today) and his send runs normally. */
let openerFlight = null;

/* THE SAME OPENER, TWICE. The July archive caught her delivering the
   dishwasher opener at 3:58, holding a real exchange at 5:12, then posting
   the dishwasher opener AGAIN backdated to 4:31. Mechanism: the boot-timer
   sweep and the visibility force-sweep can reach the same friend within a
   second of each other, both pass openerDue before either marks the day,
   and each drafts from a history snapshot blind to the other — so even the
   echo guard sees nothing. Three locks, all needed:
   1. one flight per friend at a time (openerBusy);
   2. every flight re-reads the FRESH friend record before checking due,
      so a mark written moments ago by any other path is seen;
   3. after generation, the opener commits ONLY if the thread is exactly
      where the draft left it — one message landed since (his, hers,
      another opener's) and the draft is stale: discarded whole, like a
      text she thought better of. This also closes the background hole
      where his send couldn't cancel a flight (openerFlight only tracks
      foreground ones). */
const openerBusy = new Set();

async function maybeOpener(friend, background) {
  if (sending && !background) return;
  if (openerBusy.has(friend.id)) return;
  openerBusy.add(friend.id);
  const flight = { cancelled: false };
  if (!background) openerFlight = flight;
  try {
    friend = (await DB.getFriend(friend.id)) || friend;
    const msgs = await DB.getMessages(friend.id);
    const last = msgs[msgs.length - 1];
    if (!ClaudeAPI.openerDue(friend, msgs)) return;
    // mark first so a slow request can't double-fire
    friend.lastOpenerDay = ClaudeAPI._dayKey(ClaudeAPI._now());
    friend.lastOpenerAt = ClaudeAPI._now(); // second-surprise spacing reads this
    friend.vibeSeed = ClaudeAPI._now() % 1e9; // openers always start a fresh burst
    friend.burstStart = ClaudeAPI._now();
    await DB.saveFriend(friend);

    if (!background) {
      $('#typing').classList.remove('hidden');
      $('#chat-status').textContent = 'typing…';
      scrollChat();
    }

    const settings = Settings.get();
    const history = msgs.map(m => ({ role: m.role, text: m.text }));
    // The nudge rides as an unsaved synthetic turn — it exists only in this
    // one request, never in stored history.
    const nudge = { role: 'user', text: ClaudeAPI.openerNudge(ClaudeAPI._now() - last.ts, last.role === 'assistant', friend) };
    const result = await ClaudeAPI.chat(friend, history.concat([nudge]), settings, last.ts, null);
    // He started talking while she was drafting — his message wins, her
    // opener is discarded whole (no bubbles, no state, no memory of it).
    if (flight.cancelled) return;
    // Lock 3: the thread must be exactly where the draft left it. Any
    // message that landed while she was drafting (his send, a parallel
    // path) makes this opener a reply to a conversation that no longer
    // exists — discarded whole, same contract as the cancel above.
    const freshMsgs = await DB.getMessages(friend.id);
    const lastFresh = freshMsgs[freshMsgs.length - 1];
    if (freshMsgs.length !== msgs.length || (lastFresh && last && lastFresh.ts !== last.ts)) return;
    // The echo guard may decide the opener had nothing new to say (every
    // bubble restated a finished topic) — on this path silence is a real
    // outcome, not an error: she simply didn't text first today. Nothing is
    // saved, nothing is cleared; the day was already marked above.
    if (!result.bubbles || !result.bubbles.length) {
      await DB.saveFriend(friend);   // keep the beat log the nudge may have rolled
      return;
    }
    // She texted while he was away, not the instant he opened the app: place
    // the message at a believable past moment inside her waking hours since
    // the gap began. Nothing else in the app makes her feel like a person with
    // a phone of her own more cheaply than this.
    const openerTs = plausiblePastTs(friend, last.ts);
    let openerPreviews = result.bubbles.filter(b => !PHOTO_MARKER.test(b));
    if (background || !currentFriend || currentFriend.id !== friend.id) {
      // he left the chat mid-generation — save quietly, no rendering. Photo
      // markers are dropped: generating into a chat nobody is watching
      // spends money on an image she can simply take next time.
      for (let i = 0; i < openerPreviews.length; i++) {
        await DB.addMessage({ friendId: friend.id, role: 'assistant', text: openerPreviews[i], ts: openerTs + i * 40000 });
      }
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
        const p = await deliverBubble(friend, b, openerTs);
        if (p) openerPreviews.push(p);
      }
    }
    if (result.state) {
      const outcome = ClaudeAPI.applyStateDeltas(friend, result.state, { history, gapMs: ClaudeAPI._now() - last.ts });
      friend.state = outcome.state;
      DB.addEvent(Object.assign({ friendId: friend.id, ts: ClaudeAPI._now() }, outcome.event)).catch(() => {});
      if (result.state.new_memories.length) ClaudeAPI.mergeMemories(friend, result.state.new_memories);
    }
    friend.leftOnRead = 0;
    friend.unresolved = null;   // she came back to it herself
    friend.lastActivity = openerTs;
    if (openerPreviews.length) {
      friend.lastPreview = openerPreviews[openerPreviews.length - 1];
      // unread only counts when he isn't the one looking at it
      if (!currentFriend || currentFriend.id !== friend.id) {
        friend.unread = (Number(friend.unread) || 0) + openerPreviews.length;
      }
    }
    await DB.saveFriend(friend);
    renderFriendsList();
  } catch { /* silent — she just didn't text first today */ } finally {
    openerBusy.delete(friend.id);
    if (openerFlight === flight) openerFlight = null;
    // If the user trumped this opener, his send owns the typing indicator
    // and status line now — touching them here would stomp a live send.
    if (!background && !flight.cancelled) {
      $('#typing').classList.add('hidden');
      $('#chat-status').textContent = fmtClock();
    }
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

/* An opener is written the moment he opens the app, but she "sent" it while
   he was gone. Pick a believable past moment: inside her waking hours, at
   least a few minutes ago, never before the last message. Deterministic per
   friend+day so it doesn't jitter between renders. */
function plausiblePastTs(friend, lastTs) {
  const now = ClaudeAPI._now();
  const gap = now - lastTs;
  if (gap < 3 * 3600000) return now - Math.min(gap / 2, 9 * 60000);
  const h = ClaudeAPI._hash32(String(friend.id) + '|arrive|' + ClaudeAPI._dayKey(now));
  // somewhere in the last stretch of the gap, capped at 14h back
  const back = 20 * 60000 + (h % (Math.min(gap * 0.6, 14 * 3600000) - 20 * 60000));
  let ts = now - back;
  const hour = new Date(ts).getHours();
  if (hour >= 2 && hour < 8) ts = now - Math.min(gap - 60000, 90 * 60000); // she wasn't up at 4am
  return Math.max(lastTs + 60000, Math.min(ts, now - 5 * 60000));
}

/* ---- provider-down badge ----
   There is no second provider to quietly swap in any more, so an outage is
   reported rather than hidden. The badge is persistent, not a toast: it stays
   in the corner until a message actually goes through, because the honest
   state of the app while Grok is unreachable is "not working", and a
   notification that scrolls away tells you that for two seconds. */
function providerDown(err) {
  const el = $('#provider-down');
  if (!el) return;
  const status = err && err.status;
  el.querySelector('.pd-code').textContent = status ? String(status) : '404';
  el.querySelector('.pd-text').textContent = (err && err.message) || 'Grok is unreachable';
  el.title = (err && err.message) || 'Grok is unreachable — tap to open Settings';
  el.classList.remove('hidden');
}

function providerUp() {
  const el = $('#provider-down');
  if (el) el.classList.add('hidden');
}

/* ---- her photos (Bedrock image model, optional) ----
   The model marks a photo by making one bubble "[photo] <what it shows>".
   The marker never renders: it either becomes a generated image bubble or,
   when no image model is configured / generation fails, disappears. */
const PHOTO_MARKER = /^\s*\[\s*photo\s*\]?\s*[:\-—]?\s*/i;

async function deliverBubble(friend, b, atTs) {
  const isPhoto = PHOTO_MARKER.test(b);
  if (!isPhoto) {
    const el = bubbleEl('assistant', b);
    $('#chat-messages').appendChild(el);
    refreshTails();
    scrollChat();
    armMessageDelete(el, await DB.addMessage({ friendId: friend.id, role: 'assistant', text: b, ts: atTs || ClaudeAPI._now() }));
    return b;
  }
  const desc = b.replace(PHOTO_MARKER, '').trim();
  const entry = ClaudeAPI.imageEntry(Settings.get());
  if (!entry || !desc) return null;
  $('#typing').classList.remove('hidden');
  $('#chat-status').textContent = 'sending a photo…';
  scrollChat();
  // Every rung of the re-framing ladder lands in the ledger, whether or not
  // a later one succeeds — otherwise a photo that took three tries looks
  // identical to one that worked first time, and there is no way to tell
  // which framings the provider actually objects to.
  ClaudeAPI._onImageDecline = (e, i, total) => {
    DB.addEvent({
      friendId: friend.id, ts: ClaudeAPI._now(), kind: 'imgerr',
      declined: true, status: e.status || 0, reframe: `${i + 1}/${total}`,
      message: String(e.providerMessage || e.message || '').slice(0, 200),
      desc: String(desc || '').slice(0, 160)
    }).catch(() => {});
  };
  try {
    // stable per-friend seed: her photos lean toward the same body and the
    // same rooms instead of rerolling a stranger every time
    const dataUrl = await ClaudeAPI.generateImage(entry, desc, {
      seed: ClaudeAPI._hash32(String(friend.id) + '|photolook') % 1e9,
      // who she is, so every photo is the same woman instead of a new one
      appearance: friend.profile.appearance || '',
      // the photo tracks where the thread actually is, not a fixed neutral
      heat: ClaudeAPI._imageHeat(friend)
    });
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
    // Record image failures the way send failures are recorded, so the
    // analysis archive can show WHY a photo never arrived — a content
    // decision and a bad parameter need opposite fixes and look identical
    // from the outside.
    // A declined run already logged each framing it tried; only log here for
    // the failures the ladder never covered (key, network, model name).
    if (!e.exhausted) {
      DB.addEvent({
        friendId: friend.id, ts: ClaudeAPI._now(), kind: 'imgerr',
        declined: !!e.declined, status: e.status || 0,
        message: String(e.providerMessage || e.message || '').slice(0, 200),
        desc: String(desc || '').slice(0, 160)
      }).catch(() => {});
    }
    toast(e.exhausted
      ? 'Her photo didn\'t send — the provider declined every framing of it.'
      : 'Her photo didn\'t send — ' + e.message, 6000);
    return null;
  } finally {
    ClaudeAPI._onImageDecline = null;
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
    const last = mine[mine.length - 1];
    // "Read" means she saw it and chose to say nothing — a real message of
    // its own. Only shown when his message is genuinely the last thing said.
    const isLast = box.lastElementChild === last || (box.lastElementChild && box.lastElementChild.classList.contains('delivered'));
    const onRead = currentFriend && currentFriend.leftOnRead && isLast;
    const d = document.createElement('div');
    d.className = 'delivered' + (onRead ? ' read' : '');
    d.textContent = onRead ? 'Read' : 'Delivered';
    last.after(d);
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
  if (!currentFriend) return;
  // A blocked send must SAY so — the silent early-return here was the other
  // half of the freeze: taps on Send doing nothing, with no sign of why.
  if (sending) {
    toast('Still working on the last one — it comes back on its own, or frees up within a couple of minutes.');
    return;
  }
  const input = $('#composer-input');
  const text = input.value.trim();
  if (!text) return;

  // 'testlook' is a debug lens, not a message: touch NOTHING else — no
  // history, no state, no model call, no acknowledgment, and it does not
  // even cancel an opener she happens to be drafting. Bare `testlook`
  // renders the appearance sheet as the fixed neck-down mirror check;
  // `testlook <action> [normal|spicy]` (brackets optional) runs the action
  // through the real photo pipeline instead.
  const tl = /^testlook\b([\s\S]*)$/i.exec(text);
  if (tl) {
    input.value = '';
    input.style.height = 'auto';
    updateSendButton();
    let rest = tl[1].replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    let spicy = false;
    const heat = /\s*\b(normal|spicy)\s*$/i.exec(rest);
    if (heat) {
      spicy = heat[1].toLowerCase() === 'spicy';
      rest = rest.slice(0, heat.index).trim();
    }
    runTestLook(currentFriend, rest || null, spicy);
    return;
  }

  // Her in-flight opener yields to him: discard it and let his send run.
  if (openerFlight) {
    openerFlight.cancelled = true;
    openerFlight = null;
    $('#typing').classList.add('hidden');
  }

  const settings = Settings.get();
  if (!ClaudeAPI.activeEntries(settings).length) {
    providerDown({ status: 401, message: 'No Grok key yet — tap to add one' });
    openSettings();
    return;
  }

  beginSend();
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
  // different sit-down, different her. burstStart anchors the energy's
  // time-of-day bucket so one continuous night keeps one mood.
  if (!lastTs || ClaudeAPI._now() - lastTs > 90 * 60000) {
    friend.vibeSeed = ClaudeAPI._now() % 1e9;
    friend.burstStart = ClaudeAPI._now();
  }

  // show + persist the user's message
  const startHint = $('#chat-start-hint');
  if (startHint) startHint.remove();
  document.querySelectorAll('.transient-note').forEach(n => n.remove());
  if (friend.leftOnRead) friend.leftOnRead = 0; // he came back to it
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

  askNotifyPermission();
  await runReply(friend, history, settings, lastTs, text);
}

/* The testlook lens. Everything about it is transient: the placeholder, the
   rendered image (swept with the other transient notes on the next real
   send), and the generation itself — nothing is written to the DB, so the
   model never sees that this happened. Deliberately does not take the
   composer lock: it is a tool, not a conversation turn. */
let testlookBusy = false;
async function runTestLook(friend, action, spicy) {
  if (testlookBusy || !friend) return;
  const settings = Settings.get();
  const entry = ClaudeAPI.imageEntry(settings);
  if (!entry) {
    toast('No image model configured — add one in Settings to use testlook.');
    return;
  }
  testlookBusy = true;
  const note = document.createElement('div');
  note.className = 'msg sys transient-note';
  note.textContent = action
    ? `test shot — rendering: ${action}${spicy ? ' (spicy)' : ''}…`
    : 'test shot — rendering her appearance sheet…';
  $('#chat-messages').appendChild(note);
  scrollChat();
  try {
    // Mirror check stays 3:4 — the extra headroom of a tall frame is where
    // the model invents junk (duplicate torsos) above the mirror. Scene
    // shots use the real photo pipeline's tall default, because they ARE
    // the real photo pipeline.
    const prompt = action
      ? ClaudeAPI.testLookScenePrompt(friend, action, spicy, ClaudeAPI._now())
      : ClaudeAPI.testLookPrompt(friend);
    const url = await ClaudeAPI.generateImage(entry, prompt,
      action ? { raw: true } : { raw: true, width: 768, height: 1024 });
    note.remove();
    const div = bubbleEl('assistant', '', { photo: url });
    div.classList.add('transient-note'); // never persisted; gone on the next real send
    $('#chat-messages').appendChild(div);
    scrollChat();
  } catch (err) {
    note.textContent = 'test shot failed — ' + ((err && err.message) || 'image error');
    setTimeout(() => note.remove(), 8000);
  } finally {
    testlookBusy = false;
  }
}

/* The model call and everything that lands because of it. Extracted from
   sendMessage so an interrupted send — tab closed, phone locked long enough
   for the page to be evicted — can be finished on the next open without the
   user retyping a thing. */
async function runReply(friend, history, settings, lastTs, fallbackPreview, attempt) {
  // Recorded BEFORE the request leaves, so a page that dies mid-flight leaves
  // a trail rather than a hole. One record per friend: a second attempt at
  // the same unanswered message replaces it instead of queueing up.
  const outboxId = 'send-' + friend.id;
  // The attempt count RIDES ON the record. Without it a resume that is itself
  // interrupted writes a fresh record at zero attempts and the loop is
  // immortal — which is exactly how this stranded a composer across restarts.
  DB.putOutbox({
    id: outboxId, kind: 'send', friendId: friend.id,
    ts: ClaudeAPI._now(), attempts: Number(attempt) || 0
  }).catch(() => {});
  // Who a background notification would be from, for the duration of this
  // send only. Cleared in the finally so nothing else can raise one.
  ClaudeAPI._notify = { title: friend.profile.name || 'frenz', preview: 'sent you a message' };

  $('#typing').classList.remove('hidden');
  $('#chat-status').textContent = 'typing…';
  // Slow must never look like dead: after 20s the status starts counting, so
  // a long reasoning stall reads as "still working" instead of a hang.
  const sentAt = Date.now();
  const slowTick = setInterval(() => {
    const s = Math.round((Date.now() - sentAt) / 1000);
    if (s >= 20 && $('#chat-status').textContent.startsWith('typing')) {
      $('#chat-status').textContent = `typing… (${s}s — long one)`;
    }
  }, 5000);

  try {
    const result = await ClaudeAPI.chat(friend, history, settings, lastTs, (attempt, retryErr) => {
      // Say WHY when we know: a rate-limit wait reads as dead air unless
      // named — and say how long it has been, because "reconnecting…" with
      // no clock attached is the thing that feels infinite.
      const el = Math.round((Date.now() - sentAt) / 1000);
      const left = Math.round(ClaudeAPI._budgetLeft() / 1000);
      const clock = ` · ${el}s${left > 0 && left < 1e6 ? `, giving up in ${left}s` : ''}`;
      $('#chat-status').textContent = (retryErr && retryErr.quota
        ? `rate-limited — retrying (${attempt})`
        : retryErr && retryErr.timeout
          ? `no response — trying elsewhere (${attempt})`
          : `reconnecting… (${attempt})`) + clock;
    });
    providerUp();   // something came back, so whatever was wrong isn't any more

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

    if (result.leftOnRead) {
      // she read it and said nothing. That is the whole reply.
      friend.leftOnRead = ClaudeAPI._now();
      friend.unresolved = { kind: 'read', ts: ClaudeAPI._now(), reason: 'left him on read' };
    } else if (result.bubbles.length) {
      friend.leftOnRead = 0;
    }

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
      // an exchange that cost her something is remembered as unfinished, so
      // her next first-text reckons with it instead of breezing past
      const ap = outcome.event.applied || {};
      if ((ap.comfort || 0) <= -2 || (ap.closeness || 0) <= -2) {
        friend.unresolved = { kind: 'rough', ts: ClaudeAPI._now(), reason: outcome.event.reason || '' };
      } else if ((ap.comfort || 0) >= 1 && friend.unresolved && friend.unresolved.kind === 'rough') {
        friend.unresolved = null; // a good exchange repairs it
      }
      if (result.state.new_memories.length) {
        // near-duplicates strengthen the original instead of piling up
        ClaudeAPI.mergeMemories(friend, result.state.new_memories);
      }
    }
    // pipeline record for the analysis archive: what actually happened on
    // this send (model served, latency, tokens, trims, hidden retries).
    // Same fire-and-forget ledger as the state events; the relationship
    // chart ignores it (no applied/after/tension fields).
    if (result.meta) {
      DB.addEvent({
        friendId: friend.id, ts: ClaudeAPI._now(), kind: 'send',
        model: result.meta.servedModel, latencyMs: result.meta.latencyMs,
        inTok: result.meta.inTok, outTok: result.meta.outTok, cachedTok: result.meta.cachedTok,
        omitted: result.omitted || 0, attempts: result.meta.attempts || 1,
        strictRegen: !!result.meta.strictRegen, parseSalvage: !!result.meta.parseSalvage,
        skippedCount: (result.skipped || []).length
      }).catch(() => {});
    }

    friend.lastActivity = ClaudeAPI._now();
    refreshTails();
    friend.lastPreview = previews.length ? previews[previews.length - 1] : fallbackPreview;
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
    providerDown(err);
    // The corner badge is easy to miss mid-conversation — say it in the
    // thread too, transiently, in plain words. And log it: failed sends are
    // exactly the story the analysis archive needs to tell.
    const note = document.createElement('div');
    note.className = 'msg sys transient-note';
    note.textContent = (err && err.quota)
      ? "Didn't go through — Grok is rate-limiting this key right now. Give it a minute; it recovers on its own."
      : "Didn't go through — " + ((err && err.message) || 'connection problem') + ' Your message is still here; try again.';
    $('#chat-messages').appendChild(note);
    scrollChat();
    DB.addEvent({
      friendId: friend.id, ts: ClaudeAPI._now(), kind: 'senderr',
      status: (err && err.status) || 0,
      message: String((err && err.message) || '').slice(0, 140)
    }).catch(() => {});
  } finally {
    clearInterval(slowTick);
    endSend();
    ClaudeAPI._notify = null;
    // Settled either way — a delivered reply and a reported failure are both
    // finished business, and neither should be replayed on the next open.
    DB.clearOutbox('send-' + friend.id).catch(() => {});
    $('#chat-status').textContent = fmtClock();
  }
}

/* A send that never finished. The user's message is already in the thread
   (it is persisted before the request goes out), so recovery is simply
   asking for the reply again — which is why the outbox record holds an id
   and nothing else. Anything the app cannot honestly finish is dropped
   rather than left to look pending forever. */
/* RESUMING A STRANDED SEND — the version that cannot trap you.

   The first cut ran on boot and on every return to the app: it hunted for an
   unfinished send, NAVIGATED into that friend's thread, and locked the
   composer for the length of a fresh request. Worse, runReply re-writes the
   outbox record as its first act, so a resume that was itself interrupted
   re-armed the very thing that stranded you. Force-quitting walked straight
   back into it. That is the "closing and coming back doesn't help, and I
   can't type" loop.

   Now: it never navigates and never runs on boot. It runs only for the
   thread you have just opened, at most twice per stranded message, and only
   while the moment is still live. If it gives up, it gives up quietly and
   your message is simply sitting there to send again. */
const RESUME_MAX_ATTEMPTS = 2;
const RESUME_WINDOW_MS = 60 * 60 * 1000;
let resuming = false;

async function resumeIfStranded(friend) {
  if (resuming || sending || !friend) return;
  let rec = null;
  try { rec = (await DB.listOutbox()).find(r => r && r.kind === 'send' && r.friendId === friend.id); }
  catch (_) { return; }
  if (!rec) return;

  const dead = ClaudeAPI._now() - (rec.ts || 0) > RESUME_WINDOW_MS
    || (rec.attempts || 0) >= RESUME_MAX_ATTEMPTS;
  const msgs = await DB.getMessages(friend.id).catch(() => []);
  const last = msgs[msgs.length - 1];
  // She already answered, the moment has passed, or we have tried enough:
  // drop the record so it can never come back.
  if (dead || !last || last.role !== 'user') {
    await DB.clearOutbox(rec.id).catch(() => {});
    return;
  }
  const settings = Settings.get();
  if (!ClaudeAPI.activeEntries(settings).length) return;

  resuming = true;
  try {
    beginSend();
    const note = document.createElement('div');
    note.className = 'msg sys transient-note';
    note.textContent = 'Picking that back up…';
    $('#chat-messages').appendChild(note);
    scrollChat();
    const prior = msgs.slice(0, -1);
    const history = msgs
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, text: m.text }));
    await runReply(friend, history, settings,
      prior.length ? prior[prior.length - 1].ts : null, last.text,
      (rec.attempts || 0) + 1);
  } finally {
    resuming = false;
    endSend();
  }
}

/* Background notifications are the closest a serverless app gets to push:
   the request outlives the page inside the service worker, and when it
   lands with nobody looking, the worker raises this. Asked for at the
   moment it becomes meaningful — after a real send — never on first run. */
async function askNotifyPermission() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  if (localStorage.getItem('frenz-notify-asked')) return;
  localStorage.setItem('frenz-notify-asked', '1');
  try { await Notification.requestPermission(); } catch (_) { /* declined is fine */ }
}

/* ---------------- panic cover ----------------
   Triple-tap anywhere → instant black screen, indistinguishable from the
   display being off. Triple-tap again to come back. Single taps on the
   cover do nothing (a glance-over-the-shoulder can't reveal anything), and
   while the app is covered nothing underneath is tappable. Interactive
   elements don't count toward the three taps, so fast typing or button
   mashing can't black the screen by accident. */
let panicTaps = [];
document.addEventListener('pointerdown', (e) => {
  const cover = $('#panic-cover');
  if (!cover) return;
  const covered = !cover.classList.contains('hidden');
  if (!covered && e.target.closest('button, input, textarea, select, a')) {
    panicTaps = [];
    return;
  }
  const now = Date.now();
  panicTaps = panicTaps.filter(t => now - t < 600);
  panicTaps.push(now);
  if (panicTaps.length >= 3) {
    panicTaps = [];
    cover.classList.toggle('hidden');
  }
}, true);

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
  const before = Settings.get();
  if (poolDraft) s.pool = poolDraft;

  // Whichever Grok route you just keyed is the one you meant to use, so it
  // goes to the front — the other stays as a slot you can key later.
  const newlyKeyed = s.pool.filter(e =>
    entryHasKey(e) && !(before.pool || []).some(p => p.id === e.id && p.apiKey && p.apiKey.trim()));

  if (newlyKeyed.length) {
    const ids = new Set(newlyKeyed.map(e => e.id));
    s.pool = [...s.pool.filter(e => ids.has(e.id)), ...s.pool.filter(e => !ids.has(e.id))];
    Settings.set(s);
    toast(`${newlyKeyed[0].label} key saved`);
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
    let sub = e.photosOnly ? (e.imageModel || 'photos') + ' · photos only' : (e.model || 'not configured yet');
    if (!entryHasKey(e)) sub += ' · needs a key';
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
        <button type="button" class="icon-btn" data-act="edit" title="Configure">⚙</button>
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
  entry.preset = name;
  poolDraft.push(entry);
  renderPool();
  openEntryEditor(entry.id);
}

function entryHasKey(e) {
  return !!(e && e.apiKey && String(e.apiKey).trim());
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
  $('#e-keyhint').textContent = preset ? preset.keyHint : 'Paste the key for this endpoint.';
  $('#e-key-label').classList.remove('hidden');
  $('#e-model').value = e.model || '';
  $('#e-ctx').value = e.contextTokens || 1000000;
  $('#e-test-result').textContent = '';
  // Bedrock is addressed by region rather than a base URL, and its model list
  // is fixed rather than fetched.
  const isBedrock = e.kind === 'bedrock';
  // Photos: Bedrock (Nova Canvas) or xAI direct (grok-imagine). The region
  // row only means anything on Bedrock.
  const isXai = ClaudeAPI._isXaiEntry(e);
  const hasImages = isBedrock || isXai;
  $('#e-region-label').classList.toggle('hidden', !isBedrock);
  $('#e-url').parentElement.classList.toggle('hidden', isBedrock);
  $('#e-image-wrap').classList.toggle('hidden', !hasImages);
  $('#btn-test-image').classList.toggle('hidden', !hasImages);
  $('#e-img-region').parentElement.classList.toggle('hidden', !isBedrock);
  $('#e-img-preview').classList.add('hidden');
  if (hasImages) {
    $('#e-img-model').value = e.imageModel || '';
    $('#e-img-region').value = e.imageRegion || '';
    $('#e-photos-only').checked = !!e.photosOnly;
    $('#e-img-model').placeholder = isXai ? 'grok-imagine-image' : 'amazon.nova-canvas-v1:0';
    $('#e-img-key').value = e.imageKey || '';
    $('#e-imghint').textContent = isXai
      ? 'grok-imagine-image (≈2¢/photo) or grok-imagine-image-quality (≈5¢), paid from this entry\'s own key. Clear the field to turn photos off.'
      : 'grok-imagine-image (≈2¢/photo) sends her pictures through xAI — paste an xAI key below and your chat keeps running on Bedrock. A Bedrock image model ID like amazon.nova-canvas-v1:0 also works if your account has access to it. Clear the field to turn photos off.';
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
  // Image models come from a different route (and on xAI, a different
  // endpoint entirely), so they are fetched separately rather than filtered
  // out of the chat list. Best-effort: an empty list just leaves free text.
  ClaudeAPI.listImageModels(e.baseUrl, ClaudeAPI._imageKeyFor(e) || e.apiKey).then(ids => {
    const idl = $('#e-img-models');
    if (!idl) return;
    idl.innerHTML = '';
    for (const id of ids) {
      const o = document.createElement('option');
      o.value = id;
      idl.appendChild(o);
    }
    const hint = $('#e-imghint');
    if (hint && ids.length) {
      hint.textContent = `${ids.length} image model${ids.length === 1 ? '' : 's'} available on this key: ${ids.join(', ')}. Clear the field to turn photos off.`;
    }
  }).catch(() => { /* the field stays free text */ });
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
  const shellV = (document.querySelector('.app-version') || {}).textContent || '?';
  parts.push('App v' + APP_JS_VERSION + (shellV !== APP_JS_VERSION
    ? ' but shell v' + shellV + ' — MIXED VERSIONS. Close the app fully and reopen; if this line persists, clear site data.'
    : '.'));
  const last = ClaudeAPI.lastServed();
  if (last) parts.push('Last message served by ' + last.label + '.');
  for (const e of poolDraft) {
    const info = ClaudeAPI.usageInfo(e);
    if (info.requestsToday || info.rpdHint) {
      parts.push(`${e.label}: ${info.requestsToday}${info.rpdHint ? ' of ~' + info.rpdHint : ''} requests today.`);
    }
  }
  parts.push('There is no second provider behind this one — if Grok is down you will be told, not quietly handed a weaker model.');
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

/* The analysis archive: everything the JSON backup holds, but as one
   readable Markdown document — numbered transcripts, the private-state
   ledger inline, and auto-diagnostics. Built for handing to an analyst
   ("here's what feels off"), not for restoring. Zero API calls. */
async function exportArchive() {
  const friends = await DB.listFriends();
  const messagesByFriend = {}, eventsByFriend = {};
  for (const f of friends) {
    messagesByFriend[f.id] = await DB.getMessages(f.id);
    eventsByFriend[f.id] = await DB.getEvents(f.id);
  }
  const md = ClaudeAPI.buildArchive(friends, messagesByFriend, eventsByFriend);
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `frenz-archive-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Archive downloaded — share the file when reporting what feels off.');
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
  // Recover his name for friends created while the box was blank. Any friend
  // who still has it is as good a source as localStorage — and if one is
  // found, put it back in storage so the next friend starts with it too.
  let knownName = localStorage.getItem('frenz-user-name') || '';
  let knownGender = localStorage.getItem('frenz-user-gender') || '';
  if (!knownName) {
    const named = friends.find(f => f.profile && f.profile.userName);
    if (named) {
      knownName = named.profile.userName;
      knownGender = knownGender || named.profile.userGender || '';
      localStorage.setItem('frenz-user-name', knownName);
      if (knownGender) localStorage.setItem('frenz-user-gender', knownGender);
    }
  }
  for (const f of friends) {
    let changed = Personas.upgradeProfile(f.profile);
    const tpl = Personas.templates.find(x => x.name === f.profile.name);
    // Reveals sync from the template wholesale: they are not user-editable
    // (no editor field), so a stale copy is pure loss — and substring upgrade
    // rules can't reach inside an array of objects, which is exactly how a
    // corrected name survived in a friend's deepest layers.
    if (tpl && tpl.reveals) {
      if (JSON.stringify(f.profile.reveals || []) !== JSON.stringify(tpl.reveals)) {
        f.profile.reveals = tpl.reveals;
        changed = true;
      }
    }
    if (tpl && tpl.established && !f.profile.established) { f.profile.established = true; changed = true; }
    // Appearance arrived in v8.6 as a brand-new field, so the substring
    // upgrade rules cannot reach it — they replace inside an existing string.
    // Backfill from the template, and never overwrite one the user wrote.
    if (tpl && tpl.appearance && !f.profile.appearance) { f.profile.appearance = tpl.appearance; changed = true; }
    // Beats (v10.1) are the same shape of new field: backfill existing
    // friends so the life-beat engine reaches them, never overwrite a bank
    // that already exists.
    if (tpl && tpl.beats && !(f.profile.beats || []).length) { f.profile.beats = tpl.beats; changed = true; }
    if (tpl && tpl.textures && !(f.profile.textures || []).length) { f.profile.textures = tpl.textures; changed = true; }
    // Opening acts (v10.5) are new-field backfill like beats: they only do
    // anything while the relationship is still inside the opening window,
    // so reaching existing early-stage friends is the whole point.
    if (tpl && tpl.opening && !f.profile.opening) { f.profile.opening = tpl.opening; changed = true; }
    // Unsaid seeds are STATE, not profile — mirror creation seeding
    // (state.unsaid = t.unsaidSeed) for friends still inside the opening
    // exchange window: the seed is the aftermath's inner voice, and a thread
    // past the window has its own unsaid life that must never be overwritten.
    if (tpl && tpl.unsaidSeed && f.state && !f.state.unsaid) {
      const win = (tpl.opening && tpl.opening.until) || 40;
      const msgCount = (await DB.getMessages(f.id)).length;
      if (msgCount < win) { f.state.unsaid = tpl.unsaidSeed; changed = true; }
    }
    // Significance seed: stamped at the friend's creation time, so a thread
    // already weeks past its origin event falls outside the reckoning
    // window and nothing changes for it.
    if (tpl && tpl.significantSeed && f.state && !f.state.lastSignificant) {
      f.state.lastSignificant = { ts: f.createdAt || 0, kind: tpl.significantSeed };
      changed = true;
    }
    // A template REVISION is a rewrite, not a tweak: when the world itself was
    // wrong — who is engaged to whom, whose best friend is whose — substring
    // upgrades cannot repair it, and the friend would keep answering from a
    // world that never existed. Refresh her defining text wholesale and swap
    // the seeded (pinned) memories, while messages, state and everything she
    // has actually EARNED in conversation survive untouched.
    if (tpl && (tpl.templateRev || 0) > (f.profile.templateRev || 0)) {
      ['personality', 'plist', 'style', 'interests', 'backstory', 'appearance', 'type', 'photoCandor', 'age'].forEach(k => {
        if (tpl[k]) f.profile[k] = tpl[k];
      });
      f.profile.world = Personas.WORLD || '';
      f.profile.reveals = tpl.reveals || [];
      f.profile.beats = tpl.beats || [];
      f.profile.textures = tpl.textures || [];
      f.profile.opening = tpl.opening || null;
      f.profile.established = !!tpl.established;
      // Seeded memories are deliberately NOT pinned (v9.1 — pinning made her
      // recite them every turn), so filtering on `pinned` kept the OLD seeds
      // and prepended the new ones: every revision quietly doubled her origin
      // story. Age is the reliable tell instead — nothing genuinely EARNED
      // can exist within a minute of the friend being created, because that
      // takes a full exchange.
      const born = f.createdAt || 0;
      const earned = (f.memories || []).filter(m => m && !m.pinned && (m.ts || 0) > born + 60000);
      f.memories = (tpl.seedMemories || []).map(m => ClaudeAPI._normMemory(
        Object.assign({ ts: born || ClaudeAPI._now(), lastAccessed: ClaudeAPI._now() }, m))).concat(earned);
      // A wrong template SEED gets corrected in live state exactly once —
      // the logic (and its rev-comparison story) lives in
      // Personas.applySeedFix, shared with the verify harness. Must run
      // BEFORE templateRev is stamped below, or the fix never fires.
      Personas.applySeedFix(f, tpl);
      f.profile.templateRev = tpl.templateRev;
      changed = true;
    }
    // The world map is shared and not user-editable, so a stale copy is pure
    // loss — refresh it for every template friend whether or not the template
    // revision moved, rather than only backfilling an empty one.
    if (tpl && f.profile.world !== (Personas.WORLD || '')) { f.profile.world = Personas.WORLD || ''; changed = true; }
    // Relationship floors (v10.3): existing friends lock in the level they
    // have already reached, so the first absence after this update cannot
    // regress what was genuinely earned. Runs for custom friends too (floors
    // are state, not template), and deliberately AFTER the templateRev /
    // seedFix block above — a floor must never fossilize state a seed
    // correction was about to fix.
    if (f.state && !f.state.floors) { f.state.floors = ClaudeAPI.initFloors(f); changed = true; }
    if (knownName && !f.profile.userName) { f.profile.userName = knownName; changed = true; }
    // Same for the founding facts: friends made before v8.6 started with an
    // empty memory list and the state model would never record an event that
    // predates message one. Only seeded when she has no memories at all, so a
    // real relationship's recall is never overwritten.
    if (tpl && tpl.seedMemories && !(f.memories || []).length) {
      f.memories = tpl.seedMemories.map(m => ClaudeAPI._normMemory(
        Object.assign({ ts: f.createdAt || ClaudeAPI._now(), lastAccessed: ClaudeAPI._now() }, m)));
      changed = true;
    }
    // Sliders were never stored on created friends, so anything reading them
    // (the flirt-sport branch, curiosity) silently saw nothing. Backfill from
    // the template, and give any friend — custom ones included — a curiosity
    // value so the dial is never simply absent.
    if (tpl && tpl.sliders && !f.profile.sliders) { f.profile.sliders = Object.assign({}, tpl.sliders); changed = true; }
    if (!f.profile.sliders) { f.profile.sliders = { curiosity: 50 }; changed = true; }
    if (f.profile.sliders.curiosity === undefined) {
      f.profile.sliders.curiosity = (tpl && tpl.sliders && tpl.sliders.curiosity !== undefined) ? tpl.sliders.curiosity : 50;
      changed = true;
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
    if (tpl) await reseedGreeting(f, tpl);
  }
}

/* Her opening text is stored as real messages at creation, so no card rule can
   ever correct it — a rewritten opener stays wrong forever on friends who
   already exist. When the conversation genuinely hasn't started (she has said
   her piece and he has never replied), the seed is safe to replace with the
   current one: nothing of the relationship is lost, because none exists yet. */
async function reseedGreeting(friend, tpl) {
  const want = tpl.greeting || [];
  if (!want.length) return;
  const msgs = await DB.getMessages(friend.id);
  if (!msgs.length) return;
  if (msgs.some(m => m.role === 'user')) return;      // a real conversation — never touched
  if (msgs.some(m => m.photo)) return;
  const have = msgs.map(m => m.text);
  if (have.length === want.length && have.every((t, i) => t === want[i])) return;
  for (const m of msgs) await DB.deleteMessage(m.id);
  const base = ClaudeAPI._now() - want.length * 1000;
  for (let i = 0; i < want.length; i++) {
    await DB.addMessage({ friendId: friend.id, role: 'assistant', text: want[i], ts: base + i * 1000 });
  }
  friend.lastPreview = want[want.length - 1];
  await DB.saveFriend(friend);
}

function init() {
  healStoredSettings();
  purgeStateArtifacts();
  upgradeTemplateFriends();
  $('#btn-new-friend').addEventListener('click', openGallery);
  $('#btn-gallery-back').addEventListener('click', () => showView('view-friends'));
  $('#btn-customize-back').addEventListener('click', () => showView('view-gallery'));
  $('#customize-form').addEventListener('submit', startConversation);
  $('#btn-builder-back').addEventListener('click', () => showView('view-gallery'));
  $('#btn-builder-prev').addEventListener('click', builderPrev);
  $('#btn-builder-next').addEventListener('click', builderNext);
  $('#btn-builder-restart').addEventListener('click', builderRestart);
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

  // she may have texted while he was away — populate the main screen first
  setTimeout(() => { sweepOpeners(); }, 1200);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !sending) sweepOpeners();
  });
  $('#btn-settings').addEventListener('click', openSettings);
  $('#provider-down').addEventListener('click', () => { providerUp(); openSettings(); });
  // Skipping time without sweeping made the skip pointless: every clock
  // moved, but nobody was ever ASKED if they'd text during the jump — four
  // skipped days landed in total silence until the next app relaunch.
  $('#btn-skip-6h').addEventListener('click', () => {
    ClaudeAPI.addTimeOffset(6 * 3600000);
    renderTimeStatus(); updateChatClock();
    toast('Skipped ahead 6 hours — it\'s now ' + fmtClock() + ' for everyone.');
    setTimeout(() => { if (!sending) sweepOpeners(true); }, 600);
  });
  $('#btn-skip-1d').addEventListener('click', () => {
    ClaudeAPI.addTimeOffset(24 * 3600000);
    renderTimeStatus(); updateChatClock();
    toast('Skipped ahead a day.');
    setTimeout(() => { if (!sending) sweepOpeners(true); }, 600);
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
    if (e) e.contextTokens = parseInt($('#e-ctx').value, 10) || 1000000;
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
  $('#e-img-key').addEventListener('input', () => {
    const e = draftEntry(selectedEntryId);
    if (e) e.imageKey = $('#e-img-key').value.trim();
  });
  $('#e-photos-only').addEventListener('change', () => {
    const e = draftEntry(selectedEntryId);
    if (!e) return;
    const want = $('#e-photos-only').checked;
    // Ticking this on the entry that actually serves chat silently leaves the
    // app with no chat provider at all — the failure looks like "she stopped
    // replying", miles from the checkbox that caused it. Refuse it instead.
    if (want) {
      const others = poolDraft.filter(o => o !== e && o.enabled && !o.photosOnly && entryHasKey(o));
      if (!others.length) {
        $('#e-photos-only').checked = false;
        e.photosOnly = false;
        toast('That is the provider running your chats — turn it on only for a second key added just for photos.', 5200);
        return;
      }
    }
    e.photosOnly = want;
    renderPool();
  });
  $('#btn-test-image').addEventListener('click', async () => {
    const e = draftEntry(selectedEntryId);
    if (!e) return;
    const out = $('#e-test-result');
    if (!e.imageModel) {
      e.imageModel = 'grok-imagine-image';
      $('#e-img-model').value = e.imageModel;
    }
    if (!ClaudeAPI._imageKeyFor(e)) {
      out.textContent = ClaudeAPI._isGrokImageModel(e.imageModel) && !ClaudeAPI._isXaiEntry(e)
        ? '✗ grok-imagine needs an xAI key — paste one in "Image API key" above.'
        : '✗ Paste your API key first.';
      return;
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
      if (r.context && r.context < (parseInt($('#e-ctx').value, 10) || 1000000)) {
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
  $('#btn-archive').addEventListener('click', () => exportArchive().catch(err => toast('Archive failed: ' + err.message)));
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
    // updateViaCache 'none': the byte-diff check that discovers a new
    // version must hit the network, not the HTTP cache — with a cache-first
    // shell, this check is the ONLY update path.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => {
        // check for updates on every return to the app, not just navigations
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => { /* offline shell is a bonus, not required */ });
    // When a NEW worker takes over, reload once so the page re-opens on the
    // new version's atomic snapshot. Guard one: skip the very first
    // controller (initial install — the page that registered it is already
    // current). Guard two: never yank a live send; the stale shell is still
    // internally consistent, and the next open completes the update.
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }
      if (sending) return;
      location.reload();
    });
    ClaudeAPI.watchServiceWorker();
    // Returning to the app is a good moment to finish a stranded send — but
    // only for the thread already on screen. Nothing here may navigate.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !sending && currentFriend) {
        resumeIfStranded(currentFriend).catch(() => {});
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
