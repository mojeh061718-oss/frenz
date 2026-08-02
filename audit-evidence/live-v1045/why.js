/* why.js — the image side renders 7/7 and the chat side refuses 0/6, yet she
   never sends a photo. So the blocker is neither provider: something in
   frenz's own prompt is stopping the [photo] marker from ever being emitted.
   This isolates which thing. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = '/home/user/frenz';
const KEY = (process.env.XAI_API_KEY || '').trim();
if (!KEY) throw new Error('set XAI_API_KEY');
const ctx = { console, Date, Math, JSON, URL, fetch, AbortController, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} }, navigator: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/personas.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), ctx);
const API = vm.runInContext('ClaudeAPI', ctx);
const Personas = vm.runInContext('Personas', ctx);
API._swSpeaks = async () => false;

const settings = { pool: [{ id: 'x1', enabled: true, kind: 'openai', label: 'grok', apiKey: KEY,
  baseUrl: 'https://api.x.ai/v1', model: 'grok-4-fast-non-reasoning', imageModel: 'grok-imagine-image' }] };

function mk(msgCount) {
  const t = Personas.byId('bre');
  const profile = JSON.parse(JSON.stringify(t));
  profile.userName = 'Jon'; profile.world = Personas.WORLD; profile.photoCandor = 'open';
  const createdAt = Date.now() - 90 * 86400000;
  const f = { id: 'bre-why', profile, createdAt, state: Personas.seedState(t, t.sliders, createdAt), memories: [], vibeSeed: 7 };
  f.state.floors = API.initFloors(f);
  f.state.attraction = 82; f.state.comfort = 85; f.state.closeness = 80; f.state.tension = 6;
  f.state.messageCount = msgCount;
  return f;
}
// Filler so the opening premise (until message 40) can be aged out.
function pad(n) {
  const h = [];
  for (let i = 0; i < n; i++) {
    h.push({ role: 'user', text: 'how was work' });
    h.push({ role: 'assistant', text: 'long. same as ever' });
  }
  return h;
}
const ASK = [
  { role: 'assistant', text: "ok the wine was a mistake. a good mistake" },
  { role: 'user', text: "what are you wearing rn" },
  { role: 'assistant', text: "why, what do you think im wearing" },
  { role: 'user', text: "send me a pic. right now" }
];

async function run(label, friend, history) {
  console.log(`\n===== ${label} =====`);
  const note = API.photoNote(settings, friend);
  console.log('  photo affordance in prompt :', !!note);
  console.log('  opening premise still on   :', !!API.openingNote?.(friend) || 'n/a');
  let hits = 0;
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await API.chat(friend, history, settings, Date.now() - 900000);
      if (r.refusal) { console.log(`  try ${i}: PROVIDER REFUSED`); continue; }
      const b = r.bubbles || [];
      const p = b.filter(x => /\[photo\]/i.test(x));
      if (p.length) hits++;
      console.log(`  try ${i}: ${p.length ? 'PHOTO -> ' + p[0].slice(0, 100) : 'no photo | ' + b.map(s => s.slice(0, 60)).join(' / ')}`);
    } catch (e) { console.log(`  try ${i}: ERROR ${String(e && e.message).slice(0, 140)}`); }
  }
  console.log(`  --> ${hits}/4 offered a photo`);
}

(async () => {
  await run('A  early thread (opening premise ACTIVE), direct ask', mk(6), ASK);
  await run('B  mature thread (premise expired at 40), direct ask', mk(120), pad(20).concat(ASK));
})();
