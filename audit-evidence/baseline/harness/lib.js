/* lib.js — headless loader for the FROZEN backup/v10.23 engine.
   Loading pattern per .claude/skills/persona-pipeline/verify.js:1-33, with
   paths adapted to the backup copies. Loads backup/v10.23/js/personas.js then
   backup/v10.23/js/api.js into a `vm` context with a stubbed localStorage.
   Nothing in this harness touches live app code. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');          // repo root (worktree)
const BACKUP = path.join(ROOT, 'backup/v10.23');

/* Fixed reference instant so every run measures the same clock.
   2026-08-05 20:00 *container-local* time (Wednesday evening): the evening
   bucket — textures are live (17:00-02:00 gate), openers roll at ordinary
   odds, no late-night gates. All engine dice are hash-of-(id|dayKey), so with
   this pin every number below reproduces byte-for-byte. */
const BASE = new Date(2026, 7, 5, 20, 0, 0).getTime();
const DAY = 86400000, HOUR = 3600000, MIN = 60000;

function load() {
  const store = {};
  const ctx = {
    console, Date, Math, JSON,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    navigator: {},
    window: {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(BACKUP, 'js/personas.js'), 'utf8'), ctx, { filename: 'backup/v10.23/js/personas.js' });
  vm.runInContext(fs.readFileSync(path.join(BACKUP, 'js/api.js'), 'utf8'), ctx, { filename: 'backup/v10.23/js/api.js' });
  const API = vm.runInContext('ClaudeAPI', ctx);
  const Personas = vm.runInContext('Personas', ctx);
  API._rand = () => 0.5;   // test seam (backup api.js:3435) — retrieval jitter pinned
  return { API, Personas, ctx };
}

function setNow(API, ts) { API._timeOffset = ts - Date.now(); }

/* Replicates the REAL seeding path — backup/v10.23/js/app.js:221-303
   (startConversation), esp. the slider-derived state at app.js:281-283.
   Sliders are the template's own → Personas.sliderText contributes nothing
   (untouched dials), exactly as when the friend is created from the gallery. */
function mkFriend(API, Personas, tplId, opts) {
  opts = opts || {};
  const t = Personas.byId(tplId);
  const sliders = Object.assign({}, t.sliders);
  const notes = Personas.sliderText(sliders, t.name, t.sliders);
  const profile = {
    name: t.name, type: t.type, age: t.age, gender: t.gender,
    personality: (t.personality ? t.personality + ' ' : '') + notes.personality, // app.js:244
    interests: t.interests,
    style: (t.style ? t.style + ' ' : '') + notes.style,                          // app.js:246
    backstory: t.backstory,
    userName: 'Jon', userGender: 'male',
    plist: t.plist || '', appearance: t.appearance || '',
    beats: t.beats || [], textures: t.textures || [],
    opening: t.opening || null, world: Personas.WORLD || '',
    photoCandor: t.photoCandor || 'guarded', templateRev: t.templateRev || 0,
    reveals: t.reveals || [], established: !!t.established,
    sliders, color: t.color
  };
  const now = API._now();
  const createdAt = opts.createdAt !== undefined ? opts.createdAt : now;
  return {
    id: opts.id || (tplId + '-1'),
    profile,
    state: {                                              // app.js:276-292
      mood: t.mood || 'curious, easygoing',
      comfort: Math.min(88, sliders.closeness + 15),      // app.js:281
      closeness: sliders.closeness,                       // app.js:282
      attraction: sliders.attraction || 0,                // app.js:283
      opinion_notes: t.opinion || 'Just starting to get to know them. No strong impressions yet.',
      unsaid: t.unsaidSeed || '',
      lastSignificant: t.significantSeed ? { ts: createdAt, kind: t.significantSeed } : null
    },
    memories: (t.seedMemories || []).map(m => API._normMemory(
      Object.assign({ ts: createdAt, lastAccessed: createdAt }, m))),
    createdAt, lastActivity: now, lastPreview: '',
    vibeSeed: opts.vibeSeed !== undefined ? opts.vibeSeed : 7,
    burstStart: opts.burstStart
  };
}

/* 40 messages (20 exchanges) of NEUTRAL fixture history — mundane life talk,
   authored to stay clear of every register detector in the backup engine:
   no _FLIRT_STRONG/_WEAK, no _INTIMACY_RE, no _DOUBLE_READ_RE, no signoffs,
   no _EARNEST_RE, no _DRINK_RE; he asks a few questions (so reciprocityNote
   stays quiet) and she asks one (so _noQuestionStretch stays quiet). */
