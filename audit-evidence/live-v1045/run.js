/* run.js — live verification for v10.43/44/45, against api.x.ai.

   Everything here is FULLY SYNTHETIC. Step A/B generate a reference from
   text alone (the v10.44 dial path), and every later step uses THAT
   generated picture as its reference. No real person's photograph goes
   through this pipeline.

   What is being answered, in order of how much it matters:
     1. Does the real chat photo path still DECLINE at heat 2 with a face?
        (the owner's report: "the blocker is hitting every single time")
     2. Does the v10.44 candidate render work at all? It has never run.
     3. Do the v10.43 changes hold live — povFace + the camera-aware
        register, and a scene photo leaving the reference behind?
     4. Does the reworded spicy garnish still decline? (outstanding since
        credits ran out mid-test at v10.42)

   Key comes from the environment. It is never written to disk. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = '/home/user/frenz';
const OUT = __dirname;
const KEY = (process.env.XAI_API_KEY || '').trim();
if (!KEY) throw new Error('set XAI_API_KEY');

const ctx = {
  console, Date, Math, JSON, fetch, AbortController, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} }, navigator: {}, window: {}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/personas.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), ctx);
const API = vm.runInContext('ClaudeAPI', ctx);
const Personas = vm.runInContext('Personas', ctx);

// The service worker never speaks here, and the budget must be open or the
// ladder's 8s floor breaks every rung after the first.
API._swSpeaks = async () => false;
API._budgetLeft = () => 120000;
API._budgetActive = () => false;

const entry = { imageModel: 'grok-imagine-image', imageKey: KEY, baseUrl: 'https://api.x.ai/v1' };
const SHEET = Personas.byId('bre').appearance;
const log = [];

// Every rung the ladder tries gets recorded, so a photo that only arrived
// after re-framing is not mistaken for one that worked first time.
const rungs = [];
API._onImageDecline = (e, i, total, route) =>
  rungs.push({ i, total, route, status: e.status, msg: String(e.providerMessage || e.message || '').slice(0, 200) });

function save(name, dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  const ext = /jpeg/.test(m[1]) ? 'jpg' : 'png';
  const file = name + '.' + ext;
  fs.writeFileSync(path.join(OUT, file), Buffer.from(m[2], 'base64'));
  return file;
}

async function step(name, note, fn) {
  rungs.length = 0;
  const t0 = Date.now();
  let row = { name, note, ms: 0, ok: false };
  try {
    const url = await fn();
    row.ok = true;
    row.file = save(name, url);
    row.bytes = url.length;
  } catch (e) {
    row.error = String(e && e.message || e).slice(0, 300);
    row.declined = !!(e && e.declined);
    row.exhausted = !!(e && e.exhausted);
    row.status = e && e.status;
    row.providerMessage = e && e.providerMessage;
  }
  row.ms = Date.now() - t0;
  row.rungs = rungs.slice();
  log.push(row);
  const verdict = row.ok
    ? (row.rungs.length ? `OK after ${row.rungs.length} decline(s)` : 'OK first try')
    : (row.declined ? 'DECLINED' : 'ERROR');
  console.log(`\n[${name}] ${verdict}  ${row.ms}ms  ${row.file || ''}`);
  console.log(`   ${note}`);
  if (row.error) console.log('   ! ' + row.error);
  for (const r of row.rungs) console.log(`   rung ${r.i + 1}/${r.total} via ${r.route} -> ${r.status} ${r.msg}`);
  return row;
}

const DIALS = { height: 15, build: 80, chest: 92, hips: 85 };
const COLOURING = 'long dark brown hair worn down, fair skin';

(async () => {
  // ---- A/B: the v10.44 candidate render. Text is the only authority here.
  const hidden = { profile: { name: 'Test', photoFace: 'hidden', appearance: SHEET } };
  const shown = { profile: { name: 'Test', photoFace: 'shown', appearance: SHEET } };

  const a = await step('A-candidate-hidden', 'v10.44 dials -> reference, face out of frame', () =>
    API._generateImage(entry, API.referenceCandidatePrompt(hidden, { dials: DIALS, colouring: COLOURING }),
      { raw: true, width: 768, height: 1024, faceShown: false }));

  const b = await step('B-candidate-shown', 'v10.44 dials -> reference, face in frame (the invented-face path)', () =>
    API._generateImage(entry, API.referenceCandidatePrompt(shown, { dials: DIALS, colouring: COLOURING }),
      { raw: true, width: 768, height: 1024, faceShown: true }));

  // The generated candidate becomes the reference for everything below.
  const REF = b.ok ? fs.readFileSync(path.join(OUT, b.file)) : null;
  const refUrl = REF ? 'data:image/png;base64,' + REF.toString('base64') : null;
  if (!refUrl) { console.log('\n!! no candidate to use as a reference — stopping'); fs.writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log, null, 2)); return; }

  const chatOpts = (heat) => ({ appearance: SHEET, reference: refUrl, faceShown: true, heat });

  // ---- C/D/E: the REAL chat photo path. E is the owner's reported blocker.
  await step('C-chat-heat0', 'chat photo, body words, face live, heat 0', () =>
    API._generateImage(entry, 'curled up on the couch with the tv on, my legs tucked under me', chatOpts(0)));
  await step('D-chat-heat1', 'chat photo, same scene, heat 1 (middle register)', () =>
    API._generateImage(entry, 'curled up on the couch with the tv on, my legs tucked under me', chatOpts(1)));
  await step('E-chat-heat2', 'chat photo, same scene, heat 2 — THE REPORTED BLOCKER', () =>
    API._generateImage(entry, 'curled up on the couch with the tv on, my legs tucked under me', chatOpts(2)));

  // ---- F: the spicy garnish reworded at v10.42 and never verified.
  await step('F-garnish-spicy', 'the reworded heat-2 garnish, face live (declined before the rewrite)', () =>
    API._generateImage(entry, API.testLookScenePrompt(
      { profile: { appearance: SHEET } }, 'the couch', 2, 1, { reference: true, faceShown: true }),
      { raw: true, reference: refUrl, faceShown: true }));

  // ---- G: v10.43 — a scene photo leaves the reference behind.
  await step('G-scene-noref', 'a photo of a THING with a reference locked (must route /generations)', () =>
    API._generateImage(entry, 'the bowl of ramen i just made on the counter', chatOpts(2)));

  fs.writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log, null, 2));
  console.log('\n===== summary =====');
  for (const r of log) {
    console.log(`  ${r.name.padEnd(20)} ${(r.ok ? (r.rungs.length ? 'ok (re-framed)' : 'ok') : (r.declined ? 'DECLINED' : 'ERROR')).padEnd(15)} ${r.providerMessage || r.error || ''}`);
  }
})();
