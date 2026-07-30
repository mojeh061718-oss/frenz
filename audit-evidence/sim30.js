/* sim30.js <rootDir> — 30-day balance simulations over the REAL engine,
   loaded headlessly from the given repo root (pre-audit copy or worktree).
   Every scenario is deterministic so two engine versions are comparable
   line by line. Pattern: SKILL.md "sim harness" section. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node sim30.js <rootDir>'); process.exit(2); }
const ctx = { console, Date, Math, JSON, localStorage: { getItem: () => null, setItem: () => {} }, navigator: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/personas.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), ctx);
const API = vm.runInContext('ClaudeAPI', ctx);
const Personas = vm.runInContext('Personas', ctx);
const DAY = 86400000, HOUR = 3600000;

function mkFriend(tplId) {
  const t = Personas.byId(tplId);
  const profile = JSON.parse(JSON.stringify(t));
  profile.userName = 'Jon';
  profile.world = Personas.WORLD;
  return {
    id: tplId + '-1', profile,
    createdAt: Date.now() - 20 * DAY,
    state: { mood: t.mood, comfort: 40, closeness: 40, attraction: 35, tension: 10,
             opinion_notes: t.opinion, unsaid: '', _carry: {} },
    memories: JSON.parse(JSON.stringify(t.seedMemories || [])),
    vibeSeed: 7
  };
}
// tiny deterministic hash for scenario choices (independent of engine)
function h32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
const CHARGED = [{ role: 'user', text: 'been thinking about you today, not gonna lie' }, { role: 'assistant', text: 'oh?' }];
const PLAIN = [{ role: 'user', text: 'the fire alarm went off at work again' }, { role: 'assistant', text: 'lol classic' }];
const T0 = new Date(2026, 6, 1, 19, 0, 0).getTime(); // fixed local evening

// Mimic the app's drift call. The AFTER engine anchors in app.js; replicate
// that contract here so both engines are driven the way their app drives them.
function drift(f, lastContact, now) {
  const from = Math.max(lastContact, Number(f.driftAnchor) || 0);
  const gap = now - from;
  if (gap < 2 * DAY) return 0;
  const c0 = Number(f.state.closeness) || 0;
  const cooled = API.applyAbsenceDrift(f, gap);
  f.driftAnchor = now;
  return { comfort: cooled, closeness: c0 - (Number(f.state.closeness) || 0) };
}

console.log('ENGINE @ ' + ROOT);

/* ---- 1. 30-day arc per persona: movement, traversal, drift, releases ---- */
console.log('\n[1] 30-day arc (20 sessions of 3 exchanges, 40% charged, drift before each session)');
for (const id of ['kelly', 'bre', 'anna', 'samantha', 'tay']) {
  const f = mkFriend(id);
  const start = JSON.parse(JSON.stringify(f.state));
  let lastContact = T0 - 2 * HOUR;
  let bandFlips = 0, driftComfort = 0, driftCloseness = 0, releases = 0, hums = 0, lastRelease = 0;
  let prevBands = JSON.stringify(API.bandsFor(f));
  for (let d = 0; d < 30; d++) {
    if (d % 3 === 2) continue; // every third day is silent
    const dayStart = T0 + d * DAY;
    const dr = drift(f, lastContact, dayStart);
    if (dr) { driftComfort += dr.comfort; driftCloseness += dr.closeness; }
    const charged = h32(id + '|' + d) % 5 < 2;
    for (let e = 0; e < 3; e++) {
      const now = dayStart + e * 12 * 60000;
      const out = API.applyStateDeltas(f, {
        comfort_delta: 1, closeness_delta: e === 0 ? 1 : 0, attraction_delta: 0,
        confidence: 0.9, new_memories: []
      }, { now, gapMs: e === 0 ? (now - lastContact) : 12 * 60000, history: charged ? CHARGED : PLAIN });
      f.state = out.state;
      lastContact = now;
      if (Number(f.state.lastTensionRelease) && f.state.lastTensionRelease !== lastRelease) { releases++; lastRelease = f.state.lastTensionRelease; }
      const t = Number(f.state.tension) || 0;
      if (t >= 24 && t < 30) { // hysteresis zone: does the hum section hold?
        if (API.tensionNote(f, now) !== null) hums++;
      }
    }
    const nb = JSON.stringify(API.bandsFor(f));
    if (nb !== prevBands) { bandFlips++; prevBands = nb; }
  }
  console.log(`  ${id}: comfort ${start.comfort}->${f.state.comfort}, closeness ${start.closeness}->${f.state.closeness}, attraction ${start.attraction}->${f.state.attraction}, tension ${f.state.tension}` +
    ` | bandFlips ${bandFlips}, releases ${releases}, driftCost c${driftComfort}/cl${driftCloseness}, humTurnsInZone ${hums}, floors ${JSON.stringify(f.state.floors || {})}`);
}

