/* camera2.js — v10.46 got the detail back but the owner wants true-to-life
   iPhone 17 Pro Max / Apple ProRAW fidelity, not just "a good modern phone".

   Named devices and capture formats are strong, well-understood tokens; the
   risk is the one the register already tripped once — naming the camera as
   an OBJECT summons a phone into the frame (the v10.46 control did exactly
   that). So every variant names the photo's PROVENANCE, never a thing in
   the room, and every variant keeps the artlessness cues intact, because
   that counter-rule is what stopped the polished drift last time. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = '/home/user/frenz', OUT = __dirname;
const KEY = (process.env.XAI_API_KEY || '').trim();
const ctx = { console, Date, Math, JSON, URL, fetch, AbortController, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} }, navigator: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/personas.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), ctx);
const API = vm.runInContext('ClaudeAPI', ctx);
const SHEET = vm.runInContext('Personas', ctx).byId('bre').appearance;
API._swSpeaks = async () => false; API._budgetLeft = () => 120000; API._budgetActive = () => false;
const entry = { imageModel: 'grok-imagine-image', imageKey: KEY, baseUrl: 'https://api.x.ai/v1' };
const ref = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, 'B-candidate-shown.jpg')).toString('base64');

// The artlessness half is IDENTICAL across all three — only the fidelity
// half varies, so the comparison isolates one thing.
const ARTLESS = ' What makes it unmistakably real is everything AROUND that quality: it was grabbed one-handed mid-moment,' +
  ' the framing tilted and a little careless, cropped by nobody who was thinking about it,' +
  ' the room as messy as it actually is, and indoors after dark the phone flash fires bright and close the way a real one does.' +
  ' Real skin with pores and small unevenness where it shows. Clutter left where it is.' +
  ' No filter, no retouching, no beauty smoothing, no captions or app overlay — a photo meant to be seen once, not kept.';

/* V3 — name the device and the format flatly, as provenance. */
const V3 = ' Shot on an iPhone 17 Pro Max in Apple ProRAW and sent straight to a friend:' +
  ' true-to-life colour, enormous dynamic range holding both the lamp and the shadows,' +
  ' every fine detail resolved — individual hairs, the weave of the fabric, the real texture of skin.' + ARTLESS;

/* V4 — device + format + what that pipeline is actually known for. */
const V4 = ' Shot on an iPhone 17 Pro Max in Apple ProRAW, 48-megapixel, and sent straight to a friend:' +
  ' the unprocessed true-to-life look of a RAW capture — accurate natural colour with no HDR crunch and no oversharpening,' +
  ' deep real shadows, highlights that hold, and enormous resolved detail in skin, individual hairs and fabric weave.' + ARTLESS;

/* V5 — format-forward, leaning on RAW meaning "not yet stylised". */
const V5 = ' A ProRAW capture off an iPhone 17 Pro Max, straight out of the camera and sent to a friend before anything was done to it:' +
  ' photographic, true to life, exactly the colours and light that were actually in the room —' +
  ' full 48-megapixel detail, real skin rendered as skin (pores, fine hairs, texture, the odd blemish), fabric you could name by touch.' + ARTLESS;

const SCENE = 'curled up on the couch with the tv on, my legs tucked under me';
async function shot(name, camera) {
  const real = API._CAMERA; API._CAMERA = camera;
  try {
    const url = await API._generateImage(entry, SCENE, { appearance: SHEET, reference: ref, faceShown: true, heat: 2 });
    const m = /^data:([^;]+);base64,(.*)$/.exec(url);
    fs.writeFileSync(path.join(OUT, name + '.jpg'), Buffer.from(m[2], 'base64'));
    console.log('  ' + name + ': ok');
  } catch (e) { console.log('  ' + name + ': ' + (e.declined ? 'DECLINED ' : 'ERROR ') + String(e.providerMessage || e.message).slice(0, 120)); }
  finally { API._CAMERA = real; }
}
(async () => {
  console.log('same scene / reference / heat 2, only the fidelity clause varies:');
  await shot('CAM-3-proraw', V3);
  await shot('CAM-4-proraw48', V4);
  await shot('CAM-5-straightout', V5);
})();
