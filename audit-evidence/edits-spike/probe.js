/* probe.js — THROWAWAY spike for xAI /v1/images/edits (plan step 1).
   Never ships. Answers, in order:
     Q1  does /images/edits COMPOSE a new scene from a reference, or only
         modify the source image?
     Q2  does identity survive an outfit change?
     Q3  does it survive the full assembled _imagePrompt (our _CAMERA register)?
     Q4  latency + decline rate vs TIMEOUTS.image=45s / PHOTO_BUDGET_MS=110s
     Q5  does a reference change moderation behavior?
   Plus one face-lock micro-test (invented face, no persona) for decision-gate
   outcome (A).

   Key comes from the XAI_API_KEY env var — NEVER from any repo file, and
   nothing here writes the key anywhere. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = '/home/user/frenz';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const KEY = (process.env.XAI_API_KEY || '').trim();
if (!KEY) throw new Error('set XAI_API_KEY');
const BASE = 'https://api.x.ai/v1';
const MODEL = 'grok-imagine-image-quality';   // db.js default, plan §1

/* ---- load the LIVE engine for prompt assembly (verify.js pattern) ---- */
function load() {
  const store = {};
  const ctx = {
    console, Date, Math, JSON,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: {}, window: {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/personas.js'), 'utf8'), ctx, { filename: 'js/personas.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), ctx, { filename: 'js/api.js' });
  return { API: vm.runInContext('ClaudeAPI', ctx), Personas: vm.runInContext('Personas', ctx) };
}
const { API, Personas } = load();
const SHEET = Personas.byId('samantha').appearance;   // redhead / freckles / leg-only tattoos — maximally checkable markers
const friend = { profile: { appearance: SHEET } };

/* ---- raw HTTP, mirroring _xaiImage (api.js:3203-3273) ---- */
const log = [];
async function call(endpoint, body, tag) {
  const t0 = Date.now();
  let res, raw;
  try {
    res = await fetch(BASE + endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000)
    });
    raw = await res.text();
  } catch (e) {
    log.push({ tag, endpoint, ms: Date.now() - t0, error: String(e && e.message || e) });
    console.log(`[${tag}] TRANSPORT ERROR ${Date.now() - t0}ms: ${e.message}`);
    return null;
  }
  const ms = Date.now() - t0;
  let data = null; try { data = JSON.parse(raw); } catch { /* keep raw */ }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || (data && data.message) || raw.slice(0, 300);
    log.push({ tag, endpoint, ms, status: res.status, declined: res.status === 400 || res.status === 422, providerMessage: msg });
    console.log(`[${tag}] HTTP ${res.status} ${ms}ms: ${msg.slice(0, 220)}`);
    return null;
  }
  const item = data && data.data && data.data[0];
  if (item && item.b64_json) {
    const file = path.join(OUT, tag + '.png');
    fs.writeFileSync(file, Buffer.from(item.b64_json, 'base64'));
    log.push({ tag, endpoint, ms, status: 200, bytes: item.b64_json.length, keys: Object.keys(item), file });
    console.log(`[${tag}] OK ${ms}ms -> ${file} (item keys: ${Object.keys(item).join(',')})`);
    return item.b64_json;
  }
  if (item && item.url) {
    // url response — fetch the bytes (log it: b64_json request was not honored)
    const r2 = await fetch(item.url);
    const buf = Buffer.from(await r2.arrayBuffer());
    const file = path.join(OUT, tag + '.png');
    fs.writeFileSync(file, buf);
    log.push({ tag, endpoint, ms, status: 200, viaUrl: true, keys: Object.keys(item), file });
    console.log(`[${tag}] OK-via-url ${ms}ms -> ${file}`);
    return buf.toString('base64');
  }
  log.push({ tag, endpoint, ms, status: 200, noImage: true, itemKeys: item ? Object.keys(item) : null, moderation: item && item.moderation_reason, top: data ? Object.keys(data) : raw.slice(0, 200) });
  console.log(`[${tag}] 200 BUT NO IMAGE ${ms}ms — ${item && item.moderation_reason ? 'moderation: ' + item.moderation_reason : JSON.stringify(data && Object.keys(data))}`);
  return null;
}