/* ---- 2. pure absence: 30 days of silence from a seeded-high state ---- */
console.log('\n[2] pure absence: comfort 62 / closeness 62 / attraction 40, then 30 silent days (weekly drift checks)');
{
  const f = mkFriend('samantha');
  f.state.comfort = 62; f.state.closeness = 62; f.state.attraction = 40;
  const o = API.applyStateDeltas(f, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] }, { now: T0, history: [] });
  f.state = o.state;
  let lastContact = T0;
  for (let wk = 1; wk <= 4; wk++) drift(f, lastContact, T0 + wk * 7 * DAY);
  drift(f, lastContact, T0 + 30 * DAY);
  console.log(`  after 30 days: comfort ${f.state.comfort}, closeness ${f.state.closeness}, attraction ${f.state.attraction}, floors ${JSON.stringify(f.state.floors)}`);
}

/* ---- 3. drift vs achievable gains (invariant 15) ---- */
console.log('\n[3] invariant 15: contact every 5 days (one 2-exchange burst) for 60 days — gains must outrun drift');
{
  const f = mkFriend('tay');
  const start = { comfort: f.state.comfort, closeness: f.state.closeness };
  let lastContact = T0;
  for (let d = 5; d <= 60; d += 5) {
    const now = T0 + d * DAY;
    drift(f, lastContact, now);
    for (let e = 0; e < 2; e++) {
      const out = API.applyStateDeltas(f, { comfort_delta: 1, closeness_delta: 1, attraction_delta: 0, confidence: 0.9, new_memories: [] },
        { now: now + e * 20 * 60000, gapMs: e === 0 ? (now - lastContact) : 20 * 60000, history: PLAIN });
      f.state = out.state;
    }
    lastContact = now + 20 * 60000;
  }
  console.log(`  comfort ${start.comfort}->${f.state.comfort}, closeness ${start.closeness}->${f.state.closeness} (both must rise)`);
}

/* ---- 4. beat/texture frequency & rotation (must be unchanged) ---- */
console.log('\n[4] beat & texture dice over 60 days (frequency and 21/8-day no-repeat must match across engines)');
for (const id of ['samantha', 'tay']) {
  const f = mkFriend(id);
  f.beatLog = []; f.textureLog = [];
  let beats = 0, textures = 0, beatRepeats = 0;
  const seen = [];
  for (let d = 0; d < 60; d++) {
    const now = T0 + d * DAY + HOUR; // 20:00
    const b = API._lifeBeat(f, now);
    if (b) {
      beats++;
      for (const s of seen) if (s.b === b && d - s.d < 21) beatRepeats++;
      seen.push({ d, b });
    }
    if (API._lifeTexture(f, now)) textures++;
  }
  console.log(`  ${id}: beats ${beats}/60, repeats<21d ${beatRepeats}, textures ${textures}/60`);
}

/* ---- 5. hum persistence through the hysteresis zone ---- */
console.log('\n[5] hum hysteresis: charge to ~34, then mundane decay through the 24-30 zone');
{
  const f = mkFriend('bre');
  f.state.attraction = 20; // keep releases out of the picture
  let now = T0;
  while ((Number(f.state.tension) || 0) < 32) {
    now += 10 * 60000;
    const out = API.applyStateDeltas(f, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] },
      { now, gapMs: 10 * 60000, history: CHARGED });
    f.state = out.state;
    API.tensionNote(f, now); // prompt build happens every turn
  }
  let humInZone = 0, zoneTurns = 0;
  while ((Number(f.state.tension) || 0) > 20) {
    now += 2 * HOUR; // separate mundane exchanges so decay ticks
    const out = API.applyStateDeltas(f, { comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] },
      { now, gapMs: 2 * HOUR, history: PLAIN });
    f.state = out.state;
    const t = Number(f.state.tension) || 0;
    if (t >= 24 && t < 30) { zoneTurns++; if (API.tensionNote(f, now) !== null) humInZone++; }
  }
  console.log(`  hum held on ${humInZone}/${zoneTurns} prompt builds inside the 24-30 zone (hysteresis: want all; pre-fix: 0)`);
}

/* ---- 6. attraction trickle arc (charged-context relationships still move) ---- */
console.log('\n[6] trickle arc: 30 days, one charged 3-exchange session/day, attraction 0-reported throughout');
{
  const f = mkFriend('tay');
  const start = f.state.attraction;
  let lastContact = T0 - 2 * HOUR;
  for (let d = 0; d < 30; d++) {
    for (let e = 0; e < 3; e++) {
      const now = T0 + d * DAY + e * 15 * 60000;
      const out = API.applyStateDeltas(f, { comfort_delta: 1, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, new_memories: [] },
        { now, gapMs: e === 0 ? now - lastContact : 15 * 60000, history: CHARGED });
      f.state = out.state;
      lastContact = now;
    }
  }
  console.log(`  attraction ${start}->${f.state.attraction} over 30 charged days (band traversal expected in both engines)`);
}
