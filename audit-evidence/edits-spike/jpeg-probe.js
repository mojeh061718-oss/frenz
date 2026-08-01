/* jpeg-probe.js — plan step 1: does /v1/images/edits accept a JPEG data URI,
   and does a downscaled (1024px q85) reference hold identity as well as the
   full-size PNG? Throwaway. Key via XAI_API_KEY only. */
'use strict';
const fs = require('fs');
const path = require('path');
const KEY = (process.env.XAI_API_KEY || '').trim();
if (!KEY) throw new Error('set XAI_API_KEY');
const OUT = path.join(__dirname, 'out');

const asDataUrl = (f, mime) => 'data:' + mime + ';base64,' + fs.readFileSync(path.join(__dirname, f)).toString('base64');
const JPEG = asDataUrl('ref-1024.jpg', 'image/jpeg');
const PNG_FULL = 'data:image/png;base64,' + fs.readFileSync('/home/user/frenz/audit-evidence/edits-spike/00-reference.png').toString('base64');

const SCENE = 'The same woman, now standing at her kitchen counter at night making tea, caught mid-task. A candid amateur phone photo: careless tilted framing, slightly grainy, flat unedited colour, ordinary room light, no filter, no retouching.';

async function edit(ref, tag) {
  const t0 = Date.now();
  const bytes = Math.round(ref.length / 1024);
  let res, raw;
  try {
    res = await fetch('https://api.x.ai/v1/images/edits', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + KEY },
      body: JSON.stringify({
        model: 'grok-imagine-image-quality', prompt: SCENE,
        image: { url: ref, type: 'image_url' },
        n: 1, response_format: 'b64_json', aspect_ratio: '3:4', resolution: '1k', respect_moderation: false
      }),
      signal: AbortSignal.timeout(90000)
    });
    raw = await res.text();
  } catch (e) {
    console.log(`[${tag}] payload ${bytes}KB — TRANSPORT ${Date.now() - t0}ms: ${e.message}`);
    return;
  }
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.log(`[${tag}] payload ${bytes}KB — HTTP ${res.status} ${ms}ms: ${raw.slice(0, 300)}`);
    return;
  }
  const d = JSON.parse(raw);
  const item = d && d.data && d.data[0];
  if (!item || !item.b64_json) { console.log(`[${tag}] payload ${bytes}KB — 200 NO IMAGE ${ms}ms:`, item && item.moderation_reason); return; }
  fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(item.b64_json, 'base64'));
  console.log(`[${tag}] payload ${bytes}KB — OK ${ms}ms -> out/${tag}.png`);
}

(async () => {
  await edit(JPEG, 'jpeg-1024-ref');       // the question
  await edit(PNG_FULL, 'png-full-ref');    // control, same prompt
})();
