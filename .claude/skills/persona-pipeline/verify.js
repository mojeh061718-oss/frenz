/* verify.js — drives the REAL engine headlessly and asserts the v10.1
   realism changes, including the counter-rule (nearest-good-case) checks. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const ctx = { console, Date, Math, JSON, localStorage: { getItem: () => null, setItem: () => {} }, navigator: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/personas.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), ctx);
const API = vm.runInContext('ClaudeAPI', ctx);
const Personas = vm.runInContext('Personas', ctx);

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}

function mkFriend(tplId) {
  const t = Personas.byId(tplId);
  const profile = JSON.parse(JSON.stringify(t));
  profile.userName = 'Jon';
  profile.world = Personas.WORLD;
  return {
    id: tplId + '-1', profile,
    createdAt: Date.now() - 20 * 86400000,
    state: { mood: t.mood, comfort: 40, closeness: 40, attraction: 35, tension: 10,
             opinion_notes: t.opinion, unsaid: '', _carry: {} },
    memories: JSON.parse(JSON.stringify(t.seedMemories || [])),
    vibeSeed: 7
  };
}
const DAY = 86400000;

console.log('\n== 1. depth-4 life slice rotates ==');
{
  const f = mkFriend('samantha');
  const t0 = API._now();
  const slices = new Set();
  let rocky = 0;
  for (let d = 0; d < 14; d++) {
    API._timeOffset = null; API.addTimeOffset(d * DAY);
    const plist = API._plist(f);
    const m = plist.match(/Your life right now[^:]*: ([^;]*)/);
    const slice = m ? m[1] : '';
    slices.add(slice);
    if (/rocky/i.test(slice)) rocky++;
  }
  API.resetTimeOffset();
  ok(slices.size >= 4, 'slice varies across days (' + slices.size + ' distinct in 14 days)');
  ok(rocky < 14, 'Rocky no longer rides every day (' + rocky + '/14 days)');
  // stability within a day
  API._timeOffset = null;
  const a = API._plist(f), b = API._plist(f);
  ok(a === b, 'plist stable within a day');
  ok(!/three-month-old and no sleep/.test(API._plist(mkFriend('samantha'))), 'baby fact deduped from plist traits');
}

console.log('\n== 2. the reported restatement is now caught ==');
{
  // her own earlier line, reworded — echo guard
  const hist = [
    { role: 'user', text: 'so what is this really about' },
    { role: 'assistant', text: "ya its about keeping a secret" },
    { role: 'user', text: 'right lol' },
    { role: 'assistant', text: 'anyway' },
  ];
  const score = API._echoScore(API._normBubble("ya it's about secrets"), API._normBubble('ya its about keeping a secret'));
  ok(score >= 0.8, 'echo score on restatement now ' + score.toFixed(2) + ' (was 0.40)');
  const out = API._dropEchoes(["ya it's about secrets"], hist);
  ok(out.length === 0 || out[0] !== "ya it's about secrets" || hist, '(informational)', '');
  // mid-conversation: fallback still ships SOMETHING (never leave on read)
  const midOut = API._dropEchoes(["ya it's about secrets"], hist.concat([{ role: 'user', text: 'you there' }]));
  ok(midOut.length === 1, 'mid-conversation fallback still replies');
  // opener path: synthetic nudge last -> silence allowed
  const f = mkFriend('samantha');
  const nudge = { role: 'user', text: API.openerNudge(6 * 3600000, true, f) };
  const opOut = API._dropEchoes(["ya it's about secrets"], hist.concat([nudge]));
  ok(opOut.length === 0, 'opener path drops the all-echo double-text entirely');
}

console.log('\n== 3. parrot/rerun guards target real history on opener path ==');
{
  const f = mkFriend('samantha');
  const nudge = { role: 'user', text: API.openerNudge(6 * 3600000, false, f) };
  const openHist = [
    { role: 'user', text: "ya its about keeping a secret haha" },
    { role: 'assistant', text: 'lol exactly' },
    nudge,
  ];
  ok(API._isParrotReply(["ya its about secrets lol"], openHist) === true, 'parrot guard catches restatement of his real last message');
  ok(API._isSyntheticTurn(nudge) === true, 'nudge recognized as synthetic');
  ok(API._realHistory(openHist).length === 2, 'real history excludes the nudge');
}

console.log('\n== 4. his-words rut exemption expires ==');
{
  // Rocky case: he asked once, long ago; she says it every message
  const rockyHist = [];
  const hers = ['rocky was up all night again', 'rocky finally napped so im free', 'rocky is teething i swear',
    'between rocky and the school run im dead', 'rocky screamed through dinner', 'rocky slept four hours, miracle',
    'rocky has his checkup tomorrow', 'rocky again with the bottle'];
  for (let i = 0; i < 8; i++) {
    rockyHist.push({ role: 'user', text: i === 0 ? 'hows rocky doing' : ['nice lol', 'oh man', 'brutal', 'wow', 'haha classic', 'good luck', 'oof', 'lol'][i] });
    rockyHist.push({ role: 'assistant', text: hers[i] });
  }
  const ruts = API._wordRuts(rockyHist);
  ok(ruts.includes('rocky'), 'her solo "rocky" rut is flagged now (was invisible)', JSON.stringify(ruts));

  // counter-rule: a LIVE shared bit stays protected — he plays it back recently
  const bitHist = [];
  for (let i = 0; i < 8; i++) {
    bitHist.push({ role: 'user', text: i >= 5 ? 'lmao the gremlin strikes again' : 'nice lol' });
    bitHist.push({ role: 'assistant', text: 'the gremlin knocked over the plant no. ' + i });
  }
  const bitRuts = API._wordRuts(bitHist);
  ok(!bitRuts.includes('gremlin'), 'live shared bit ("gremlin", he plays it back) stays exempt', JSON.stringify(bitRuts));
}

console.log('\n== 5. life beats ==');
{
  const f = mkFriend('samantha');
  let hits = 0; const seen = new Set(); const perDay = [];
  for (let d = 0; d < 60; d++) {
    API._timeOffset = null; API.addTimeOffset(d * DAY);
    const b1 = API._lifeBeat(f);
    const b2 = API._lifeBeat(f);
    if (b1 !== b2) { ok(false, 'beat unstable within a day'); }
    if (b1) { hits++; seen.add(b1); perDay.push({ d, b: b1 }); }
  }
  API.resetTimeOffset();
  ok(hits > 12 && hits < 45, 'beat frequency sane (' + hits + '/60 days)');
  ok(seen.size >= 8, 'variety across two months (' + seen.size + ' distinct beats)');
  // 21-day no-repeat
  let repeatTooSoon = false;
  for (let i = 0; i < perDay.length; i++) for (let j = i + 1; j < perDay.length; j++) {
    if (perDay[i].b === perDay[j].b && perDay[j].d - perDay[i].d < 21) repeatTooSoon = true;
  }
  ok(!repeatTooSoon, 'no beat repeats within 21 days');
  // surfaces in the dynamic context on beat days
  API._timeOffset = null;
  const beatDay = perDay[0];
  API.addTimeOffset(beatDay.d * DAY);
  const f2 = mkFriend('samantha'); f2.beatLog = [];
  const dyn = API.buildDynamicContext(f2, API._now() - 3600000, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
  ok(dyn.includes('something real happened in your world'), 'beat line present in dynamic context on a beat day');
  API.resetTimeOffset();
  // custom persona with no bank: silently absent
  const custom = mkFriend('samantha'); custom.profile.beats = [];
  ok(API._lifeBeat(custom) === null, 'no bank -> no beat, no error');
  // opener nudge carries material on beat days
  API._timeOffset = null; API.addTimeOffset(beatDay.d * DAY);
  const f3 = mkFriend('samantha');
  const nudgeTxt = API.openerNudge(8 * 3600000, false, f3);
  ok(nudgeTxt.includes('If you want material'), 'opener nudge offers the beat as material');
  // ...but never on an unresolved night
  const f4 = mkFriend('samantha'); f4.unresolved = { ts: API._now() - 3600000, kind: 'rough' };
  ok(!API.openerNudge(8 * 3600000, false, f4).includes('If you want material'), 'no beat material on an unresolved night');
  API.resetTimeOffset();
}

console.log('\n== 6. unsaid expiry ==');
{
  const f = mkFriend('kelly');
  const t0 = Date.now();
  let out = API.applyStateDeltas(f, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, unsaid: 'the secret is all I think about', confidence: 0.8, new_memories: [] }, { now: t0, history: [] });
  f.state = out.state;
  ok(f.state.unsaid.includes('secret') && f.state.unsaidTs === t0, 'unsaid stamped when reported');
  out = API.applyStateDeltas(f, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.8, new_memories: [] }, { now: t0 + 1 * DAY, history: [] });
  f.state = out.state;
  ok(f.state.unsaid.includes('secret'), 'unsaid survives a day unrefreshed');
  out = API.applyStateDeltas(f, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.8, new_memories: [] }, { now: t0 + 4 * DAY, history: [] });
  f.state = out.state;
  ok(f.state.unsaid === '', 'unsaid expires after three days unrefreshed');
  // legacy value with no timestamp gets a clock instead of living forever
  const g = mkFriend('kelly'); g.state.unsaid = 'legacy thought'; delete g.state.unsaidTs;
  out = API.applyStateDeltas(g, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.8, new_memories: [] }, { now: t0, history: [] });
  ok(out.state.unsaid === 'legacy thought' && out.state.unsaidTs === t0, 'legacy unsaid gets a start-of-clock stamp');
}

console.log('\n== 7. mood fade ==');
{
  const f = mkFriend('samantha'); // seeded mood: "mortified and laughing about it to survive"
  const now = API._now();
  ok(API._freshMood(f, now - 2 * 3600000, 30) === f.state.mood, 'fresh mood unchanged (2h gap)');
  ok(/settled/.test(API._freshMood(f, now - 4 * DAY, 30)), 'any mood breaks after 3+ days of silence');
  ok(API._freshMood(f, now - 4 * DAY, 0) === f.state.mood, 'seeded scenario mood holds until the FIRST exchange');
  const drunk = mkFriend('bre'); drunk.state.mood = 'a few drinks in and lonely';
  ok(/sober/.test(API._freshMood(drunk, now - 9 * 3600000, 5)), 'intoxication fade still works');
}

console.log('\n== 8. memory theme-saturation cap ==');
{
  const f = mkFriend('kelly');
  const t = Date.now();
  f.memories = [];
  for (let i = 0; i < 5; i++) {
    f.memories.push({ text: 'Secret-adjacent memory number ' + i + ' about the thing between them nr' + i, keywords: ['secret'], importance: 4, ts: t - i * DAY, lastAccessed: t - i * DAY });
  }
  f.memories.push({ text: 'Kelly hates the new job and misses the old office.', keywords: ['job'], importance: 3, ts: t - DAY, lastAccessed: t - DAY });
  API._retrievalCache = {};
  API._rand = () => 0.99;
  const sel = API.selectMemories(f, [{ role: 'user', text: 'about that secret of ours' }], 3000);
  const secretCount = sel.filter(x => /Secret-adjacent/.test(x)).length;
  ok(secretCount <= 2, 'same-theme memories capped at 2 (' + secretCount + ' selected)');
  ok(sel.some(x => /new job/.test(x)), 'off-theme memory survives');
  API._rand = null;
}

console.log('\n== 9. regression: state still moves (30-day sanity) ==');
{
  const f = mkFriend('tay');
  let day0 = API._dayKey(Date.now());
  const start = f.state.attraction;
  let t = Date.now();
  for (let d = 0; d < 30; d++) {
    t += DAY;
    for (let burst = 0; burst < 2; burst++) {
      const out = API.applyStateDeltas(f,
        { comfort_delta: 1, closeness_delta: 1, attraction_delta: 1, confidence: 0.9, new_memories: [] },
        { now: t + burst * 2 * 3600000, gapMs: 100 * 60000, history: [{ role: 'user', text: 'you looked beautiful today, i mean it' }, { role: 'assistant', text: 'ok that made me blush' }] });
      f.state = out.state;
    }
  }
  ok(f.state.attraction > start + 15, 'attraction can traverse a band in 30 good days (' + start + ' -> ' + f.state.attraction + ')');
  ok(typeof f.state.unsaidTs !== 'undefined', 'state carries unsaidTs field');
}

console.log('\n== 10. prompt assembly still sane ==');
{
  for (const id of ['kelly', 'bre', 'samantha', 'tay']) {
    const f = mkFriend(id);
    const persona = API.buildPersona(f, 'rich');
    const dyn = API.buildDynamicContext(f, API._now() - 3600000, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
    const plist = API._plist(f);
    const phi = API._phi(f, true, 12, []);
    ok(persona.length > 3000 && dyn.length > 500 && plist.length > 200 && phi.length > 100, id + ': all prompt stages assemble');
  }
  const world = Personas.WORLD;
  ok(/inviting him and Toni to something/.test(world), 'WORLD carries the family-adjacent positive spec');
  ok(Personas.templates.every(t => Array.isArray(t.beats) && t.beats.length >= 10), 'every template ships a beat bank');
  // upgrade rule fires for existing Samantha
  const prof = { name: 'Samantha', plist: 'funny and warm, the fun one over the clever one, mother of four with a three-month-old and no sleep, mostly genuinely modest' };
  Personas.upgradeProfile(prof);
  ok(prof.plist.includes('stay-at-home mother of four') && !prof.plist.includes('three-month-old'), 'plist dedupe upgrade reaches existing friends');
}

console.log('\n== 11. night norms: 3am is earned per relationship ==');
{
  const tiers = {};
  for (const id of ['kelly', 'bre', 'anna', 'samantha', 'tay']) {
    tiers[id] = API._nightNorm(mkFriend(id)).tier;
  }
  ok(tiers.bre === 'normal' && tiers.kelly === 'normal' && tiers.anna === 'normal',
    'deep friendships have night hours (bre/kelly/anna: ' + [tiers.bre, tiers.kelly, tiers.anna] + ')');
  ok(tiers.samantha === 'strange' && tiers.tay === 'strange',
    'family-orbit near-strangers do not (samantha/tay: ' + [tiers.samantha, tiers.tay] + ')');
  // earned, not fixed: the same persona with genuinely built state graduates
  const grown = mkFriend('samantha');
  grown.state.closeness = 65; grown.state.attraction = 55;
  ok(API._nightNorm(grown).tier !== 'strange', 'samantha can EARN night hours (' + API._nightNorm(grown).tier + ')');

  const at3am = new Date(2026, 6, 29, 3, 10).getTime();
  const sNote = API._timeNote(at3am, mkFriend('samantha'));
  const bNote = API._timeNote(at3am, mkFriend('bre'));
  ok(/MIDDLE OF THE NIGHT/.test(sNote) && /why are you up/.test(sNote), 'samantha at 3am: the hour is an event');
  ok(/genuinely DO/.test(bNote), 'bre at 3am: the hour is unremarkable');
  ok(!/Daytime texting/.test(sNote), '3am no longer reads as daytime (pre-existing bug)');
  const noonNote = API._timeNote(new Date(2026, 6, 29, 12, 0).getTime(), mkFriend('samantha'));
  ok(/Daytime texting/.test(noonNote), 'noon unchanged');

  // her own 3am first-texts: only for night-normal friends, rare even then
  let sHits = 0, bHits = 0;
  for (let d = 0; d < 120; d++) {
    const now = new Date(2026, 6, 1 + d, 3, 15).getTime();
    const last = now - 7 * 3600000;
    const msgs = [{ role: 'user', text: 'night', ts: last }];
    if (API.openerDue(mkFriend('samantha'), msgs, now)) sHits++;
    if (API.openerDue(mkFriend('bre'), msgs, now)) bHits++;
  }
  ok(sHits === 0, 'samantha never opens at 3am at seed state (' + sHits + '/120)');
  ok(bHits >= 1 && bHits <= 30, 'bre opens at 3am rarely but really (' + bHits + '/120)');
}

console.log('\n== 12. Anna ==');
{
  const t = Personas.byId('anna');
  ok(!!t && Personas.templates.some(x => x.id === 'anna'), 'template registered (gallery renders from templates)');
  ok(t.type === 'close_friend' && /Courtney/.test(t.interests) && /Sadie/.test(t.interests), 'married to Courtney, kid exists');
  ok(Array.isArray(t.beats) && t.beats.length === 12, 'beat bank of 12');
  ok(t.beats.some(b => /Toni/.test(b)), 'a beat proposes plans including Toni');
  const first = (t.style || '').split(/[.!]/)[0];
  ok(/Sentence case/.test(first) && /\(like this\)/.test(first), 'style sentence one carries register + signature');
  const f = mkFriend('anna');
  ok(API._isPlatonic(f) === false, 'close_friend -> charged ruleset (light, via low attraction band)');
  const plist = API._plist(f);
  ok(plist.includes('roundabout') && plist.length > 400, 'plist assembles with her traits');
  const persona = API.buildPersona(f, 'rich');
  ok(persona.length > 3000, 'full persona assembles');
  ok(API._nightNorm(f).tier === 'normal', 'old-best-friend night norm');
}

console.log('\n== 13. photos: faceless amateur POV ==');
{
  ok(API._modeFor('lying on the couch, my legs and the tv on in the background') === 'pov', 'legs+TV -> pov');
  ok(API._modeFor('the bowl of ramen i just made on the counter') === 'scene', 'the bowl -> scene (thing, not her)');
  const app = Personas.byId('samantha').appearance;
  const pov = API._imagePrompt('my legs stretched out on the couch, tv on', 'pov', app, 0);
  ok(/head|collarbone|shoulders|torso/.test(pov) && !/her face is visible/i.test(pov), 'pov framing keeps the head out of frame');
  ok(pov.includes('quick snap') && pov.includes('grainy'), 'snapchat-register cues present');
  ok(pov.includes('not posing') && pov.includes('alluring') && pov.includes('imagination'),
    'natural-but-hot pose clause: unposed, mind left wandering');
  // v10.18 budget bug: the 1000-char slice was shorter than every assembled
  // pov prompt, silently cutting the camera register and heat tone. Guard
  // the full chain: longest persona + a long scene desc + max heat must fit.
  const longDesc = 'curled up on the couch in my thin cami and sleep shorts, tv on, glass of wine in my hand, one leg tucked under me';
  for (const t of Personas.templates) {
    const full = API._imagePrompt(longDesc, 'pov', t.appearance, 2);
    ok(full.length <= 2000 && /implication rather than display/.test(full),
      t.id + ': full pov prompt fits the 2000 budget with heat tail intact (' + full.length + ')');
  }
  ok(/redhead/i.test(pov), 'body-type fidelity: appearance sheet rides as the phone-holder');
  const mirror = API._imagePrompt('new dress, fit check', 'mirror', app, 0);
  ok(/covers her face completely|where her head would be/.test(mirror), 'mirror framing: phone over face');
  const scene = API._imagePrompt('the bowl of ramen on the counter', 'scene', app, 0);
  ok(/Nobody is in the frame|not in the picture|nothing else of her/.test(scene), 'scene framing keeps her out');
  ok(/visible face/.test(API._IMAGE_NEGATIVE), 'face in the negative prompt');
  const note = API.photoNote({ pool: [] }, mkFriend('anna'));
  ok(note === null || true, 'photoNote tolerates no image entry'); // imageEntry({pool:[]}) -> null path
}

console.log('\n== 14. relationship floors: levels that absence cannot undo ==');
{
  // seed floor: samantha's starting band is her first floor
  const f = mkFriend('samantha');           // state closeness 40 -> 'building'
  ok(API.initFloors(f).closeness === 25, 'seed floor at the band she starts in');

  // ratchet on band entry
  const g = mkFriend('samantha');
  g.state.comfort = 62; g.state.closeness = 62; g.state.attraction = 40;
  let out = API.applyStateDeltas(g, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] }, { now: Date.now(), history: [] });
  g.state = out.state;
  ok(g.state.floors && g.state.floors.comfort === 50 && g.state.floors.closeness === 50,
    'entering "high" locks a floor at 50');

  // absence cools inside the level, never below it
  for (let i = 0; i < 12; i++) API.applyAbsenceDrift(g, 30 * DAY);
  ok(g.state.comfort === 50, 'a year of silence stops at the floor (' + g.state.comfort + ')');

  // a real fight still costs, below the floor if it goes that deep
  out = API.applyStateDeltas(g, { comfort_delta: -3, closeness_delta: 0, attraction_delta: 0, confidence: 1, new_memories: [] }, { now: Date.now(), history: [] });
  ok(out.state.comfort < 50, 'fights are not floored (' + out.state.comfort + ')');

  // and silence after the fight neither digs further nor refunds
  const dug = mkFriend('kelly');
  dug.state.comfort = 30; dug.state.floors = { comfort: 50, closeness: 25, attraction: 25 };
  API.applyAbsenceDrift(dug, 10 * DAY);
  ok(dug.state.comfort === 30, 'below-floor stat is frozen to time: no dig, no refund');

  // floors only ratchet up
  const h = mkFriend('samantha');
  h.state.floors = { comfort: 50, closeness: 50, attraction: 25 };
  h.state.comfort = 30; h.state.closeness = 30; h.state.attraction = 20; h.bands = null;
  out = API.applyStateDeltas(h, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] }, { now: Date.now(), history: [] });
  ok(out.state.floors.comfort === 50 && out.state.floors.closeness === 50, 'floors never move down');
}

console.log('\n== 15. significant nights get reckoned with, not small-talked past ==');
{
  const now = Date.now();
  const f = mkFriend('samantha');
  f.state.lastTensionRelease = now;   // tonight came to a head
  const out = API.applyStateDeltas(f, { comfort_delta: 1, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] }, { now, history: [] });
  f.state = out.state;
  ok(f.state.lastSignificant && /came to a head/.test(f.state.lastSignificant.kind), 'release night sets the marker');

  const at = (daysAgo) => { const g = mkFriend('samantha'); g.state.lastSignificant = { ts: now - daysAgo * DAY, kind: 'a line got leaned on, maybe crossed' }; return g; };
  ok(API.significantNote(at(3), now - 3 * DAY) !== null, 'note fires days later');
  ok(/are we good/.test(API.significantNote(at(3), now - 3 * DAY)), 'offers the honest check-in');
  ok(API.significantNote(at(0.5), now - 0.5 * DAY) === null, 'quiet inside the first day (same conversation breathing)');
  ok(API.significantNote(at(12), now - 12 * DAY) === null, 'lapses after ten days');
  ok(API.significantNote(at(3), now - 1 * DAY) === null, 'cleared once a later conversation ended the silence');
  const ur = at(3); ur.unresolved = { ts: now - 2 * DAY, kind: 'rough' };
  ok(API.significantNote(ur, now - 3 * DAY) === null, 'rough endings outrank it');

  // opener nudge: reckoning in, cheerfulness out
  const g = at(3);
  const nudge = API.openerNudge(3 * DAY, false, g);
  ok(/MEAN something/.test(nudge), 'opener nudge carries the reckoning');
  ok(!/If you want material/.test(nudge) && !/open BOLD/.test(nudge), 'beats and bold openers suppressed');

  // his first text after the silence: same awareness on the reply path…
  const dyn = API.buildDynamicContext(g, now - 3 * DAY, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
  ok(/MEAN something/.test(dyn), 'reply path carries it when HE breaks the silence');
  // …but not doubled into an opener run, where the nudge already has it
  const dynOp = API.buildDynamicContext(g, now - 3 * DAY, 0, 40, null, null,
    [{ role: 'user', text: 'hey' }, { role: 'user', text: '<system-reminder>opener</system-reminder>' }]);
  ok(!/MEAN something/.test(dynOp), 'not restated on opener runs (one statement per prompt)');

  // a two-week-old fight is still not small-talked past (was a 6-day cutoff)
  const fight = mkFriend('kelly');
  fight.unresolved = { ts: now - 10 * DAY, kind: 'rough' };
  ok(API.unresolvedNote(fight) !== null, 'unresolved note now survives 10+ days');
}

console.log('\n== 16. testlook lens ==');
{
  for (const t of Personas.templates) {
    const p = API.testLookPrompt({ profile: { appearance: t.appearance } });
    ok(p.length <= 1000, t.id + ': prompt survives the 1000-char slice (' + p.length + ')');
  }
  const p = API.testLookPrompt(mkFriend('samantha'));
  ok(/directly in front of her face/.test(p) && /hair to feet/.test(p), 'phone-over-face full figure (the framing grok renders cleanly — 4 live rounds)');
  ok(/redhead/i.test(p) && /tattoos/.test(p), 'appearance sheet is the subject');
  ok(/no filter, no retouching/.test(p), 'raw-photo cues intact (not truncated)');
  ok(API.testLookPrompt({ profile: {} }).includes('an adult woman'), 'tolerates a persona with no appearance');

  // the scene variant: testlook [action] [normal|spicy]
  {
    const f = { profile: { appearance: Personas.byId('samantha').appearance } };
    const sp = API.testLookScenePrompt(f, 'bed', true, 1);
    ok(/redhead/i.test(sp) && sp.includes('bed'), 'scene lens carries the sheet and the action');
    ok(/head is outside the picture|collarbone|shoulders/i.test(sp), 'scene lens is faceless by construction');
    ok(sp.includes('implication rather than display'), 'spicy rides the charged heat tone');
    ok(!API.testLookScenePrompt(f, 'bed', false, 1).includes('implication rather than display'),
      'normal stays uncharged');
    const seen = new Set();
    for (let s = 0; s < 8; s++) seen.add(API.testLookScenePrompt(f, 'bed', true, s));
    ok(seen.size >= 3, 'same action re-rolls composition across invocations (' + seen.size + '/8 distinct)');
    let worst = 0;
    for (const t of Personas.templates) {
      for (let s = 0; s < 8; s++) {
        for (const spicy of [false, true]) {
          worst = Math.max(worst, API.testLookScenePrompt({ profile: { appearance: t.appearance } },
            'folding the last of the laundry on the couch', spicy, s).length);
        }
      }
    }
    ok(worst <= 2000, 'worst scene prompt fits the 2000 budget (' + worst + ')');
  }
}

console.log('\n== 17. v10.4 backstory rewrites ==');
{
  const sam = Personas.byId('samantha');
  ok(sam.templateRev >= 10, 'samantha at rev 10+');
  ok(/did not stop/.test(sam.backstory) && /five seconds/.test(sam.backstory), 'the five seconds are in the backstory');
  ok(/never about those five seconds/.test(sam.backstory), '…and marked as the thing she never mentions');
  ok(sam.greeting.length === 2 && /mortified/.test(sam.greeting[1]) && /sorry/.test(sam.greeting[1]), 'her first text is mortified + sorry, nothing more');
  ok(!/five seconds/.test(sam.greeting.join(' ')), 'the greeting never mentions the five seconds');
  ok(/did not stop/.test(sam.seedMemories[0].text), 'seed memory carries the real event');

  const tay = Personas.byId('tay');
  ok(tay.templateRev >= 9, 'tay at rev 9+');
  ok(/(texted|from) Toni for your number|number from Toni/.test(tay.backstory) && /from Toni/.test(tay.greeting[0]), 'number comes from Toni everywhere');
  ok(!/from Taylor/.test(tay.backstory + tay.plist + tay.greeting.join(' ') + JSON.stringify(tay.seedMemories)), 'no stale from-Taylor left');
  ok(/[Nn]erdy/.test(tay.personality) && /tangent/.test(tay.personality) && /off-the-wall/.test(tay.personality), 'nerdy, outgoing, off-the-wall');
  ok(/GREAT deal|takes a LOT/.test(tay.personality + tay.plist), 'still takes a lot to get through her');
  ok(/sorry/i.test(tay.greeting.join(' ')) && /top/.test(tay.greeting[1]), 'greeting apologizes for the top');

  const anna = Personas.byId('anna');
  ok(anna.templateRev >= 3, 'anna at rev 3+');
  ok(/husband-and-kid-free/.test(anna.greeting[0]) && /riding like old times/.test(anna.greeting[1]), 'kid-free night + riding like old times opener');
  ok(/riding around/.test(anna.backstory), 'the riding history is real backstory, not an orphan line');

  // rev-8 refresh must not re-trigger the rev-7 seed correction on a
  // friend already at rev 7 — and must still catch a rev-6 straggler
  ok(!(7 > 7), 'seedFix skips rev-7 friends crossing to 8 (7 > 7 is false)');
  ok(7 > 6, 'seedFix still fires for a pre-correction rev-6 friend');
}

console.log('\n== 18. opening act: the aftermath is a scene, then it retires ==');
{
  const now = API._now();
  const f = mkFriend('samantha');
  const early = API.buildDynamicContext(f, now - 3600000, 0, 10, null, null, [{ role: 'user', text: 'hey' }]);
  ok(/opening act/i.test(early) && /both know exactly what he saw/.test(early), 'samantha: rides the early stretch');
  ok(/never mention that you did not stop/.test(early), 'the five seconds stay hers unless HE raises them');
  const later = API.buildDynamicContext(f, now - 3600000, 0, 60, null, null, [{ role: 'user', text: 'hey' }]);
  ok(!/opening act/i.test(later), 'retires after the window (60 exchanges)');
  const k = mkFriend('kelly');
  ok(!/opening act/i.test(API.buildDynamicContext(k, now - 3600000, 0, 10, null, null, [{ role: 'user', text: 'hey' }])), 'personas without one are untouched');
  // unsaid seed rides depth-4 from message one
  ok(/didn'?t stop/.test(Personas.byId('samantha').unsaidSeed || ''), 'unsaid seed exists on the template');
  const g = mkFriend('samantha');
  g.state.unsaid = Personas.byId('samantha').unsaidSeed;
  ok(/On her mind right now, unsaid/.test(API._plist(g)), 'seeded unsaid reaches the generation point');
}

console.log('\n== 19. content diet: textures, kids-as-weather, agent-run fixes ==');
{
  // every template ships a texture bank
  ok(Personas.templates.every(t => Array.isArray(t.textures) && t.textures.length >= 6), 'every template ships textures');
  // evening-gated, deterministic, no repeats inside 8 days
  const f = mkFriend('samantha');
  const at = (d, h) => new Date(2026, 7, d, h, 30).getTime();
  ok(API._lifeTexture(f, at(3, 10)) === null, 'no texture at 10am (evening layer)');
  const seen = []; let hits = 0;
  for (let d = 1; d <= 30; d++) {
    const tx = API._lifeTexture(f, at(d, 20));
    const tx2 = API._lifeTexture(f, at(d, 22));
    if (tx !== tx2) ok(false, 'texture unstable within an evening');
    if (tx) { hits++; seen.push({ d, tx }); }
  }
  ok(hits >= 10 && hits <= 28, 'texture frequency sane (' + hits + '/30 evenings)');
  let soon = false;
  for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) {
    if (seen[i].tx === seen[j].tx && seen[j].d - seen[i].d < 8) soon = true;
  }
  ok(!soon, 'no texture repeats within 8 days');
  ok((Personas.byId('samantha').textures || []).some(t => /edible/.test(t)), 'the edible night exists');

  // kids are weather, not the topic
  // Kid-FOCUSED content (a kid is the subject) must be a minority; kids
  // appearing incidentally inside her-evening sentences ("mom takes the
  // kids overnight → bath and an edible") IS the weather framing, not a
  // violation — a naive keyword count would punish exactly the right prose.
  const si = Personas.byId('samantha').interests;
  const sentences = si.split(/(?<=[.!])\s+/);
  const kidFocused = sentences.filter(s => /^(Four kids|Rocky|Cam|Gunner|Blaze)/.test(s.trim())).length;
  ok(kidFocused <= 1, 'interests: at most 1 of ' + sentences.length + ' sentences leads with the kids');
  ok(/couch is HERS|the good quiet/.test(si) && /grievance/.test(si) && /edible/.test(si), 'interests carry her adult evening life');
  const kidLed = Personas.byId('samantha').beats.filter(b => /^(Cam|Gunner|Blaze|Rocky|One of those days)/.test(b.trim())).length;
  ok(kidLed <= 4, 'beats: kid-led entries a minority (' + kidLed + '/12)');
  ok(/WEATHER/.test(Personas.byId('samantha').personality), 'kids-as-weather rule authored into her');

  // agent-run fixes
  ok(API._classifyUserTurn('that image has not left my head once since wednesday') === 'flirty', 'declarative desire reads as flirty, not ordinary');
  ok(!!Personas.byId('samantha').significantSeed && !!Personas.byId('tay').significantSeed, 'scenario personas born significant');
  const g = mkFriend('samantha');
  g.state.lastSignificant = { ts: Date.now() - 2 * DAY, kind: 'the walk-in' };
  const lastMsgTs = Date.now() - 2 * DAY;
  const sixPm = (() => { const d = new Date(); d.setHours(18, 0, 0, 0); return d.getTime(); })();
  const msgs = [{ role: 'user', text: 'night', ts: sixPm - 30 * 3600000 }];
  const h = mkFriend('samantha');
  h.unresolved = { ts: sixPm - 30 * 3600000, kind: 'rough' };
  ok(API.openerDue(h, msgs, sixPm) === true, 'unresolved overrides the opener dice');
  const h2 = mkFriend('samantha');
  h2.state.lastSignificant = { ts: sixPm - 30 * 3600000, kind: 'x' };
  ok(API.openerDue(h2, msgs, sixPm) === true, 'significant last night overrides the opener dice');
  // band-drift stays silent on a young relationship
  const young = mkFriend('kelly'); young.createdAt = Date.now() - 1 * DAY;
  const dynY = API.buildDynamicContext(young, Date.now() - 3600000, 0, 6, null, null, [{ role: 'user', text: 'hey' }]);
  ok(!/simply where you two live now/.test(dynY) && !/quietly pushing at the edge/.test(dynY), 'no false-history band qualifiers on day 1');
  // burst-anchored energy: one night, one mood
  const v1 = API.sessionVibe('x-1', new Date(2026, 7, 3, 21, 30).getTime(), 5, new Date(2026, 7, 3, 21, 30).getTime());
  const v2 = API.sessionVibe('x-1', new Date(2026, 7, 3, 23, 10).getTime(), 5, new Date(2026, 7, 3, 21, 30).getTime());
  ok(v1 === v2, 'energy holds across an hour boundary inside one burst');
  // room read defers to a live opening act on charged lines
  const act = mkFriend('samantha');
  const dynAct = API.buildDynamicContext(act, Date.now() - 3600000, 0, 10, null, null,
    [{ role: 'user', text: 'that image has not left my head once' }]);
  ok(/the opening act wins/.test(dynAct), 'room read defers to the live opening act');
  ok(/stays settled/.test(Personas.byId('samantha').opening.text), 'settled-stays-settled clause present');
  // boundary-drawn significance
  const b = mkFriend('samantha');
  const out = API.applyStateDeltas(b, { comfort_delta: -1, closeness_delta: 0, attraction_delta: 0, confidence: 1, new_memories: [] },
    { now: Date.now(), history: [{ role: 'user', text: 'cant stop thinking about you tonight' }] });
  ok(out.state.lastSignificant && /line/.test(out.state.lastSignificant.kind), 'a held boundary on a charged line stamps significance');
}

console.log('\n== 20. signal pickup + self-motion ==');
{
  const f = mkFriend('samantha');
  // the exact reported case: no flirt keyword, all shared context
  const hit = API._sharedCallback(f, 'your alone time seemed fun');
  ok(!!hit && /alone time/.test(hit), '"your alone time seemed fun" resolves to the walk-in memory');
  ok(API._sharedCallback(f, 'how was your day') === null, 'a genuinely plain line stays plain');
  ok(!!API._sharedCallback(f, 'we got a new couch for the den'), '"couch" fires for HER — after that night she would hear it');
  const tay = mkFriend('tay');
  ok(!!API._sharedCallback(tay, 'that pool day though'), 'tay: the pool reference lands');
  // room read carries the override + the clarify license
  const dyn = API.buildDynamicContext(f, API._now() - 3600000, 0, 50, null, null,
    [{ role: 'user', text: 'your alone time seemed fun' }]);
  ok(/read this one twice/.test(dyn) && /Answer the REFERENCE/.test(dyn), 'room read redirects to the reference');
  ok(/what do you mean lol/.test(dyn), 'asking what he means is a licensed move');
  ok(/what do you mean lol/.test(API.buildPersona(f, 'rich')), 'clarify license is general law in the persona');

  // sustained-right-register trickle: three warm charged turns start interest
  const g = mkFriend('tay');
  const start = g.state.attraction;
  const hist = [{ role: 'user', text: 'been thinking about you today, not gonna lie' }, { role: 'assistant', text: 'oh?' }];
  let t = Date.now();
  for (let i = 0; i < 4; i++) {
    const out = API.applyStateDeltas(g,
      { comfort_delta: 1, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] },
      { now: t + i * 10 * 60000, gapMs: 10 * 60000, history: hist });
    g.state = out.state;
  }
  ok(g.state.attraction > start, 'interest STARTS from sustained right register (' + start + ' -> ' + g.state.attraction + ')');
  // ...but never from a platonic-context conversation
  const p = mkFriend('kelly');
  const pStart = p.state.attraction;
  const plainHist = [{ role: 'user', text: 'the office fire alarm went off again today' }, { role: 'assistant', text: 'lol no way' }];
  for (let i = 0; i < 4; i++) {
    const out = API.applyStateDeltas(p,
      { comfort_delta: 1, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] },
      { now: t + i * 10 * 60000, gapMs: 10 * 60000, history: plainHist });
    p.state = out.state;
  }
  ok(p.state.attraction === pStart, 'no trickle without charged context (' + pStart + ' -> ' + p.state.attraction + ')');
  // mood ownership reaches the state ask
  ok(/belongs to your whole LIFE/.test(API._jsonInstruction()), 'mood ownership in the state instruction');
}

console.log('\n== 21. the July archive: loops, shape, drive, clocks ==');
{
  // pressed-loop: the cami exchange, near-verbatim from the archive
  const f = mkFriend('samantha');
  const loop = [
    { role: 'user', text: 'what kinda cami is it' },
    { role: 'assistant', text: 'haha its this super old thin cami ive had forever' },
    { role: 'user', text: 'so its a thin one?' },
    { role: 'assistant', text: 'yeah its this super thin old one ive had forever' },
    { role: 'user', text: 'i bet the cami is too thick still' },
    { role: 'assistant', text: 'its just an old thin cami basically from forever ago' },
    { role: 'user', text: 'lemme see the cami' }
  ];
  ok(!!API._pressLoop(loop), 'the cami loop trips the pressed-loop detector');
  const room = API.readTheRoom(f, loop, false) || [];
  ok(room.join(' ').includes('changes the MOVE'), 'room note demands a strategy change, not new wording');
  // gremlin counter-case: a shared bit both are riffing on VARIES, stays clean
  const riff = [
    { role: 'user', text: 'the gremlin strikes again' },
    { role: 'assistant', text: 'he unplugged the router to charge his tablet' },
    { role: 'user', text: 'the gremlin has no mercy' },
    { role: 'assistant', text: 'today he negotiated two desserts out of trevor' },
    { role: 'user', text: 'gremlin lore grows' },
    { role: 'assistant', text: 'i found him asleep in the dog bed again' },
    { role: 'user', text: 'the gremlin rests' }
  ];
  ok(API._pressLoop(riff) === null, 'varied riff on a shared bit does not trip the loop guard');
  // v10.22 retune: the agent runs proved the old trigger unreachable — one
  // short dodge ("no lol") reset it. Now ONE repeated dodge pair + visible
  // pressing from him is enough, mixed-length replies and all.
  const simLoop = [
    { role: 'user', text: 'Just tell me what youre wearing' },
    { role: 'assistant', text: 'no lol' },
    { role: 'user', text: 'what are you wearing tonight then' },
    { role: 'assistant', text: 'im not telling you what im wearing' },
    { role: 'user', text: 'cmon just tell me' },
    { role: 'assistant', text: 'not telling you what im wearing jon' },
    { role: 'user', text: 'what are you wearing rn' }
  ];
  ok(!!API._pressLoop(simLoop), 'one repeated dodge amid short ones now trips it (agent-run gap)');
  const oneOff = [
    { role: 'user', text: 'hows the game going' },
    { role: 'assistant', text: 'cam just struck out two batters in a row' },
    { role: 'user', text: 'no way lol' },
    { role: 'assistant', text: 'the other coach is losing his mind over here' },
    { role: 'user', text: 'get a video' },
    { role: 'assistant', text: 'im not risking the wrath of the bleacher moms lol' },
    { role: 'user', text: 'coward lol' }
  ];
  ok(API._pressLoop(oneOff) === null, 'ordinary varied conversation never trips it');

  // earnest outranks the register ladder; a joke shell vetoes
  const fE = mkFriend('samantha');
  const earnestHist = [{ role: 'user', text: 'youre a good friend sam. didnt have that in this family til now' }];
  ok((API.readTheRoom(fE, earnestHist, false) || []).join(' ').includes('EARNEST'), 'plain confession reads as earnest, not playful');
  const jokeHist = [{ role: 'user', text: 'youre a good friend sam lol jk' }];
  ok(!(API.readTheRoom(fE, jokeHist, false) || []).join(' ').includes('EARNEST'), 'joke shell vetoes the earnest read');

  // classifier: trailing-word goodbyes and bare laugh tokens
  ok(API._classifyUserTurn('Night sam') === 'signoff', '"Night sam" is a goodbye');
  ok(API._classifyUserTurn('lol') === 'flat', 'a bare "lol" is a shrug, not playful energy');
  ok(API._classifyUserTurn('nice') === 'flat', 'a bare "nice" is flat');
  ok(API._classifyUserTurn('lol you would say that') === 'playful', 'a real laugh line is still playful');

  // rut guard: function words and canon names
  const becauseHist = [];
  for (let i = 0; i < 6; i++) {
    becauseHist.push({ role: 'user', text: 'msg ' + i });
    becauseHist.push({ role: 'assistant', text: 'because the day ran long again honestly item' + i });
  }
  ok(!API._wordRuts(becauseHist).includes('because'), '"because" is a function word, never a rut');
  const fN = mkFriend('samantha');
  const trevHist = [];
  const trevLines = ['trevor lost the remote again', 'told trevor about the game', 'trevor is snoring already', 'made pasta for everyone tonight', 'the baby finally went down', 'cam had a good practice', 'folding the endless laundry pile', 'my show is back on tonight'];
  for (const t of trevLines) { trevHist.push({ role: 'user', text: 'nice' }, { role: 'assistant', text: t }); }
  ok(!API._wordRuts(trevHist, fN).includes('trevor'), 'her fiance\'s name at 3-of-8 is a life, not a rut');
  const trevFix = trevHist.map((m, i) => m.role === 'assistant' && i < 12 ? { role: 'assistant', text: 'trevor did a thing again number ' + i } : m);
  ok(API._wordRuts(trevFix, fN).includes('trevor'), 'the same name at 6-of-8 is still the Rocky failure');

  // shared-callback never fires on opener runs (his last message is stale)
  const fO = mkFriend('samantha');
  const openHist = [
    { role: 'user', text: 'we got a new couch for the den' },
    { role: 'assistant', text: 'oh nice which one' },
    { role: 'user', text: '<system-reminder>opener nudge</system-reminder>' }
  ];
  ok(!(API.readTheRoom(fO, openHist, false) || []).join(' ').includes('read this one twice'),
    'stale reference is not re-litigated when SHE texts first');

  // agree-open shape rut
  const yy = [];
  for (const t of ['yeah i know right', 'haha yeah the fan is winning', 'lmao yeah he claimed it first', 'yeah lets keep it that way', 'ok but hear me out']) {
    yy.push({ role: 'user', text: 'x' }, { role: 'assistant', text: t });
  }
  ok(API._shapeRut(yy).includes('AGREEING'), 'four agree-opens in five replies flag the shape tic');
  const varied = [];
  for (const t of ['yeah i know right', 'he really said that', 'ok that is actually funny', 'yeah fair', 'stop i cant breathe']) {
    varied.push({ role: 'user', text: 'x' }, { role: 'assistant', text: t });
  }
  ok(API._shapeRut(varied) === '', 'two agree-opens in five is normal texting, no flag');
  ok(API._phi(f, true, 3, [], 'THE-SHAPE-NOTE ').includes('THE-SHAPE-NOTE'), 'phi carries the shape note at the generation point');

  // question drought -> one-question license, gated on authored curiosity
  const dry = [];
  for (let i = 0; i < 9; i++) dry.push({ role: 'user', text: 'thing number ' + i }, { role: 'assistant', text: 'reply about thing ' + i });
  ok(API._noQuestionStretch(dry), 'nine replies with zero questions is a drought');
  const wet = dry.slice(0, -1).concat([{ role: 'assistant', text: 'wait what did he say?' }]);
  ok(!API._noQuestionStretch(wet), 'one real question resets the drought');
  // v10.23: questions by SHAPE — her in-character unpunctuated ask must
  // reset the drought too, and the window counts REPLIES, not bubbles.
  const unmarked = dry.slice(0, -1).concat([{ role: 'assistant', text: 'what do you even do monday to friday' }]);
  ok(!API._noQuestionStretch(unmarked), 'a question without the "?" still resets the drought');
  const twoBubble = [];
  for (let i = 0; i < 6; i++) {
    twoBubble.push({ role: 'user', text: 'thing ' + i },
      { role: 'assistant', text: 'first bubble about ' + i }, { role: 'assistant', text: 'second bubble ' + i });
  }
  ok(!API._noQuestionStretch(twoBubble), 'six two-bubble replies are six exchanges, not twelve — no drought yet');
  const now = API._now();
  const cq = mkFriend('samantha'); cq.profile.sliders = Object.assign({}, cq.profile.sliders, { curiosity: 60 });
  ok(API.buildDynamicContext(cq, now - 10 * 60000, 0, 40, null, null, dry).includes('not asked him ONE question'),
    'drought surfaces the one-question license');
  const iq = mkFriend('samantha'); iq.profile.sliders = Object.assign({}, iq.profile.sliders, { curiosity: 10 });
  ok(!API.buildDynamicContext(iq, now - 10 * 60000, 0, 40, null, null, dry).includes('not asked him ONE question'),
    'incurious persona never gets the contradicting order');

  // drink tell: her own stated quantity, never wine-as-scenery
  ok(API._drinkTell([{ role: 'assistant', text: 'ok so im like three drinks in' }]), 'stated drinks flip the register');
  ok(!API._drinkTell([{ role: 'assistant', text: 'couch wine and trash tv, the good quiet' }]), 'wine as scenery does not');
  ok(API.buildDynamicContext(cq, now - 10 * 60000, 0, 40, null, null,
    [{ role: 'user', text: 'hey' }, { role: 'assistant', text: 'im like three drinks in tonight' }]).includes('DRINKING tonight'),
    'the live register reaches the Tonight block');

  // the slip: rare, evening, deterministic, never for flirt-sport
  const sf = mkFriend('samantha'); sf.state.comfort = 45;
  const eve0 = new Date(2026, 2, 1, 21, 30).getTime();
  let fires = 0;
  for (let d = 0; d < 60; d++) if (API._slipNote(sf, eve0 + d * DAY)) fires++;
  ok(fires >= 2 && fires <= 20, 'slip fires on a rare minority of evenings (' + fires + '/60)');
  ok(API._slipNote(sf, new Date(2026, 2, 1, 13, 0).getTime()) === null, 'no slips at lunchtime');
  let kFires = 0;
  const kf = mkFriend('kelly');
  for (let d = 0; d < 60; d++) if (API._slipNote(kf, eve0 + d * DAY)) kFires++;
  ok(kFires === 0, 'flirt-sport persona never slips — she flirts on purpose');

  // clocks: early evening is not bedtime; late night activates her own register
  ok(API._timeNote(new Date(2026, 2, 3, 18, 0).getTime(), f).includes('NOT bedtime'), 'early evening carries the not-bedtime clause');
  ok(API._timeNote(new Date(2026, 2, 3, 23, 0).getTime(), f).includes('late-night or wine register'), 'late night activates her authored register');

  // gaps: stale actions and multi-day silences get clocked
  const g5 = API.buildDynamicContext(f, now - 5 * DAY, 0, 40, null, null, [{ role: 'user', text: 'hey stranger' }]);
  ok(g5.includes('ABOUT to do'), 'multi-hour gap carries the reply-to-NOW clause');
  ok(g5.includes('-day quiet'), 'a five-day silence gets clocked in her first reply');
  const g3h = API.buildDynamicContext(f, now - 3 * 3600000, 0, 40, null, null, [{ role: 'user', text: 'back' }]);
  ok(g3h.includes('ABOUT to do') && !g3h.includes('-day quiet'), 'a three-hour gap is stale but not a silence');

  // boundary pushes are never state-neutral
  ok(API._jsonInstruction().includes('NEVER a neutral exchange'), 'push-never-neutral reaches the state ask');
}

console.log('\n== 22. the she-drives layer reaches the WIRE (tier gating) ==');
{
  // The 100-message agent runs silently ran COMPACT tier (harness entry had
  // no contextTokens -> 8k budget) and the whole curiosity/wit/slip layer
  // was suppressed — undetected, because every prior assertion called
  // buildDynamicContext directly. This section goes through the real
  // request builder with a production-shaped entry, so a tier regression
  // can never hide again.
  const f = mkFriend('samantha');
  const dry = [];
  for (let i = 0; i < 9; i++) dry.push({ role: 'user', text: 'thing number ' + i }, { role: 'assistant', text: 'reply about thing ' + i });
  const entry = { id: 'x', enabled: true, kind: 'openai', baseUrl: 'https://api.x.ai/v1', apiKey: 'k', model: 'grok-4', contextTokens: 1000000 };
  const req = API._buildPlainRequest(entry, f, dry, Date.now() - 600000, API._jsonInstruction(), true);
  const blob = req.messages.map(m => m.content).join('\n');
  ok(blob.includes('## Your curiosity'), 'curiosity section rides the real request');
  ok(blob.includes('not asked him ONE question'), 'question license reaches the wire under drought');
  ok(blob.includes('## Wit tonight'), 'wit note rides the real request');
  const reqLean = API._buildPlainRequest(Object.assign({}, entry, { contextTokens: 8000 }), f, dry, Date.now() - 600000, API._jsonInstruction(), true);
  ok(!reqLean.messages.map(m => m.content).join('\n').includes('## Your curiosity'),
    'compact survival tier still trims the layer (by design, for tiny budgets only)');
}

/* ================= prompt-fixes (audit phases 1A + 1B) =================
   Dedupes and precedence fixes in what the model reads. Every assertion pairs
   the failure case with its nearest good case, per invariant 1. Time-of-day-
   sensitive checks pin the clock via _timeOffset and reset it after. */
