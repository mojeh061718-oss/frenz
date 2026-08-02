/* Can the reference lock IDENTITY while pose, expression and clothing follow
   the scene? Owner reports heat1/heat2 reusing the reference's exact pose and
   clothing.

   Known already: pose varies with scene, and a NAMED outfit overrides the
   reference (first spike, Q2). Untested: expression, and whether an explicit
   identity-only scoping clause frees what a short scene leaves unsaid.

   Reference is deliberately distinctive in all three (arms crossed, red
   plaid shirt, flat stare) so bleed is unmistakable. Synthetic. Throwaway. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = '/home/user/frenz';
const OUT = path.join(__dirname, 'pose-out');
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
  if (!res.ok) { console.log(`[${tag}] HTTP ${res.status} ${ms}ms: ${(await res.text()).slice(0, 200)}`); return null; }
  const d = await res.json();
  const item = d && d.data && d.data[0];
  if (!item || !item.b64_json) { console.log(`[${tag}] 200 no image ${ms}ms`, item && item.moderation_reason); return null; }
  fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(item.b64_json, 'base64'));
  console.log(`[${tag}] OK ${ms}ms`);
  return item.b64_json;
}

// The clause under test: scope the reference to identity and hand pose,
// expression and clothing to the scene. Positive framing throughout —
// "take X from the photo, take Y from the description" — rather than a
// negation, which is the form these models handle badly.
const SCOPE = ' Take only her identity from the reference photo — her face, her hair, her skin and colouring, her build. Everything else in this picture comes from the description above: her pose, what she is doing with her hands and body, the expression on her face, what she is wearing, and the room around her.';

(async () => {
  const ref = await post('/images/generations', {
    model: 'grok-imagine-image-quality', n: 1, response_format: 'b64_json',
    aspect_ratio: '3:4', resolution: '1k', respect_moderation: false,
    prompt: 'A full-length phone photo of a woman standing stiffly square on to the camera with her arms folded tightly across her chest, wearing a bright red plaid flannel shirt buttoned to the neck and dark jeans, flat blank expression, plain white wall behind her. She is: ' +
      SHEET.trim() + ' Slightly grainy, flat unedited colour, ordinary room light, no filter, no retouching, no text or overlay.'
  }, '00-ref-distinctive');
  if (!ref) return;

  const edit = (prompt, tag) => post('/images/edits', {
    model: 'grok-imagine-image-quality', prompt,
    image: { url: 'data:image/png;base64,' + ref, type: 'image_url' },
    n: 1, response_format: 'b64_json', aspect_ratio: '9:16', resolution: '1k', respect_moderation: false
  }, tag);

  // A scene that names outfit, pose AND expression, at heat 2, face live.
  const DESC = 'curled sideways on the couch laughing at something on the tv, one hand over her mouth, wearing an oversized cream knit jumper and grey sleep shorts';
  const base = API._imagePrompt(DESC, 'pov', SHEET, 2, { reference: true, faceShown: true }).slice(0, 2600);

  await edit(base + API._imageAvoid(false), '01-named-no-scope');

  const anchor = 'identical build, hair, skin, and features.';
  const scoped = base.replace(anchor, anchor + SCOPE);
  if (scoped === base) { console.log('!! anchor not found'); return; }
  fs.writeFileSync(path.join(OUT, 'scoped-prompt.txt'), scoped);
  await edit(scoped.slice(0, 2600) + API._imageAvoid(false), '02-named-with-scope');

  // Control: short action, nothing named — what `testlook couch heat2` sends.
  const bare = API._imagePrompt('at home this evening — the scene: on the couch', 'pov', SHEET, 2,
    { reference: true, faceShown: true }).slice(0, 2600);
  await edit(bare + API._imageAvoid(false), '03-bare-action');
})();