const U_LINES = [
  'morning. traffic was unreal today',
  'they rescheduled the standup to 8am which should be illegal',
  'lunch was a sad desk salad again',
  'did you end up watching that documentary?',
  'my monitor died mid call today',
  'the new coffee machine at work is somehow worse',
  'i fixed the shelf. it only took three trips to the hardware store',
  'what did you have for dinner?',
  'the neighbors are mowing at 7am again',
  'found my old headphones in a jacket pocket',
  'the elevator has been broken all week. five floors',
  'how was your monday?',
  'they finally repaved the road by my place',
  'i keep forgetting to return that library book',
  'the printer at work jammed four times today',
  'made chili tonight. too much chili honestly',
  'my phone update rearranged all the icons',
  'did the package ever show up?',
  'long day. mostly meetings that could have been emails',
  'the meeting ran long today so i just got home'
];
const A_LINES = [
  'brutal. i watched the same jam from my window basically',
  '8am standup is a crime against the calendar',
  'desk salad era. i had crackers and ambition',
  'half of it. fell asleep on the couch like a professional',
  'ha. mine does a weird flicker thing i choose to ignore',
  'ours tastes like burnt toast. we persevere',
  'three trips is the legal minimum for any shelf',
  'leftover pasta. zero regrets',
  '7am mowing should require a permit',
  'jacket pocket treasure is the best kind',
  'five floors is cardio nobody signed up for',
  'monday was fine. long, but fine. how was yours?',
  'about time. that road was all pothole',
  'the fines are like a dollar, live a little',
  'printers can smell fear, everyone knows this',
  'too much chili is a myth',
  'why do updates do that. chaos for no reason',
  'it did! left in the bushes like contraband',
  'the meeting-that-should-be-an-email industrial complex',
  'same kind of day here honestly. tell me something good'
];

/* Build n messages ending with HIS live message at endTs, 30 min apart.
   The stream opens with HER greeting-style line (threads in this app open
   with her), then alternates U/A, ending on his live message: 40 entries. */
function fixtureHistory(n, endTs) {
  const stream = [{ role: 'assistant', text: 'ok new week. it had better treat us better than the last one' }];
  for (let i = 0; i < 20; i++) {
    stream.push({ role: 'user', text: U_LINES[i] });
    if (i < 19) stream.push({ role: 'assistant', text: A_LINES[i] });
  }
  // stream = A U0 A0 U1 A1 ... U19  (40 entries, ends on his live message)
  const take = stream.slice(-n);
  const out = take.map((m, j) => ({ role: m.role, text: m.text, ts: endTs - (take.length - 1 - j) * 30 * MIN }));
  return out;
}

/* Assemble the full prompt exactly in engine order (_buildPlainRequest order:
   persona, recap, dynamic — which sets _witLicensed — then plist, then phi).
   memories go through the real selectMemories retrieval. */
function assemble(API, friend, history, lastTs, tier, jsonMode) {
  if (jsonMode === undefined) jsonMode = true;
  const persona = API.buildPersona(friend, tier);
  const recap = API._recapBlock(friend);
  const memories = API.selectMemories(friend, history, 9000);
  const dynamic = API.buildDynamicContext(friend, lastTs, 0, history.length, memories, null, history);
  const plist = API._plist(friend);
  const phi = API._phi(friend, jsonMode, history.length, API._ruts(history, friend), API._shapeRut(history));
  const instr = jsonMode ? API._jsonInstruction() : API._plainInstruction();
  return { persona, dynamic, plist, phi, recap, instr };
}

/* ---- normalized content-word 4-grams (dup scanner, item 2) ---- */
const GRAM_STOP = new Set(('the a an and or but so if then than that this these those it its i you he she we they them him his her hers my your yours me was were is are be been being am do did does done have has had will would could should can may might must not no yes of in on at to for from with without into onto over under out up down as by about after before between while when where who whom why how what which').split(/\s+/));
function tokens(text) {
  return String(text).toLowerCase().replace(/[‘’']/g, '').split(/[^a-z0-9]+/).filter(w => w && !GRAM_STOP.has(w));
}
function grams4(text) {
  const t = tokens(text);
  const set = new Set();
  for (let i = 0; i + 3 < t.length; i++) set.add(t.slice(i, i + 4).join(' '));
  return set;
}

module.exports = { load, setNow, mkFriend, fixtureHistory, assemble, grams4, tokens, BASE, DAY, HOUR, MIN, U_LINES, A_LINES };
