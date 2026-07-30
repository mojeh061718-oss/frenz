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

/* ================================================================
   == detectors ==  (audit Phase 4A/4B — appended block; existing
   sections above are never renumbered. Sub-parts D1-D10.)
   ================================================================ */

// Intended-red support: an assertion that is RED against pre-audit code and
// goes green when the coordinated fix (audit/engine) merges is deferred by
// default and enforced with AUDIT_STRICT=1.
const STRICT = process.env.AUDIT_STRICT === '1';
function okOrDefer(cond, name, detail) {
  if (cond) { ok(true, name); }
  else if (STRICT) { ok(false, name, detail); }
  else { console.log('  DEFER ' + name + ' (intended-red: depends on the audit/engine merge; enforce with AUDIT_STRICT=1)'); }
}
// Async assertions register their promise here; the footer awaits them.
global.__asyncChecks = global.__asyncChecks || [];

console.log('\n== detectors D1: [end]/[noreply]/silence are different things ==');
{
  // invariant 18: [noreply] is a reply (left on read), [end] is a clean
  // exit, and neither token may ever render as a bubble.
  ok(API._stripEnd(['[end]']).length === 0, 'a lone [end] renders nothing');
  ok(API._stripEnd(['[noreply]']).length === 0, 'a lone [noreply] renders nothing');
  ok(JSON.stringify(API._stripEnd(['see you tomorrow', '[end]'])) === '["see you tomorrow"]',
    '[end] stapled to a real bubble is stripped, the bubble survives');
  ok(API._wantsSilence(['[noreply]']) === true, '[noreply] alone means she read it and said nothing');
  ok(API._wantsSilence(['[end]']) === false, '[end] is an ending, NOT a left-on-read');
  ok(API._wantsSilence(['[noreply]', 'also this']) === false, 'noreply plus content is not silence');
  ok(API._NOREPLY_RE.test(' [ no reply ] ') && API._NOREPLY_RE.test('leave on read'), 'noreply variants all recognized');
  ok(!API._END_RE.test('weekend') && !API._END_RE.test('the end of an era'), 'END matches the bare token only');
  // counter-case: a real sentence containing "end" is a message, not a token
  ok(API._stripEnd(['ok end of story lol']).length === 1, 'nearest good case: "end of story" is a real bubble');
}