const gen = (prompt, tag, aspect) => call('/images/generations', {
  model: MODEL, prompt, n: 1, response_format: 'b64_json',
  aspect_ratio: aspect || '3:4', resolution: '1k', respect_moderation: false
}, tag);

const edit = (b64ref, prompt, tag, aspect) => call('/images/edits', {
  model: MODEL, prompt, n: 1, response_format: 'b64_json',
  aspect_ratio: aspect || '3:4', resolution: '1k', respect_moderation: false,
  image: { url: 'data:image/png;base64,' + b64ref, type: 'image_url' }
}, tag);

(async () => {
  console.log('sheet:', SHEET, '\n');

  /* S0 — reference: the canonical appearance-sheet render (testLookPrompt),
     exactly what the app would store as friend.profile.referenceImage. */
  const refPrompt = API.testLookPrompt(friend);
  const ref = await gen(refPrompt + API._IMAGE_AVOID, '00-reference', '3:4');
  if (!ref) { console.log('\nNO REFERENCE — cannot proceed. See log.'); finish(); return; }

  /* S1/Q1 — three plain scene asks against the reference. Naive natural-
     language edit instructions, per docs ("describe the change"). If these
     come back as the mirror shot with cosmetic changes, the answer is C. */
  await edit(ref, 'The same woman, now curled up on her couch in the evening, TV on in the background, a glass of wine in her hand. A candid amateur phone photo of that moment.', '01-scene-couch');
  await edit(ref, 'The same woman, now standing at her kitchen counter making ramen at night, photographed mid-task. A candid amateur phone photo.', '02-scene-kitchen');
  await edit(ref, 'The same woman, now outdoors on a beach on a bright day, walking near the water. A candid amateur phone photo.', '03-scene-beach');

  /* S2/Q2 — outfit pair: identical ask, only the clothing differs. */
  await edit(ref, 'The same woman standing in her kitchen, wearing a red sundress. A candid amateur phone photo.', '04-outfit-sundress');
  await edit(ref, 'The same woman standing in her kitchen, wearing an oversized grey hoodie and cotton shorts. A candid amateur phone photo.', '05-outfit-hoodie');

  /* S3/Q3 — the FULL assembled pipeline prompt (pov, heat 1) through edits.
     This is what production would actually send. _IMAGE_AVOID appended as the
     live path does. */
  const full = API._imagePrompt('curled up on the couch in my thin cami, tv on, glass of wine in my hand', 'pov', SHEET, 1).slice(0, 2600);
  fs.writeFileSync(path.join(OUT, 'full-pipeline-prompt.txt'), full);
  await edit(ref, full + API._IMAGE_AVOID, '06-full-pipeline', '9:16');
  /* control: same full prompt through plain generations (today's path) */
  await gen(full + API._IMAGE_AVOID, '07-control-generations', '9:16');

  /* S4 — face-lock micro-test for outcome (A). Invented face, no persona. */
  const faceRef = await gen('A candid amateur phone selfie of a woman in her early thirties in her kitchen, shoulder-length dark hair, warm afternoon light, plain and unposed, face clearly visible. Slightly grainy, flat unedited colour, no filter, no retouching.', '08-face-reference', '3:4');
  if (faceRef) {
    await edit(faceRef, 'The same woman, now sitting in a coffee shop by the window with a mug, smiling slightly. A candid amateur phone photo, her face clearly visible.', '09-face-cafe');
    await edit(faceRef, 'The same woman, now outdoors in a park in the evening wearing a denim jacket. A candid amateur phone photo, her face clearly visible.', '10-face-park');
  }

  finish();
})();

function finish() {
  fs.writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log, null, 2));
  const ok = log.filter(l => l.status === 200 && !l.noImage).length;
  const declined = log.filter(l => l.declined || l.moderation).length;
  const times = log.filter(l => l.status === 200).map(l => l.ms);
  console.log(`\n==== ${ok} images, ${declined} declines, latency ms: [${times.join(', ')}]`);
  console.log(`==== vs TIMEOUTS.image=45000, PHOTO_BUDGET_MS=110000`);
}