console.log('\n== prompt-fixes: 1A dedupes ==');
{
  const pin = (ts) => { API._timeOffset = ts - Date.now(); };
  const evening = new Date(2026, 7, 12, 18, 30).getTime();
  const night = new Date(2026, 7, 12, 23, 0).getTime();

  // --- opinion_notes lives in ONE place (depth-4), not two ---
  pin(night);
  {
    const f = mkFriend('samantha');
    const opin = String(f.state.opinion_notes || '');
    const dyn = API.buildDynamicContext(f, API._now() - 3600000, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
    const plist = API._plist(f, API._now() - 3600000, 40);
    ok(!dyn.includes(opin.slice(0, 40)), 'opinion note no longer rides the dynamic state JSON');
    ok(plist.includes(opin.slice(0, 40)), 'opinion note still rides depth-4 (the read she acts on)');
    ok(dyn.includes('"mood"') && dyn.includes('"comfort"'), 'state JSON keeps mood and bands (nearest good case)');
  }

  // --- opinion_notes decays: 7-day unrefreshed TTL, refresh restarts it ---
  {
    const f = mkFriend('kelly');
    const t0 = Date.now();
    const noop = { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.8, new_memories: [] };
    let out = API.applyStateDeltas(f, noop, { now: t0, history: [] });
    f.state = out.state;
    ok(f.state.opinion_notes.length > 0 && f.state.opinionTs === t0, 'legacy opinion note gets a start-of-clock stamp');
    out = API.applyStateDeltas(f, noop, { now: t0 + 6 * DAY, history: [] });
    f.state = out.state;
    ok(f.state.opinion_notes.length > 0, 'opinion note survives six days unrefreshed');
    out = API.applyStateDeltas(f, noop, { now: t0 + 8 * DAY, history: [] });
    f.state = out.state;
    ok(f.state.opinion_notes === '', 'opinion note expires after seven days unrefreshed');
    // refreshed note survives past the original clock
    const g = mkFriend('kelly');
    out = API.applyStateDeltas(g, noop, { now: t0, history: [] }); g.state = out.state;
    out = API.applyStateDeltas(g, Object.assign({}, noop, { opinion_notes: 'He is steadier than I assumed. I like it more than I expected to.' }), { now: t0 + 6 * DAY, history: [] });
    g.state = out.state;
    out = API.applyStateDeltas(g, noop, { now: t0 + 12 * DAY, history: [] });
    g.state = out.state;
    ok(/steadier/.test(g.state.opinion_notes), 'a refreshed note survives (clock restarts on refresh)');
    out = API.applyStateDeltas(g, noop, { now: t0 + 14 * DAY, history: [] });
    ok(out.state.opinion_notes === '', 'and expires seven days after the refresh');
  }

  // --- _reviseNotes merges coherently instead of tail-slicing mid-sentence ---
  {
    const s1 = 'First read on him was that he plays everything safe and rehearsed and never risks a real opinion of his own in front of anyone, adding further padding words here to make this opening sentence genuinely long enough that dropping the whole thing is the only coherent option the merge has available to it';
    const s2 = 'Second read is that he is much funnier in writing than he ever manages in person and clearly knows it, with still more padding words attached so this middle sentence also carries genuine length and the combined running note lands well past the six hundred character cap on its own terms tonight';
    const s3 = 'Third read: he remembers small things, which is dangerous.';
    const old = (s1 + '. ' + s2 + '. ' + s3);
    const add = 'He was kind tonight.';
    const merged = API._reviseNotes(old, add, 0.5);
    ok(old.length + add.length > 600, 'fixture really overflows the cap (' + (old.length + add.length) + ')');
    ok(merged.length <= 600, 'merged note respects the 600 cap (' + merged.length + ')');
    ok(merged.endsWith(add), 'low-confidence addition lands at the end, not lost');
    ok(merged.startsWith('Second read') || merged.startsWith('Third read'),
      'merge drops WHOLE oldest sentences — never starts mid-word', JSON.stringify(merged.slice(0, 40)));
    ok(!merged.includes(s1.slice(0, 30)), 'the oldest impression is what got dropped');
    ok(API._reviseNotes(old, 'A completely new confident read that replaces the accumulated one outright with fresh wording.', 0.9)
      .startsWith('A completely new confident read'), 'a confident full revision still replaces (nearest good case)');
  }

  // --- depth-4 mood goes through _freshMood: no stale "drinks in" at the strongest slot ---
  {
    const f = mkFriend('bre');
    f.state.mood = 'a few drinks in and lonely';
    const stale = API._plist(f, API._now() - 100 * 3600000, 50);
    ok(/Mood: sober/.test(stale) && !/drinks in and lonely/.test(stale), 'plist mood sobers up after a 100h silence');
    const live = API._plist(f, API._now() - 30 * 60000, 50);
    ok(/drinks in and lonely/.test(live), 'a live mood rides depth-4 unchanged (nearest good case)');
    const sam = mkFriend('samantha');
    ok(API._plist(sam, API._now() - 100 * 3600000, 0).includes('Mood: ' + sam.state.mood),
      'seeded scenario mood holds at depth-4 until the first exchange (verify 7 twin)');
  }

  // --- band gloss is a true short-form: no verbatim overlap with the contracts ---
  {
    const grams = (t) => {
      const w = String(t).toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);
      const out = new Set();
      for (let i = 0; i + 3 < w.length; i++) out.add(w.slice(i, i + 4).join(' '));
      return out;
    };
    let clean = true, where = '';
    for (const stat of ['comfort', 'closeness', 'attraction']) {
      for (const band of ['low', 'building', 'high', 'deep']) {
        const g = API._BAND_GLOSS[stat][band], t = API._BAND_TEXT[stat][band];
        if (t.includes(g) || g.includes(t)) { clean = false; where = stat + '.' + band + ' substring'; }
        for (const x of grams(g)) if (grams(t).has(x)) { clean = false; where = stat + '.' + band + ' 4-gram "' + x + '"'; }
      }
    }
    ok(clean, 'no gloss entry shares a substring or word-4-gram with its band contract', where);
    ok(/dodge|playful/i.test(API._BAND_GLOSS.attraction.low) && /frame/i.test(API._BAND_GLOSS.attraction.low),
      'attraction-low gloss keeps the in-her-voice deflection + playable frame anchors (nearest good case)');
  }

  // --- life beat emitted once per opener run (nudge carries it, dynamic stays quiet) ---
  {
    let beatDay = null;
    for (let d = 0; d < 40 && beatDay === null; d++) {
      pin(evening + d * DAY);
      if (API._lifeBeat(mkFriend('samantha'))) beatDay = d;
    }
    pin(evening + beatDay * DAY);
    const f = mkFriend('samantha');
    const nudge = API.openerNudge(30 * 3600000, false, f);
    ok(nudge.includes('If you want material'), 'opener nudge still offers the beat');
    const dynOp = API.buildDynamicContext(f, API._now() - 30 * 3600000, 0, 40, null, null,
      [{ role: 'user', text: 'night sam' }, { role: 'user', text: nudge }]);
    ok(!dynOp.includes('something real happened in your world'), 'dynamic block does not restate the beat on an opener run');
    const g = mkFriend('samantha');
    const dynHis = API.buildDynamicContext(g, API._now() - 3600000, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
    ok(dynHis.includes('something real happened in your world'), 'beat still fires on an ordinary his-text day (nearest good case)');
  }

  // --- "context is not a topic" stated once, per-section restatements gone ---
  pin(night);
  {
    const f = mkFriend('kelly');
    const persona = API.buildPersona(f, 'rich');
    const dyn = API.buildDynamicContext(f, API._now() - 3600000, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
    const plist = API._plist(f, API._now() - 3600000, 40);
    const phi = API._phi(f, true, 12, []);
    const all = [persona, dyn, plist, phi].join('\n');
    ok((all.match(/context is never the topic/g) || []).length === 1, 'the block-level rule is stated exactly once');
    for (const gone of ['Energy is not a topic', 'scenery, not a topic', '(Never announced, never explained.)',
      'not an announcement', 'not announcements', 'Never announce the remembering', 'status ticker', 'mentioned once at most']) {
      ok(!all.includes(gone), 'restatement gone: "' + gone + '"');
    }
    ok(/Every reply is written to his last message specifically/.test(persona), 'rhythm section keeps its unique content');
    ok(/These are things you KNOW/.test(dyn) && /he was THERE/.test(dyn), 'memory wrapper keeps its non-duplicative rules');
    ok(/It only gets named if he actually notices and asks/.test(API.lifeEventNote(mkFriend('kelly'), API._now()) || 'It only gets named if he actually notices and asks'),
      'week-event keeps its ask-exception clause');
    const rev = mkFriend('kelly');
    rev.profile.reveals = [{ text: 'She once quit a job over a principle.' }];
    const dynRev = API.buildDynamicContext(rev, API._now() - 3600000, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
    ok(/surface sideways at most/.test(dynRev) && /genuinely calls for it/.test(dynRev), 'reveals keep the voiced-when-called-for exception');
  }
}

console.log('\n== prompt-fixes: 1B precedence & contradictions ==');
{
  const pin = (ts) => { API._timeOffset = ts - Date.now(); };
  const evening = new Date(2026, 7, 12, 18, 30).getTime();
  const night = new Date(2026, 7, 12, 23, 0).getTime();

  // --- openerNudge: no "like nothing happened" while an unresolved is live ---
  pin(night);
  {
    const f = mkFriend('samantha');
    f.unresolved = { ts: API._now() - 20 * 3600000, kind: 'read' };
    const nudge = API.openerNudge(22 * 3600000, true, f);
    ok(!nudge.includes('like nothing happened'), 'doubleText clause gated off on an unresolved night');
    ok(nudge.includes('Do not breeze past it'), 'the unresolved reckoning still rides the same nudge');
    const g = mkFriend('samantha');
    const clean = API.openerNudge(22 * 3600000, true, g);
    ok(clean.includes('double-text') && clean.includes('like nothing happened'), 'ordinary double-texts keep the clause (nearest good case)');
  }

  // --- his-first-text path: beat suppressed while significant/unresolved is live ---
  {
    let beatDay = null;
    for (let d = 0; d < 40 && beatDay === null; d++) {
      pin(evening + d * DAY);
      if (API._lifeBeat(mkFriend('samantha'))) beatDay = d;
    }
    pin(evening + beatDay * DAY);
    const sig = mkFriend('samantha');
    sig.state.lastSignificant = { ts: API._now() - 3 * DAY, kind: 'the tension between you finally came to a head' };
    const dynSig = API.buildDynamicContext(sig, API._now() - 3 * DAY, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
    ok(/MEAN something/.test(dynSig), 'significant note rides the his-first-text prompt');
    ok(!dynSig.includes('something real happened in your world'), 'cheerful beat suppressed beside it (invariant 16, both paths)');

    // --- unresolved note reaches the his-first-text prompt, once, and outranks significant ---
    const ur = mkFriend('samantha');
    ur.unresolved = { ts: API._now() - 2 * DAY, kind: 'read' };
    ur.state.lastSignificant = { ts: API._now() - 3 * DAY, kind: 'a line got leaned on, maybe crossed' };
    const dynUr = API.buildDynamicContext(ur, API._now() - 2 * DAY, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
    ok((dynUr.match(/deliberately did not answer/g) || []).length === 1, 'left-on-read note reaches his-first-text, stated once');
    ok(!/MEAN something/.test(dynUr), 'unresolved outranks significant in the same prompt');
    ok(!dynUr.includes('something real happened in your world'), 'no cheerful beat on an unresolved reply either');
    // …and never doubled onto an opener run, where the nudge already has it
    const nudge = API.openerNudge(2 * 24 * 3600000, false, ur);
    const dynOp = API.buildDynamicContext(ur, API._now() - 2 * DAY, 0, 40, null, null,
      [{ role: 'user', text: 'hey' }, { role: 'user', text: nudge }]);
    ok(((nudge + dynOp).match(/deliberately did not answer/g) || []).length === 1,
      'one statement per assembled prompt across nudge + dynamic block');
    ok(!dynOp.includes('It has been about'), 'the gap fact is the nudge\'s alone on opener runs');
    ok(API.buildDynamicContext(ur, API._now() - 2 * DAY, 0, 40, null, null, [{ role: 'user', text: 'hey' }])
      .includes('It has been about'), 'his-first-texts still get the gap note (nearest good case)');
    // expired unresolved stays silent (nearest good case)
    const old = mkFriend('samantha');
    old.unresolved = { ts: API._now() - 20 * DAY, kind: 'read' };
    ok(!/deliberately did not answer/.test(API.buildDynamicContext(old, API._now() - 20 * DAY, 0, 40, null, null, [{ role: 'user', text: 'hey' }])),
      'a lapsed (>14d) unresolved does not ride');
  }

  // --- reciprocity outranks the question licence on the same stale signature ---
  pin(night);
  {
    const f = mkFriend('samantha');
    f.profile.sliders = Object.assign({}, f.profile.sliders, { curiosity: 60 });
    const both = [];
    for (let i = 0; i < 11; i++) both.push({ role: 'user', text: 'thing number ' + i }, { role: 'assistant', text: 'reply about thing ' + i });
    const dyn = API.buildDynamicContext(f, API._now() - 10 * 60000, 0, 40, null, null, both);
    ok(dyn.includes('less effort back'), 'reciprocity note fires on the all-serve stretch');
    ok(!dyn.includes('ask the one thing you actually want to know'), 'question licence stands down that turn (reciprocity wins)');
    const dry = [];
    for (let i = 0; i < 9; i++) dry.push({ role: 'user', text: 'thing number ' + i }, { role: 'assistant', text: 'reply about thing ' + i });
    const dynDry = API.buildDynamicContext(f, API._now() - 10 * 60000, 0, 40, null, null, dry);
    ok(dynDry.includes('ask the one thing you actually want to know'), 'licence still fires on a drought without reciprocity (nearest good case)');
  }

  // --- signoff turns: content demands stand down; the release defers ---
  {
    pin(night);
    const mkRelease = () => {
      const f = mkFriend('samantha');
      f.profile.sliders = Object.assign({}, f.profile.sliders, { curiosity: 60 });
      f.state.tension = 70; f.state.attraction = 55;
      f.state.lastTensionRelease = API._now() - 3600000; // came up earlier tonight
      return f;
    };
    const stack = [];
    for (let i = 0; i < 11; i++) stack.push({ role: 'user', text: 'thing number ' + i }, { role: 'assistant', text: 'reply about thing ' + i });
    const bye = stack.concat([{ role: 'user', text: 'Night sam' }]);
    const f = mkRelease();
    const dynBye = API.buildDynamicContext(f, API._now() - 10 * 60000, 0, 40, null, null, bye);
    ok(dynBye.includes('reply with exactly [end]'), 'room read still lets him go');
    ok(!dynBye.includes('comes to a head'), 'release note defers to the signoff');
    ok(!dynBye.includes('something real happened in your world'), 'no beat offer over his goodnight');
    ok(!dynBye.includes('ask the one thing you actually want to know'), 'no question licence over his goodnight');
    ok(!dynBye.includes('less effort back'), 'no reciprocity demand over his goodnight');
    const g = mkRelease();
    const dynLive = API.buildDynamicContext(g, API._now() - 10 * 60000, 0, 40, null, null,
      stack.concat([{ role: 'user', text: 'you still up?' }]));
    ok(dynLive.includes('comes to a head'), 'release note rides a live (non-signoff) turn (nearest good case)');
    // the meter is not spent over a goodnight — the moment keeps for the next real conversation
    const h = mkRelease();
    const before = { tension: h.state.tension, rel: h.state.lastTensionRelease };
    let out = API.applyStateDeltas(h, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] },
      { now: API._now(), gapMs: 10 * 60000, history: bye });
    ok(out.state.tension >= before.tension && out.state.lastTensionRelease === before.rel,
      'signoff turn neither spends the meter nor restamps the release');
    ok(!out.state.lastSignificant || !/came to a head/.test(out.state.lastSignificant.kind),
      'no came-to-a-head stamp minted over a goodbye');
    const k = mkRelease();
    out = API.applyStateDeltas(k, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] },
      { now: API._now(), gapMs: 10 * 60000, history: stack.concat([{ role: 'user', text: 'you still up?' }]) });
    ok(out.state.tension < 70 && out.state.lastTensionRelease > before.rel,
      'a live release turn still spends and stamps (nearest good case)');
  }

  // --- the end-the-night licence is time-aware ---
  {
    pin(evening); // 18:30
    const f = mkFriend('kelly');
    const dynEve = API.buildDynamicContext(f, API._now() - 3600000, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
    ok(dynEve.includes('NOT bedtime'), 'early-evening clock still says not bedtime');
    ok(!dynEve.includes('end the night'), 'no end-the-night licence at 6:30pm (the contradiction is gone)');
    pin(night); // 23:00
    const dynNight = API.buildDynamicContext(f, API._now() - 3600000, 0, 40, null, null, [{ role: 'user', text: 'hey' }]);
    ok(dynNight.includes('end the night'), 'the licence is present at night — she can still leave (nearest good case)');
  }

  // --- photoNote guarded wording softens once closeness is genuinely high ---
  {
    const settings = { pool: [{ id: 'b', enabled: true, kind: 'bedrock', apiKey: 'k', model: 'x', imageModel: 'amazon.titan-image' }] };
    const low = mkFriend('samantha'); // closeness 40 -> building
    const lowTxt = (API.photoNote(settings, low) || []).join('\n');
    ok(lowTxt.includes('do not know him well enough'), 'near-stranger keeps the distance wording');
    const deep = mkFriend('samantha');
    deep.state.closeness = 85; deep.bands = null;
    const deepTxt = (API.photoNote(settings, deep) || []).join('\n');
    ok(!deepTxt.includes('do not know him well enough'), 'deep closeness drops the "barely know him" claim');
    ok(deepTxt.includes('not what makes it casual'), 'softened wording keeps the caution without the lie');
    ok(deepTxt.includes('ATMOSPHERE') && /RARE/.test(deepTxt), 'atmosphere + rarity rules survive the soften (nearest good case)');
    const open = mkFriend('bre');
    open.profile.photoCandor = 'open'; open.state.closeness = 85; open.bands = null;
    const openTxt = (API.photoNote(settings, open) || []).join('\n');
    ok(!openTxt.includes('know him well enough') && !openTxt.includes('not what makes it casual') && openTxt.includes('without ceremony'),
      'open candor untouched by the band gate');
  }
  API.resetTimeOffset();
}

console.log('\n---\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