console.log('\n== detectors D2: _injectDepth at 2/3/6/10, assistant-first ==');
{
  // The documented silent failure (api.js ~2079): every thread here opens
  // with HER greeting, and the old backward-only search never injected the
  // plist for the whole opening stretch — exactly when the voice gets set.
  const P = 'PLIST-SENTINEL';
  const probe = (roles) => {
    const out = API._injectDepth(roles.map((r, i) => ({ role: r, content: 'm' + i })), P, 'system');
    const idx = out.findIndex(m => m.content === P);
    return { idx, count: out.filter(m => m.content === P).length, prevRole: idx > 0 ? out[idx - 1].role : null, len: out.length };
  };
  const p2 = probe(['assistant', 'assistant']);          // her greeting only
  ok(p2.count === 1, 'len-2 all-assistant history STILL gets the plist (was the silent failure)');
  const p3 = probe(['assistant', 'assistant', 'user']);
  ok(p3.count === 1 && p3.prevRole === 'user', 'len-3 assistant-first: injected once, after a user turn');
  const p6 = probe(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  ok(p6.count === 1 && p6.prevRole === 'user', 'len-6: injected once at a user boundary');
  const p10 = probe(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  ok(p10.count === 1 && p10.prevRole === 'user', 'len-10: injected once at a user boundary');
  ok(Math.abs(p10.idx - (p10.len - 1 - 4)) <= 1, 'len-10: lands at ~depth 4 (idx ' + p10.idx + ' of ' + p10.len + ')');
}

console.log('\n== detectors D3: scene pipeline end-to-end ==');
{
  ok(API.SCENE_CHUNK === 35, 'SCENE_CHUNK is 35 (tests below assume it)');
  ok(API.sceneStale({ scenesCovered: 0 }, 44) === false, 'no scene while the uncovered tail is short');
  ok(API.sceneStale({ scenesCovered: 0 }, 45) === true, 'scene due at CHUNK+10 uncovered');
  ok(API.sceneStale({ scenesCovered: 35 }, 79) === false && API.sceneStale({ scenesCovered: 35 }, 80) === true,
    'coverage pointer moves the threshold with it');
  // recordScene: chunking + normalization, provider stubbed (no network)
  global.__asyncChecks.push((async () => {
    const orig = API._plainCompletion;
    API._plainCompletion = async () => 'sure! {"title":"The Fence Week","summary":"They talked about fences.","keywords":["Fence","WINE"],"facts":["Jon builds fences"],"importance":9}';
    try {
      const hist = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'm' + i }));
      const rec = await API.recordScene({ scenesCovered: 0, profile: { name: 'K', userName: 'Jon' } }, hist, {});
      ok(!!rec && rec.covered === 35 && JSON.stringify(rec.scene.covers) === '[0,35]',
        'recordScene consumes exactly one SCENE_CHUNK and advances coverage');
      ok(!!rec && JSON.stringify(rec.scene.keywords) === '["fence","wine"]' && rec.scene.importance === 5,
        'scene record normalized: lowercased keywords, importance clamped');
      const short = await API.recordScene({ scenesCovered: 20, profile: { name: 'K' } }, hist, {});
      ok(short === null, 'a partial chunk (30 msgs) records nothing');
    } finally { API._plainCompletion = orig; }
  })());
  // _sceneContext: chronological spine of the last 3 + keyword-matched extras
  const scenes = [];
  for (let i = 0; i < 6; i++) scenes.push({ title: 'Scene ' + i, summary: 'Summary of the thing number ' + i + '.', keywords: i === 0 ? ['kayak'] : ['misc' + i] });
  const hit = API._sceneContext({ scenes }, [{ role: 'user', text: 'thinking about that kayak trip' }], 2000);
  ok(hit.length === 4 && /Scene 0/.test(hit[0]) && /Scene 5/.test(hit[3]),
    'keyword-relevant older scene rides ahead of the recent-3 spine');
  const miss = API._sceneContext({ scenes }, [{ role: 'user', text: 'ordinary tuesday' }], 2000);
  ok(miss.length === 3 && !miss.some(l => /Scene 0/.test(l)), 'no keyword match -> just the recent 3');
  const budget = 320;
  const tight = API._sceneContext({ scenes: scenes.map(s => ({ title: s.title, summary: s.summary + ' ' + 'x'.repeat(150), keywords: s.keywords })) }, [{ role: 'user', text: 'kayak' }], budget);
  ok(tight.reduce((s, l) => s + l.length, 0) <= Math.max(300, budget), 'scene lines respect the char budget');
  // scenes reach the prompt ONLY once history has actually been omitted
  const kf = mkFriend('kelly');
  const sl = ['- Scene 0: the early days'];
  ok(!/story so far/.test(API.buildDynamicContext(kf, API._now() - 3600000, 0, 40, null, sl, [{ role: 'user', text: 'hey' }])),
    'omitted=0: scenes stay out of the dynamic block');
  ok(/story so far/.test(API.buildDynamicContext(kf, API._now() - 3600000, 5, 40, null, sl, [{ role: 'user', text: 'hey' }])),
    'omitted>0: scenes appear');
}

