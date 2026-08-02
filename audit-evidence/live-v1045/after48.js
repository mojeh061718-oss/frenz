/* after48.js — live proof of the three v10.48 fixes, with the page-global
   Settings DEFINED (the earlier why.js probe missed it, so its prompts had
   no photo section at all — recorded in findings.md; this probe is faithful
   to the app). */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = '/home/user/frenz', OUT = __dirname;
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
ctx.Settings = { get: () => settings };   // the page global the app provides

function mk() {
  const t = Personas.byId('bre');
  const profile = JSON.parse(JSON.stringify(t));
  profile.userName = 'Jon'; profile.world = Personas.WORLD; profile.photoCandor = 'open';
  const createdAt = Date.now() - 90 * 86400000;
  const f = { id: 'bre-after48', profile, createdAt, state: Personas.seedState(t, t.sliders, createdAt), memories: [], vibeSeed: 7 };
  f.state.floors = API.initFloors(f);
  f.state.attraction = 82; f.state.comfort = 85; f.state.closeness = 80; f.state.tension = 6;
  return f;
}
const ASK = [
  { role: 'assistant', text: "ok the wine was a mistake. a good mistake" },
  { role: 'user', text: "what are you wearing rn" },
  { role: 'assistant', text: "why, what do you think im wearing" },
  { role: 'user', text: "send me a pic. right now" }
];

(async () => {
  console.log('=== fix 1+3: direct ask, candour open, heat ' + API._imageHeat(mk()) + ', Settings DEFINED ===');
  let photos = 0, jokes = 0, regens = 0;
  for (let i = 1; i <= 5; i++) {
    try {
      const f = mk();
      const r = await API.chat(f, ASK, settings, Date.now() - 900000);
      if (r.refusal) { console.log(`  try ${i}: PROVIDER REFUSED`); continue; }
      const b = r.bubbles || [];
      const p = b.filter(x => /^\s*\[\s*photo\s*\]/i.test(x));
      if (p.length) photos++;
      if (b.some(x => /practi[cs]e on|booed up/i.test(x))) jokes++;
      if (r.meta && r.meta.strictRegen) regens++;
      console.log(`  try ${i}: ${p.length ? 'PHOTO -> ' + p[0].slice(0, 80) : 'no marker'} | ` + b.map(s => s.slice(0, 52)).join(' / '));
    } catch (e) { console.log(`  try ${i}: ERROR ${String(e && e.message).slice(0, 120)}`); }
  }
  console.log(`  --> ${photos}/5 sent the marker (was 0), ${jokes}/5 replayed the practice joke (was 6/6), ${regens} backstop regens`);

  console.log('\n=== fix 2: heat A/B, same scene + reference ===');
  API._budgetLeft = () => 120000; API._budgetActive = () => false;
  const entry = { imageModel: 'grok-imagine-image', imageKey: KEY, baseUrl: 'https://api.x.ai/v1' };
  const ref = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, 'B-candidate-shown.jpg')).toString('base64');
  for (const h of [0, 2]) {
    try {
      const url = await API._generateImage(entry, 'curled up on the couch with the tv on, my legs tucked under me',
        { appearance: Personas.byId('bre').appearance, reference: ref, faceShown: true, heat: h });
      const m = /^data:([^;]+);base64,(.*)$/.exec(url);
      fs.writeFileSync(path.join(OUT, `HEAT48-${h}.jpg`), Buffer.from(m[2], 'base64'));
      console.log(`  heat ${h}: ok -> HEAT48-${h}.jpg`);
    } catch (e) { console.log(`  heat ${h}: ${e.declined ? 'DECLINED' : 'ERROR'} ${String(e.providerMessage || e.message).slice(0, 120)}`); }
  }
})();
