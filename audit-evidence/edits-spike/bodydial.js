/* bodydial.js — the load-bearing unknown for owner-tunable body dials.

   Design: the reference photo stays the identity authority; a moved dial
   appends a COMPARATIVE correction ("fuller through the chest than that"),
   never an absolute description — absolute would contradict the reference,
   comparative modifies it, so one authority survives.

   Question: does the model actually HONOUR a comparative nudge against a
   reference? Reference bleed is strong and measured; if text can't move it,
   the feature is decorative and should not be built.

   Fully synthetic: reference generated from Bre's own sheet. Throwaway. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = '/home/user/frenz';
const OUT = path.join(__dirname, 'dial-out');
fs.mkdirSync(OUT, { recursive: true });
const KEY = (process.env.XAI_API_KEY || '').trim();
if (!KEY) throw new Error('set XAI_API_KEY');

const ctx = { console, Date, Math, JSON, localStorage: { getItem: () => null, setItem: () => {} }, navigator: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/personas.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), ctx);
const API = vm.runInContext('ClaudeAPI', ctx);
const SHEET = vm.runInContext('Personas', ctx).byId('bre').appearance;

async function post(endpoint, body, tag) {
  const t0 = Date.now();
  const res = await fetch('https://api.x.ai/v1' + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90000)
  });
  const ms = Date.now() - t0;
  if (!res.ok) { console.log(`[${tag}] HTTP ${res.status} ${ms}ms: ${(await res.text()).slice(0, 220)}`); return null; }
  const d = await res.json();
  const item = d && d.data && d.data[0];
  if (!item || !item.b64_json) { console.log(`[${tag}] 200 no image ${ms}ms`, item && item.moderation_reason); return null; }
  fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(item.b64_json, 'base64'));
  console.log(`[${tag}] OK ${ms}ms`);
  return item.b64_json;
}

// A deliberately UNDERSTATED reference, so there is room to push in both
// directions and the correction has something to correct.
const REF_PROMPT = 'A full-length casual phone photo of a woman standing relaxed square on to the camera in a plain bedroom, cropped just below the chin. She is: a petite slim brunette in her early thirties, small frame, narrow through the shoulders hips and chest, fair skin, long dark brown hair worn down. Wearing a plain fitted grey t-shirt and jeans. Slightly grainy, flat unedited colour, ordinary room light, no filter, no retouching, no text or overlay.';

const SCENE = 'standing in her kitchen at night in a fitted grey t-shirt and jeans, caught mid-task';

/* The candidate clause shape. Always relative to "that" — the sentence
   immediately before it, which is the reference sentence when one rides and
   the appearance sheet when one does not. */
const ADJUST = ' Compared with that, she is noticeably shorter, and distinctly fuller and curvier all over — a markedly fuller chest and noticeably wider, fuller hips and thighs.';

(async () => {
  const ref = await post('/images/generations', {
    model: 'grok-imagine-image-quality', prompt: REF_PROMPT, n: 1,
    response_format: 'b64_json', aspect_ratio: '3:4', resolution: '1k', respect_moderation: false
  }, '00-ref-slim');
  if (!ref) return;

  const base = API._imagePrompt(SCENE, 'pov', SHEET, 0, { reference: true }).slice(0, 2600);
  // Control: reference only, no adjustment.
  await post('/images/edits', {
    model: 'grok-imagine-image-quality', prompt: base + API._imageAvoid(true),
    image: { url: 'data:image/png;base64,' + ref, type: 'image_url' },
    n: 1, response_format: 'b64_json', aspect_ratio: '3:4', resolution: '1k', respect_moderation: false
  }, '01-no-adjust');

  // Treatment: identical, plus the comparative correction spliced in right
  // after the identity clause (where the real feature would put it).
  const anchor = 'identical build, hair, skin, and features.';
  const adjusted = base.replace(anchor, anchor + ADJUST);
  if (adjusted === base) { console.log('!! anchor not found — check the identity clause'); return; }
  fs.writeFileSync(path.join(OUT, 'adjusted-prompt.txt'), adjusted);
  await post('/images/edits', {
    model: 'grok-imagine-image-quality', prompt: adjusted + API._imageAvoid(true),
    image: { url: 'data:image/png;base64,' + ref, type: 'image_url' },
    n: 1, response_format: 'b64_json', aspect_ratio: '3:4', resolution: '1k', respect_moderation: false
  }, '02-adjusted-fuller');
})();
