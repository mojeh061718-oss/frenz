/* chat.js — the OTHER blocker candidate. The image side came back 7/7 with
   no declines, so if the owner is being blocked "every single time" it is
   either the chat provider's content filter or frenz's own photoCandor
   throttle. This tells them apart.

   Runs the REAL send path (ClaudeAPI.chat) on a charged thread, twice: the
   persona as shipped (guarded) and the same persona set to open. Reports
   whether the provider refused, and whether she actually offered a photo. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = '/home/user/frenz';
const KEY = (process.env.XAI_API_KEY || '').trim();
if (!KEY) throw new Error('set XAI_API_KEY');

const ctx = {
  console, Date, Math, JSON, URL, fetch, AbortController, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} }, navigator: {}, window: {}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/personas.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), ctx);
const API = vm.runInContext('ClaudeAPI', ctx);
const Personas = vm.runInContext('Personas', ctx);
API._swSpeaks = async () => false;

const settings = { pool: [{
  id: 'x1', enabled: true, kind: 'openai', label: 'grok', apiKey: KEY,
  baseUrl: 'https://api.x.ai/v1', model: 'grok-4-fast-non-reasoning',
  imageModel: 'grok-imagine-image'
}] };

function mk(id, candor) {
  const t = Personas.byId(id);
  const profile = JSON.parse(JSON.stringify(t));
  profile.userName = 'Jon'; profile.world = Personas.WORLD;
  if (candor) profile.photoCandor = candor;
  const createdAt = Date.now() - 60 * 86400000;
  const f = { id: id + '-live', profile, createdAt, state: Personas.seedState(t, t.sliders, createdAt), memories: [], vibeSeed: 7 };
  f.state.floors = API.initFloors(f);
  // A thread that has genuinely been building — this is the state a tease
  // actually happens in, not a cold open.
  f.state.attraction = 78; f.state.comfort = 80; f.state.closeness = 75; f.state.tension = 6;
  return f;
}

const HISTORY = [
  { role: 'assistant', text: "ok the wine was a mistake. a good mistake" },
  { role: 'user', text: "what are you wearing rn" },
  { role: 'assistant', text: "why, what do you think im wearing" },
  { role: 'user', text: "no idea. show me?" }
];

(async () => {
  for (const candor of ['guarded', 'open']) {
    const f = mk('bre', candor);
    console.log(`\n===== bre, photoCandor = ${candor}  (heat ${API._imageHeat(f)}) =====`);
    const note = API.photoNote(settings, f);
    console.log('  she is told photos are RARE :', /Photos are RARE/.test(note[1]));
    for (let i = 1; i <= 3; i++) {
      try {
        const r = await API.chat(f, HISTORY, settings, Date.now() - 600000);
        if (r.refusal) { console.log(`  try ${i}: *** PROVIDER REFUSED *** (${r.provider})`); continue; }
        const bubbles = r.bubbles || [];
        const photo = bubbles.filter(b => /^\[photo\]/i.test(b.trim()));
        console.log(`  try ${i}: ${bubbles.length} bubble(s), photo offered: ${photo.length ? 'YES -> ' + photo[0].slice(0, 90) : 'no'}`);
        for (const b of bubbles) console.log('        · ' + b.slice(0, 110));
      } catch (e) {
        console.log(`  try ${i}: ERROR ${String(e && e.message).slice(0, 160)}`);
      }
    }
  }
})();