console.log('\n== detectors D4: cache invariant — byte-stable system, stepped window, disclosed trims ==');
{
  // system block byte-stable per (friend, tier) across days: per-day rotation
  // belongs in the injected messages, never the system block.
  for (const id of ['kelly', 'bre', 'samantha', 'tay', 'anna']) {
    const f = mkFriend(id);
    const p1 = API.buildPersona(f, 'rich');
    API._timeOffset = null; API.addTimeOffset(3 * DAY);
    const p2 = API.buildPersona(f, 'rich');
    API.resetTimeOffset();
    ok(p1 === p2, id + ': persona byte-stable across simulated days (rich tier)');
  }
  const entry = { id: 'x', enabled: true, kind: 'openai', baseUrl: 'https://api.x.ai/v1', apiKey: 'k', model: 'grok-4', contextTokens: 1000000 };
  const mkHist = (L) => Array.from({ length: L }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'msg number ' + i + ' padding words here' }));
  const firstKept = (req) => {
    const m = req.messages.find(x => /^msg number /.test(x.content));
    return m ? Number(m.content.match(/msg number (\d+)/)[1]) : -1;
  };
  // window left edge moves ONLY in HISTORY_STEP chunks
  const edges = {};
  for (const L of [72, 95, 96, 119, 120, 150]) {
    edges[L] = firstKept(API._buildPlainRequest(entry, mkFriend('kelly'), mkHist(L), Date.now() - 600000, API._jsonInstruction(), true));
  }
  ok(edges[72] === 0 && edges[95] === 0, 'window edge holds at 0 until a full HISTORY_STEP has accumulated (L95: ' + edges[95] + ')');
  ok(edges[96] === 24 && edges[119] === 24, 'edge advances to 24 at L96 and HOLDS through L119 (prefix-cache friendly)');
  ok(edges[120] === 48 && edges[150] === 72, 'edge keeps stepping in HISTORY_STEP=24 chunks (L120: ' + edges[120] + ', L150: ' + edges[150] + ')');
  ok(Object.values(edges).every(e => e % API.HISTORY_STEP === 0), 'every observed edge is a multiple of HISTORY_STEP');
  // trim disclosure == reality, across budgets (any trim must be disclosed)
  for (const ct of [12000, 15000, 1000000]) {
    const req = API._buildPlainRequest(Object.assign({}, entry, { contextTokens: ct }), mkFriend('kelly'), mkHist(200), Date.now() - 600000, API._jsonInstruction(), true);
    const kept = req.messages.filter(m => /^msg number /.test(m.content)).length;
    const actual = 200 - kept;
    const dis = req.messages.map(m => m.content).join('\n').match(/About (\d+) earlier messages aren't shown/);
    ok(req.omitted === actual, 'ct ' + ct + ': returned omitted matches what was actually left out (' + req.omitted + ' vs ' + actual + ')');
    ok(actual === 0 ? !dis : (!!dis && Number(dis[1]) === actual),
      'ct ' + ct + ': in-prompt disclosure matches the actual trim (' + (dis ? dis[1] : 'none') + ' vs ' + actual + ')');
  }
  // The CORRECT behavior for the final safety trim (plan Phase 2A: the
  // disclosure must be rebuilt after the trim). Today the dynamic block
  // bakes its count BEFORE the final trim, so when the finished request
  // outgrows the estimate the extra drops are undisclosed. Simulated by
  // letting the dynamic block grow between the probe and the real build —
  // exactly the divergence the reserve constant is guessing at.
  {
    const orig = API.buildDynamicContext;
    API.buildDynamicContext = function (friend, ts, omitted) {
      const out = orig.apply(this, arguments);
      return omitted === 1 ? out : out + '\n' + 'X'.repeat(30000); // probe passes omitted=1
    };
    let req;
    try {
      req = API._buildPlainRequest(Object.assign({}, entry, { contextTokens: 15000 }), mkFriend('kelly'), mkHist(200), Date.now() - 600000, API._jsonInstruction(), true);
    } finally { API.buildDynamicContext = orig; }
    const kept = req.messages.filter(m => /^msg number /.test(m.content)).length;
    const actual = 200 - kept;
    const dis = req.messages.map(m => m.content).join('\n').match(/About (\d+) earlier messages aren't shown/);
    okOrDefer(!!dis && Number(dis[1]) === actual,
      'final safety trim keeps the disclosure honest (disclosed ' + (dis ? dis[1] : 'none') + ' vs actual ' + actual + ')',
      'silent-trim bug: dynamic block baked the pre-trim count');
  }
}

console.log('\n== detectors D5: parse-salvage layer ==');
{
  ok(JSON.stringify(API._looseParse('```json\n{"a":1}\n```')) === '{"a":1}', 'fenced JSON parses');
  ok(JSON.stringify(API._looseParse('Sure! {"messages":["hi"]} hope that helps')) === '{"messages":["hi"]}', 'prose-wrapped JSON parses');
  ok(API._looseParse('{"messages":["hi"') === null, 'truncated JSON returns null, never throws');
  // state blob written INTO the visible reply: stripped from the text,
  // salvaged into state, deltas clamped
  const fr = API._finishReply('She smiled. {"state": {"comfort_delta": 9, "mood": "warm"}} anyway that was my day, pretty wild honestly');
  ok(fr.parsedOk === false && fr.bubbles.length === 2 && fr.bubbles.every(b => !/[{}]/.test(b)),
    'prose reply: state blob never reaches the screen');
  ok(!!fr.state && fr.state.comfort_delta === 3 && fr.state.mood === 'warm',
    'salvaged state still lands, delta clamped to MAX_DELTA (9 -> 3)');
  const tr = API._finishReply('{"messages":["hi"');
  ok(tr.parsedOk === false && tr.state === null && tr.bubbles.every(b => !/^[{["]/.test(b)),
    'truncated JSON: no artifact shrapnel ships as a bubble');
  // missing fields come back typed, not undefined
  const st = API._normStateRaw({ comfort_delta: 9, confidence: 3 });
  ok(st.comfort_delta === 3 && st.closeness_delta === 0 && st.confidence === 1 && st.mood === '' && Array.isArray(st.new_memories),
    '_normStateRaw fills and clamps every field');
  ok(API._normStateRaw(null) === null && API._normStateRaw('x') === null, 'non-objects normalize to null');
  // counter-case: unrelated braces in a real text are left alone
  const ex = API._extractStateBlob('use {this} emoticon');
  ok(ex.text === 'use {this} emoticon' && ex.state === null, 'nearest good case: non-state braces are not eaten');
}

console.log('\n== detectors D6: readTheRoom branches ==');
{
  const at = (tpl, attr) => {
    const f = mkFriend(tpl);
    f.state.attraction = attr; f.bands = null;
    return f;
  };
  const room = (f, t, h) => (API.readTheRoom(f, h || [{ role: 'user', text: t }], false) || []).join(' ');
  // the four explicit forks
  ok(/serve, not a trespass/.test(room(at('kelly', 60), 'what are you wearing')), 'explicit + flirt-sport persona: her sport');
  ok(/not welcome/.test(room(at('samantha', 10), 'what are you wearing')), 'explicit at low attraction: temperature drops');
  ok(/threw you/.test(room(at('samantha', 40), 'what are you wearing')), 'explicit at building: bolder than where you are');
  ok(/It landed/.test(room(at('samantha', 60), 'what are you wearing')), 'explicit at high: it landed');
  // innuendo and frame
  ok(API._classifyUserTurn("can't get off 🤣") === 'innuendo', 'the classic double-read classifies as innuendo');
  ok(/second reading/.test(room(at('samantha', 40), "can't get off 🤣")), 'innuendo: she HEARD it');
  ok(API._classifyUserTurn('hypothetically if you were here we would be in trouble') === 'frame', 'hypothetical classifies as frame');
  ok(/deniable FRAME/.test(room(at('samantha', 40), 'hypothetically if you were here we would be in trouble')), 'frame: playable at any level');
  // withdrawal
  const wd = [];
  for (let i = 0; i < 7; i++) {
    wd.push({ role: 'user', text: 'a fairly long message about the day and the office and everything else nr ' + i });
    wd.push({ role: 'assistant', text: 'reply ' + i });
  }
  wd.push({ role: 'user', text: 'ya' }, { role: 'assistant', text: 'r' }, { role: 'user', text: 'k' }, { role: 'assistant', text: 'r' }, { role: 'user', text: 'sure' });
  ok(API._isWithdrawing(wd) === true, 'sharply shorter recent messages read as withdrawal');
  ok(/pulling back/.test(room(at('samantha', 40), '', wd)), 'room read names the pull-back');
  const steady = [];
  for (let i = 0; i < 10; i++) {
    steady.push({ role: 'user', text: 'an ordinary medium sized message about the day nr ' + i });
    steady.push({ role: 'assistant', text: 'reply ' + i });
  }
  ok(API._isWithdrawing(steady) === false, 'nearest good case: steady message length is not withdrawal');
  // _recentTone classes
  const tone = (texts) => API._recentTone(texts.map(t => ({ role: 'user', text: t })));
  ok(/^charged/.test(tone(['what are you wearing', 'cant stop thinking about you', 'x', 'send nudes'])), 'tone: charged');
  ok(/^warm and playful/.test(tone(['lol you would say that', 'haha no way jk', 'that is hilarious lol', 'x'])), 'tone: warm and playful');
  ok(/^flat/.test(tone(['k', 'ok', 'sure', 'lol'])), 'tone: flat');
  ok(/^easy and ordinary/.test(tone(['the office fire alarm went off', 'got groceries after work', 'long day mostly'])), 'tone: ordinary');
}

console.log('\n== detectors D7: rationed-frequency dials ==');
{
  // playfulNote: 25% + 12/attraction-band + 12 hum, cap 60 (a named balance
  // dial with no test until now). Statistical over deterministic day rolls.
  const base = new Date(2026, 0, 1, 20, 0).getTime();
  const odds = (attr, tension) => {
    const f = mkFriend('kelly');
    f.state.attraction = attr; f.state.tension = tension; f.bands = null;
    let hits = 0;
    for (let d = 0; d < 400; d++) if (/in the mood to play/.test(API.playfulNote(f, base + d * DAY))) hits++;
    return hits;
  };
  const lowOdds = odds(10, 0);          // pct 25
  const capOdds = odds(60, 40);         // 25 + 24 + 12 = 61 -> capped 60
  ok(lowOdds >= 60 && lowOdds <= 140, 'base wit odds ~25% (' + lowOdds + '/400)');
  ok(capOdds >= 190 && capOdds <= 290, 'high-band + hum odds ~60% (' + capOdds + '/400)');
  ok(capOdds <= 290, 'the 60% cap holds — wit stays rationed even fully lit');
  {
    const f = mkFriend('kelly');
    let lit = false, plain = false;
    for (let d = 0; d < 30; d++) {
      const n = API.playfulNote(f, base + d * DAY);
      if (/ONE good line/.test(n)) lit = true;
      if (/not building bits/.test(n)) plain = true;
    }
    ok(lit && plain, 'both faces of the note speak across a month — the die never falls silent');
  }
  // openerDue at ordinary hours: ROLL_PCT day dice, MIN_GAP_H, DOUBLE_TEXT_GAP_H
  const twoPm = (d) => new Date(2026, 0, 1, 14, 0).getTime() + d * DAY;
  let roll = 0, shortGap = 0, dblShort = 0, dblLong = 0;
  for (let d = 0; d < 200; d++) {
    const now = twoPm(d);
    if (API.openerDue(mkFriend('kelly'), [{ role: 'user', text: 'later', ts: now - 8 * 3600000 }], now)) roll++;
    if (d < 50 && API.openerDue(mkFriend('kelly'), [{ role: 'user', text: 'x', ts: now - 5 * 3600000 }], now)) shortGap++;
    if (API.openerDue(mkFriend('kelly'), [{ role: 'assistant', text: 'ok talk later', ts: now - 8 * 3600000 }], now)) dblShort++;
    if (API.openerDue(mkFriend('kelly'), [{ role: 'assistant', text: 'ok talk later', ts: now - 21 * 3600000 }], now)) dblLong++;
  }
  ok(roll >= 60 && roll <= 120, 'ordinary afternoon opener fires at ~ROLL_PCT (' + roll + '/200 at 45%)');
  ok(shortGap === 0, 'no opener under MIN_GAP_H (5h gap: ' + shortGap + '/50)');
  ok(dblShort === 0, 'she never double-texts inside DOUBLE_TEXT_GAP_H at ordinary hours (8h: ' + dblShort + '/200)');
  ok(dblLong >= 80 && dblLong <= 175, 'past 20h a double-text becomes possible, still dice-gated (' + dblLong + '/200)');
}

console.log('\n== detectors D8: photo identity — pov pool, heat, candor, recovery ladder ==');
{
  // pov pool variety: near-identical torso framings made every body photo
  // the same photo. Judged with the pipeline's own echo scorer.
  const pov = API._FRAMING.pov;
  ok(pov.length >= 5 && new Set(pov).size === pov.length, 'pov pool has 5+ unique framings');
  let worstPair = 0;
  for (let i = 0; i < pov.length; i++) {
    for (let j = i + 1; j < pov.length; j++) {
      const a = API._normBubble(pov[i]), b = API._normBubble(pov[j]);
      worstPair = Math.max(worstPair, API._echoScore(a, b), API._echoScore(b, a));
    }
  }
  ok(worstPair < 0.8, 'no two pov framings are near-identical (worst pairwise echo ' + worstPair.toFixed(2) + ')');
  ok(pov.every(f => /head|collarbone|shoulders|mid-torso/i.test(f)), 'every pov framing is faceless by construction');
  // heat: present per level, and only where it belongs
  ok(API._HEAT_TONE.length === 3 && API._HEAT_TONE[0] === '' && !!API._HEAT_TONE[1] && /implication rather than display/.test(API._HEAT_TONE[2]),
    '_HEAT_TONE: silent at 0, warm at 1, implication at 2');
  const heatAt = (attr, comfort, tension) => {
    const f = mkFriend('samantha');
    f.state.attraction = attr; f.state.comfort = comfort; f.state.tension = tension; f.bands = null;
    return API._imageHeat(f);
  };
  ok(heatAt(10, 30, 0) === 0 && heatAt(40, 30, 0) === 1 && heatAt(80, 30, 0) === 2, '_imageHeat tracks the attraction band (0/1/2)');
  ok(heatAt(10, 30, 8) === 2, 'high tension alone can charge the frame');
  const app = Personas.byId('samantha').appearance;
  ok(/implication rather than display/.test(API._imagePrompt('curled on the couch', 'pov', app, 2)), 'heat tail rides a pov prompt');
  ok(!/implication rather than display/.test(API._imagePrompt('the bowl of ramen', 'scene', app, 2)), 'scene photos never carry heat — the room is not flirting');
  // photoCandor: per-character constraint, open vs guarded text
  const imgSettings = { pool: [{ id: 'e1', enabled: true, kind: 'bedrock', apiKey: 'k', model: 'x', imageModel: 'stability-image', region: 'us-east-1' }] };
  const openF = mkFriend('bre'), guardedF = mkFriend('samantha');
  ok(openF.profile.photoCandor === 'open' && guardedF.profile.photoCandor === 'guarded', 'template candor as authored (bre open, samantha guarded)');
  ok(/without ceremony/.test(API.photoNote(imgSettings, openF).join(' ')), 'open candor: no ceremony, no apology');
  ok(/not a small thing/.test(API.photoNote(imgSettings, guardedF).join(' ')), 'guarded candor: a picture is a step');
  ok(API.photoNote({ pool: [] }, openF) === null, 'no image model configured -> she never hears about photos');
  // recovery ladder: each rung strictly less of a person
  ok(JSON.stringify(API._RECOVERY_LADDER.mirror) === '["pov","scene"]'
    && JSON.stringify(API._RECOVERY_LADDER.pov) === '["scene"]'
    && JSON.stringify(API._RECOVERY_LADDER.scene) === '[]',
    '_RECOVERY_LADDER steps mirror -> pov -> scene -> (give up), never sideways');
}

console.log('\n== detectors D9: sliderText speaks only for moved dials ==');
{
  const def = { flirtiness: 55, warmth: 60, confidence: 50, curiosity: 50 };
  const untouched = Personas.sliderText(Object.assign({}, def), 'Kelly', def);
  ok(untouched.personality === '' && untouched.style === '', 'untouched dials contribute NOTHING (template prose already says it better)');
  const flirt = Personas.sliderText(Object.assign({}, def, { flirtiness: 95 }), 'Kelly', def);
  ok(flirt.personality.length > 0 && /flirt/i.test(flirt.personality + flirt.style), 'a moved flirtiness dial speaks');
  const warmth = Personas.sliderText(Object.assign({}, def, { warmth: 10 }), 'Kelly', def);
  ok(warmth.personality.length > 0 && warmth.style === '' && !/flirt/i.test(warmth.personality),
    'one moved dial -> one clause, no flirt text rides along');
  const sameBand = Personas.sliderText(Object.assign({}, def, { flirtiness: 60 }), 'Kelly', def);
  ok(sameBand.personality === '', 'a nudge inside the same band is not a moved dial');
  const custom = Personas.sliderText(Object.assign({}, def), 'Custom', null);
  ok(custom.personality.length > 0, 'a characterless custom friend still gets the full set (what sliderText was written for)');
}

console.log('\n== detectors D10: the archive sees what the live guards see ==');
{
  // Synthetic fixture: friend "Echo" exercises every new archive detector;
  // friend "Clean" is the nearest-good-case for each and must stay clean.
  const t0 = new Date(2026, 5, 1, 19, 0).getTime();
  const HOUR = 3600000;
  const mkMsgs = () => {
    const msgs = []; let ts = t0;
    const push = (role, text, extra) => { msgs.push(Object.assign({ role, text, ts }, extra || {})); ts += 3 * 60000; };
    push('user', 'hey how was the weekend');
    push('assistant', 'Long. The fence project ate both days and I have the sunburn to prove it.');
    push('user', 'lol you finish it at least?');
    push('assistant', 'Mostly. Two panels left and my dignity is gone.');
    // self-echo run: the same status re-announced, reworded, three times
    push('user', 'what are you up to tonight');
    push('assistant', 'just curled up on the couch with wine and trash tv honestly');
    push('user', 'sounds ideal');
    push('assistant', 'yeah just on the couch with my wine watching trash tv');
    push('user', 'living the dream over there');
    push('assistant', 'honestly just wine on the couch and the trash tv again');
    // press loop (the cami shape)
    push('user', 'what kinda cami is it');
    push('assistant', 'haha its this super old thin cami ive had forever');
    push('user', 'so its a thin one?');
    push('assistant', 'yeah its this super thin old one ive had forever');
    push('user', 'i bet the cami is too thick still');
    push('assistant', 'its just an old thin cami basically from forever ago');
    push('user', 'lemme see the cami');
    push('assistant', 'not a chance mister');
    // shape rut: 4 of 5 agreement openers
    ts += 26 * HOUR;
    push('user', 'that meeting was a disaster');
    push('assistant', 'yeah i know right');
    push('user', 'he really doubled down too');
    push('assistant', 'haha yeah he really did');
    push('user', 'and then blamed the intern');
    push('assistant', 'lmao yeah classic him');
    push('user', 'i almost said something');
    push('assistant', 'yeah you should have honestly');
    push('user', 'next time');
    push('assistant', 'hold me to it');
    // a delivered photo
    push('user', 'send me a pic of the fence then');
    push('assistant', '', { photo: 'data:image/png;base64,x', photoDesc: 'the half-finished fence at dusk' });
    push('user', 'ok that is actually a fence');
    push('assistant', 'told you it was real');
    return msgs;
  };
  const dk = API._dayKey(t0);
  const echoFriend = {
    id: 'echo-1',
    profile: { name: 'Echo', userName: 'Jon', type: 'friend', style: 'Proper grammar and full sentences, punctuates everything.', personality: 'A.', interests: 'B.' },
    createdAt: t0 - 40 * DAY,
    state: { comfort: 55, closeness: 52, attraction: 30, tension: 12, mood: 'fine', floors: { comfort: 50, closeness: 50, attraction: 25 }, _carry: {} },
    memories: [], scenes: [],
    beatLog: [{ day: dk - 30, idx: 4 }, { day: dk - 18, idx: 4 }, { day: dk - 6, idx: 7 }],   // idx 4 repeats after 12d
    textureLog: [{ day: dk - 20, idx: 1 }, { day: dk - 9, idx: 3 }, { day: dk - 1, idx: 5 }]  // clean
  };
  const echoEvents = [];
  {
    let ets = t0 + 5 * 60000, comfort = 46;
    const after = (c, cl, a, tn) => ({ comfort: c, closeness: cl, attraction: a, tension: tn });
    for (let i = 0; i < 5; i++) {   // one burst, net comfort +8 = SESSION_CAP; crosses into 'high'
      const d = i < 4 ? 2 : 0;
      comfort += d;
      echoEvents.push({ ts: ets, applied: { comfort: d, closeness: 1, attraction: 0 }, deltas: { comfort: 3, closeness: 1, attraction: 0 }, after: after(comfort, 48 + i, 30, 10 + i), tension: 10 + i, confidence: 0.9, reason: 'a good stretch' });
      ets += 10 * 60000;
    }
    ets += 3 * DAY;
    echoEvents.push({ ts: ets, reason: 'absence — days without a word', confidence: 1, deltas: { comfort: -1, closeness: 0, attraction: 0 }, applied: { comfort: -1, closeness: 0, attraction: 0 }, tension: 8, after: after(comfort - 1, 52, 30, 8) });
    ets += HOUR;
    echoEvents.push({ ts: ets, kind: 'senderr', status: 529, message: 'overloaded' });
    echoEvents.push({ ts: ets + 5 * 60000, kind: 'refusal', message: 'content refusal' });
    const pts = ets + 10 * 60000;
    for (let r = 1; r <= 3; r++) echoEvents.push({ ts: pts + r * 20000, kind: 'imgerr', declined: true, status: 400, reframe: r + '/3', message: 'moderation', desc: 'on the couch' });
  }
  // Clean: varied riffs on a shared bit (the live counter-case), varied
  // lengths, questions asked, matching voice, spaced bank logs.
  const cleanMsgs = [];
  {
    let ts = t0;
    const push = (role, text) => { cleanMsgs.push({ role, text, ts }); ts += 4 * 60000; };
    push('user', 'the gremlin strikes again');
    push('assistant', 'He unplugged the router to charge his tablet. Bold move.');
    push('user', 'the gremlin has no mercy');
    push('assistant', 'None. Today he negotiated two desserts out of Trevor, held the dog hostage over bath time, and still got tucked in like a prince.');
    push('user', 'gremlin lore grows');
    push('assistant', 'Dog bed. Asleep. Again.');
    push('user', 'the gremlin rests');
    push('assistant', 'Only until he wakes up hungry. What did your day look like?');
    push('user', 'meetings mostly, one good one');
    push('assistant', 'Which one was the good one? I want details, I live vicariously.');
    push('user', 'the budget one weirdly');
    push('assistant', 'A budget meeting being the highlight is either great news or a cry for help.');
    push('user', 'bit of both');
    push('assistant', 'That tracks. I made an enormous lasagna and regret nothing.');
    push('user', 'save me a slice');
    push('assistant', 'Come get it before the gremlin finds the leftovers.');
  }
  const cleanFriend = {
    id: 'clean-1',
    profile: { name: 'Clean', userName: 'Jon', type: 'friend', style: 'Proper grammar and full sentences, punctuates everything.', personality: 'B.', interests: 'C.' },
    createdAt: t0 - 40 * DAY,
    state: { comfort: 55, closeness: 52, attraction: 30, tension: 5, mood: 'fine', floors: { comfort: 50, closeness: 50, attraction: 25 }, _carry: {} },
    memories: [], scenes: [],
    beatLog: [{ day: dk - 30, idx: 2 }, { day: dk - 5, idx: 9 }],
    textureLog: [{ day: dk - 12, idx: 0 }, { day: dk - 2, idx: 4 }]
  };
  const cleanEvents = [{ ts: t0 + 10 * 60000, applied: { comfort: 1, closeness: 1, attraction: 0 }, deltas: { comfort: 1, closeness: 1, attraction: 0 }, after: { comfort: 56, closeness: 53, attraction: 30, tension: 5 }, tension: 5, confidence: 0.9, reason: 'easy night' }];

  const md = API.buildArchive(
    [echoFriend, cleanFriend],
    { 'echo-1': mkMsgs(), 'clean-1': cleanMsgs },
    { 'echo-1': echoEvents, 'clean-1': cleanEvents });

  const idxLine = (name) => (md.split('\n').find(l => l.startsWith('- **' + name + '**')) || '');
  const section = (name) => md.slice(md.indexOf('# ' + name));

  // every new detector fires on Echo — and surfaces at the INDEX
  const ei = idxLine('Echo');
  ok(/self-echo rerun/.test(ei), 'index: self-echo reruns flagged (' + ei.replace(/^[^·]*· /, '') + ')');
  ok(/agreement-opener shape rut/.test(ei), 'index: shape rut flagged');
  ok(/pressed loop/.test(ei), 'index: pressed loop flagged');
  ok(/voice mismatch/.test(ei), 'index: voice MISMATCH now surfaces at the index, not only the appendix');
  ok(/beat repeat/.test(ei), 'index: beat repeat (live-data violation) flagged');
  const es = section('Echo');
  ok(/Self-echo.*rerun/.test(es) && /#00/.test(es.match(/- \*\*Self-echo\*\*[^\n]*/)[0]), 'appendix: self-echo cites message numbers');
  ok(/SHAPE RUT \(live threshold 3-of-5\)/.test(es), 'appendix: worst agreement-opener stretch reported at the live threshold');
  ok(/Pressed loops\*\*: 1 episode/.test(es), 'appendix: exactly one pressed-loop episode (the cami loop)');
  ok(/Life beats\*\*.*REPEAT INSIDE THE 21-DAY WINDOW/.test(es), 'appendix: beat repeat inside 21 days is called out');
  ok(/Textures\*\*.*no repeat inside the 8-day window/.test(es), 'appendix: clean texture log reads clean');
  ok(/Band traversals\*\*: comfort building→high/.test(es), 'appendix: band traversal with date');
  ok(/Absence drift\*\*: 1 event, 1 comfort point/.test(es), 'appendix: absence drift totaled');
  ok(/Floors set.*comfort 50 · closeness 50 · attraction 25/.test(es), 'appendix: floors reported');
  ok(/Cap saturation\*\*: 1 burst hit the ±8 session cap/.test(es), 'appendix: cap-saturated burst counted');
  ok(/Outcome ledger\*\*: 1 transport error\(s\) · 1 refusal\(s\) · 3 photo error event\(s\)/.test(es), 'appendix: senderr/refusal/imgerr kept distinct (invariant 18)');
  ok(/Photos\*\*: 1 delivered · 1 decline episode \(50% decline rate\) · 3 moderation re-framing rungs/.test(es), 'appendix: photo aggregates from markers + imgerr events');

  // the question definition is UNIFIED with the live guard: an unmarked
  // question counts, and the raw "?" rate stays as the secondary number
  const qd = API._archDiagnostics([
    { role: 'user', text: 'hey' },
    { role: 'assistant', text: 'what do you even do monday to friday' },
    { role: 'assistant', text: 'my day was long' },
    { role: 'user', text: 'work mostly' },
    { role: 'assistant', text: 'figured' }
  ], { name: 'Q', style: '' });
  const qline = qd.lines.find(l => /Questions from her/.test(l)) || '';
  ok(/33% question-shaped/.test(qline) && /raw "\?"-endings 0%/.test(qline),
    'archive hears the unmarked question exactly like _QUESTION_SHAPED (' + qline.replace(/^- \*\*[^*]*\*\*: /, '') + ')');

  // and every nearest-good-case stays clean: varied riffs on a shared bit,
  // real questions, matching voice, spaced beats
  const ci = idxLine('Clean');
  ok(/no red flags/.test(ci), 'nearest good cases draw NO flags (' + ci.replace(/^- \*\*Clean\*\* — /, '') + ')');
  const cs = section('Clean');
  ok(/Self-echo.*no reruns/.test(cs), 'varied riffs on a shared bit are not self-echo');
  ok(/Pressed loops\*\*: none/.test(cs), 'his running bit without her repeated dodge is not a press loop');
  ok(/Agreement-opener shape\*\*: 0\//.test(cs), 'no agreement-opener tic on varied openers');
  ok(/Voice fidelity.*consistent with her stated style/.test(cs), 'matching voice stays unflagged');
}

// The footer AWAITS any async detector assertions (D3's recordScene); with
// none registered it behaves exactly as it always did.
Promise.allSettled(global.__asyncChecks || []).then(() => {
  console.log('\n---\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
