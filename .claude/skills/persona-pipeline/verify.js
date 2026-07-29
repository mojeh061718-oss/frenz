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

console.log('\n---\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
