/* Variant B: comparatives failed (reference dominated). Image models are
   weak at exclusion and comparison, strong at direct description — the same
   lesson the face rule learned. So instead of "fuller than that", scope the
   reference to IDENTITY (face, hair, colouring) and state the build
   ABSOLUTELY. Same reference, same scene, only the identity clause differs. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = '/home/user/frenz';
const OUT = path.join(__dirname, 'dial-out');
const KEY = (process.env.XAI_API_KEY || '').trim();
if (!KEY) throw new Error('set XAI_API_KEY');

const ctx = { console, Date, Math, JSON, localStorage: { getItem: () => null, setItem: () => {} }, navigator: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/personas.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), ctx);
const API = vm.runInContext('ClaudeAPI', ctx);
const SHEET = vm.runInContext('Personas', ctx).byId('bre').appearance;
const ref = fs.readFileSync(path.join(OUT, '00-ref-slim.png')).toString('base64');
const SCENE = 'standing in her kitchen at night in a fitted grey t-shirt and jeans, caught mid-task';

async function edit(prompt, tag) {
  const t0 = Date.now();
  const res = await fetch('https://api.x.ai/v1/images/edits', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({
      model: 'grok-imagine-image-quality', prompt,
      image: { url: 'data:image/png;base64,' + ref, type: 'image_url' },
      n: 1, response_format: 'b64_json', aspect_ratio: '3:4', resolution: '1k', respect_moderation: false
    }), signal: AbortSignal.timeout(90000)
  });
  const ms = Date.now() - t0;
  if (!res.ok) { console.log(`[${tag}] HTTP ${res.status} ${ms}ms: ${(await res.text()).slice(0, 220)}`); return; }
  const d = await res.json();
  const item = d && d.data && d.data[0];
  if (!item || !item.b64_json) { console.log(`[${tag}] 200 no image ${ms}ms`, item && item.moderation_reason); return; }
  fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(item.b64_json, 'base64'));
  console.log(`[${tag}] OK ${ms}ms`);
}

const base = API._imagePrompt(SCENE, 'pov', SHEET, 0, { reference: true }).slice(0, 2600);
const OLD = 'The woman holding the phone is the same woman as in the reference photo — identical build, hair, skin, and features.';
// Reference keeps identity; build is stated directly, the way the model responds to.
const NEW = 'The woman holding the phone is the same woman as in the reference photo — same face, same hair, same skin and colouring. Her build: short, full and curvy, with a large full chest and wide full hips and thighs.';

(async () => {
  const p = base.replace(OLD, NEW);
  if (p === base) { console.log('!! identity clause not found'); return; }
  fs.writeFileSync(path.join(OUT, 'absolute-prompt.txt'), p);
  await edit(p + API._imageAvoid(true), '03-absolute-build');
  await edit(p + API._imageAvoid(true), '04-absolute-build-b');   // n=2, this decides a feature
})();
