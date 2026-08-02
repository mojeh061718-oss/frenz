/* camera.js — the camera register is too degraded. Owner wants a clear,
   detailed, high-fidelity real Snapchat photo that is still plainly amateur.

   History that matters: an earlier register described a NICE phone photo
   (crisp focus, natural depth of field) and renders drifted POLISHED, so it
   was swapped for artlessness — and artlessness got implemented as image
   DEGRADATION (grain, flat colour, blown exposure, off white balance).
   The hypothesis under test: artlessness belongs in the FRAMING and the
   MOMENT, and the camera itself can be good. If that holds we get detail
   back without the staged look returning.

   Same scene, same reference, three registers. */
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
const SHEET = vm.runInContext('Personas', ctx).byId('bre').appearance;
API._swSpeaks = async () => false; API._budgetLeft = () => 120000; API._budgetActive = () => false;

const entry = { imageModel: 'grok-imagine-image', imageKey: KEY, baseUrl: 'https://api.x.ai/v1' };
const refUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, 'B-candidate-shown.jpg')).toString('base64');

const CONTROL = API._CAMERA;

/* V1 — keep every artlessness cue, delete every detail-destroyer, and say
   plainly that the camera is good. */
const V1 = ' Shot like a quick snap to a friend: grabbed one-handed mid-moment, framing careless —' +
  ' tilted, awkwardly cropped, too close or too far, composed by nobody.' +
  ' The camera itself is a good modern phone and the picture is CLEAN AND SHARP: properly exposed,' +
  ' crisp fine detail held in skin, hair and fabric, natural true-to-life colour, the room lit the way it really is.' +
  ' Indoors after dark the phone flash fires — bright and close, the way a real one does.' +
  ' True skin and fabric texture, pores and small unevenness where skin shows. Clutter left where it is.' +
  ' No filter, no retouching, no beauty smoothing, no captions or app overlay.' +
  ' It looks unstaged because nobody arranged it, NOT because the photo is low quality.';

/* V2 — same, but naming the actual thing: a modern phone photo at full
   resolution, and the artlessness carried entirely by the moment. */
const V2 = ' It is a real photo off a modern phone, shared straight to a friend the second it was taken:' +
  ' full sensor detail, sharp focus, clean accurate colour, properly exposed for the room,' +
  ' fine texture in skin, hair and fabric — a genuinely good picture, technically.' +
  ' What makes it unmistakably real is everything AROUND the quality: it was grabbed one-handed mid-moment,' +
  ' the framing is tilted and a little careless, cropped by nobody who was thinking about it, the room is as messy as it is,' +
  ' and after dark the phone flash fires bright and close.' +
  ' Real skin with pores and small unevenness, no filter, no retouching, no beauty smoothing, no captions or app overlay.';

const SCENE = 'curled up on the couch with the tv on, my legs tucked under me';

async function shot(name, camera, heat) {
  const real = API._CAMERA;
  API._CAMERA = camera;
  try {
    const url = await API._generateImage(entry, SCENE,
      { appearance: SHEET, reference: refUrl, faceShown: true, heat });
    const m = /^data:([^;]+);base64,(.*)$/.exec(url);
    const f = name + '.' + (/jpeg/.test(m[1]) ? 'jpg' : 'png');
    fs.writeFileSync(path.join(OUT, f), Buffer.from(m[2], 'base64'));
    console.log(`  ${name}: ok -> ${f}`);
  } catch (e) {
    console.log(`  ${name}: ${e.declined ? 'DECLINED' : 'ERROR'} ${String(e.providerMessage || e.message).slice(0, 140)}`);
  } finally { API._CAMERA = real; }
}

(async () => {
  console.log('same scene, same reference, heat 2:');
  await shot('CAM-0-control', CONTROL, 2);
  await shot('CAM-1-clean', V1, 2);
  await shot('CAM-2-realphone', V2, 2);
})();
