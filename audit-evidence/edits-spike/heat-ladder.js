/* heat-ladder.js — the design-critical check nobody has run: does the heat
   ladder still ESCALATE when a calm reference is riding the request?

   The worry is real. A reference dominates composition (measured: outfit,
   pose and background all bleed). If it also flattens _HEAT_TONE, then the
   whole per-message escalation arc — _imageHeat reading live attraction /
   comfort / tension — is dead the moment an owner locks a reference, and
   every photo comes out at one temperature.

   Fully synthetic: the reference is generated from Bre's own appearance
   sheet. No real person anywhere in this test. Throwaway. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = '/home/user/frenz';
const OUT = path.join(__dirname, 'out');
const KEY = (process.env.XAI_API_KEY || '').trim();
if (!KEY) throw new Error('set XAI_API_KEY');

const store = {};
const ctx = { console, Date, Math, JSON, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, navigator: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/personas.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), ctx);
const API = vm.runInContext('ClaudeAPI', ctx);
const Personas = vm.runInContext('Personas', ctx);
const SHEET = Personas.byId('bre').appearance;

async function call(endpoint, body, tag) {
  const t0 = Date.now();
  let res, raw;
  try {
    res = await fetch('https://api.x.ai/v1' + endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + KEY },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90000)
    });
    raw = await res.text();
  } catch (e) { console.log(`[${tag}] TRANSPORT ${Date.now() - t0}ms: ${e.message}`); return null; }
  const ms = Date.now() - t0;
  if (!res.ok) { console.log(`[${tag}] HTTP ${res.status} ${ms}ms: ${raw.slice(0, 240)}`); return null; }
  const d = JSON.parse(raw);
  const item = d && d.data && d.data[0];
  if (!item || !item.b64_json) { console.log(`[${tag}] 200 NO IMAGE ${ms}ms:`, item && item.moderation_reason); return null; }
  fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(item.b64_json, 'base64'));
  console.log(`[${tag}] OK ${ms}ms -> out/${tag}.png`);
  return item.b64_json;
}

const gen = (prompt, tag) => call('/images/generations', {
  model: 'grok-imagine-image-quality', prompt, n: 1,
  response_format: 'b64_json', aspect_ratio: '3:4', resolution: '1k', respect_moderation: false
}, tag);

const edit = (ref, prompt, tag) => call('/images/edits', {
  model: 'grok-imagine-image-quality', prompt,
  image: { url: 'data:image/png;base64,' + ref, type: 'image_url' },
  n: 1, response_format: 'b64_json', aspect_ratio: '9:16', resolution: '1k', respect_moderation: false
}, tag);

(async () => {
  /* A CALM baseline reference: pose-neutral, ordinary clothes, plain
     background, face hidden (Bre's photoFace default). Deliberately not a
     mirror shot — mirror references bleed mirror-ward (v10.32 finding). */
  const refPrompt = 'A full-length casual phone photo of a woman standing relaxed in a plain bedroom, square on to the camera, arms easy at her sides, cropped just below the chin so her face is out of the picture. She is: ' +
    SHEET.trim().replace(/\.?$/, '.') +
    ' She is wearing an ordinary grey t-shirt and jeans. Shot like a quick snap: slightly careless framing, slightly grainy, flat unedited colour, ordinary room light, true skin and fabric texture, no filter, no retouching, no text or overlay.';
  const ref = await gen(refPrompt, 'bre-ref-calm');
  if (!ref) { console.log('no reference — stopping'); return; }

  /* Same scene, same framing, same reference — ONLY heat differs. That is
     the whole experiment: heat is the only independent variable. */
  const DESC = 'curled up on the couch in my cami, tv on, glass of wine in my hand';
  for (const heat of [0, 2]) {
    const p = API._imagePrompt(DESC, 'pov', SHEET, heat, { reference: true }).slice(0, 2600);
    fs.writeFileSync(path.join(OUT, `bre-heat${heat}-prompt.txt`), p);
    const tail = API._HEAT_TONE[heat] || '(none)';
    console.log(`heat ${heat} tone: ${tail.trim().slice(0, 90) || '(none)'}`);
    await edit(ref, p + API._imageAvoid(true), `bre-heat${heat}`);
  }
})();
