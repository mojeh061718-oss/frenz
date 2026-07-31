/* Item 9 — 30-day applyStateDeltas traversal from each persona's REAL seed.
   (a) one positive session per day: raw deltas +2/+2/+1 (comfort/closeness/
       attraction), confidence 0.9 — day-by-day stat/band table. Run twice:
       with the neutral fixture history (romanceOk=false) and with a lightly
       charged history (romanceOk=true), because the attraction gate is part
       of the measured truth.
   (b) then 14 days of silence: applyAbsenceDrift as the app calls it (once,
       with the real gap) — drift table per gap length; closeness/attraction
       expected frozen — measured.
   (c) the humming wipe: cross tension past HUM_MIN via the engine, confirm
       state.humming, apply one mundane turn, report whether it survived.
   Run: node audit-evidence/baseline/harness/09-state-30day.js */
'use strict';
const { load, setNow, mkFriend, BASE, DAY, HOUR } = require('./lib');

const { API, Personas } = load();
const IDS = ['kelly', 'bre', 'anna', 'samantha', 'tay'];

const NEUTRAL_HIST = [
  { role: 'assistant', text: 'the printer saga continues' },
  { role: 'user', text: 'the meeting ran long today so i just got home' }
];
const CHARGED_HIST = [
  { role: 'assistant', text: 'well that took a turn' },
  { role: 'user', text: 'honestly i keep thinking about you more than i should' }
];

function runDaily(id, hist, label) {
  setNow(API, BASE);
  const f = mkFriend(API, Personas, id, { createdAt: BASE - 1 * DAY });
  console.log(`\n--- ${id} (${label}) seed c/cl/a = ${f.state.comfort}/${f.state.closeness}/${f.state.attraction} ---`);
  console.log('  day | comfort  closeness  attraction  tension | bands');
  const bands0 = API.bandsFor(f);
  console.log(`  seed| ${String(f.state.comfort).padStart(7)}  ${String(f.state.closeness).padStart(9)}  ${String(f.state.attraction).padStart(10)}  ${String(f.state.tension || 0).padStart(7)} | ${bands0.comfort}/${bands0.closeness}/${bands0.attraction}`);
  for (let d = 1; d <= 30; d++) {
    const now = BASE + d * DAY;
    setNow(API, now);
    const out = API.applyStateDeltas(f,
      { mood: 'good night', comfort_delta: 2, closeness_delta: 2, attraction_delta: 1, confidence: 0.9, opinion_notes: '', unsaid: '' },
      { history: hist, gapMs: 24 * 3600000, now });
    f.state = out.state;                          // exactly app.js:1271
    if (d <= 5 || d % 5 === 0) {
      const b = API.bandsFor(f);
      console.log(`  ${String(d).padStart(4)}| ${String(f.state.comfort).padStart(7)}  ${String(f.state.closeness).padStart(9)}  ${String(f.state.attraction).padStart(10)}  ${String(f.state.tension).padStart(7)} | ${b.comfort}/${b.closeness}/${b.attraction}`);
    }
  }
  return f;
}

console.log('=== (a) 30 daily positive sessions (+2/+2/+1 @ conf 0.9), one applyStateDeltas per day ===');
const after30 = {};
for (const id of IDS) after30[id] = runDaily(id, NEUTRAL_HIST, 'neutral history');
console.log('\n=== (a2) same protocol, charged history ("i keep thinking about you...") — the romanceOk gate opens ===');
const after30c = {};
for (const id of IDS) after30c[id] = runDaily(id, CHARGED_HIST, 'charged history');

console.log('\n=== (b) then silence: applyAbsenceDrift at increasing gap (applied to a fresh copy of the day-30 charged state each time) ===');
for (const id of IDS) {
  const src = after30c[id];
  console.log(`--- ${id} from day-30 state c/cl/a/t = ${src.state.comfort}/${src.state.closeness}/${src.state.attraction}/${src.state.tension} (floors ${JSON.stringify(src.state.floors)}) ---`);
  console.log('  gap(days) | comfort Δ | closeness Δ | attraction Δ | tension after');
  for (const gd of [2, 4, 6, 8, 10, 12, 14]) {
    const f = JSON.parse(JSON.stringify(src));
    setNow(API, BASE + (30 + gd) * DAY);
    const before = Object.assign({}, f.state);
    API.applyAbsenceDrift(f, gd * DAY);
    console.log(`  ${String(gd).padStart(8)} | ${String(f.state.comfort - before.comfort).padStart(8)} | ${String(f.state.closeness - before.closeness).padStart(10)} | ${String(f.state.attraction - before.attraction).padStart(11)} | ${f.state.tension}  (comfort ${before.comfort}→${f.state.comfort})`);
  }
}

console.log('\n=== (c) the humming wipe ===');
{
  // Kelly: type friend but flirtiness 85 → full-rate tension build.
  setNow(API, BASE);
  const f = mkFriend(API, Personas, 'kelly', { createdAt: BASE - 20 * DAY });
  f.state.attraction = 30;   // reachable state; irrelevant to the hum flag itself
  let turn = 0;
  while ((Number(f.state.tension) || 0) < 30 && turn < 40) {
    turn++;
    const now = BASE + turn * 2 * HOUR;   // >90min gaps: decay branch avoided per turn? no — gap>90min means NOT midBurst, but charged build dominates
    setNow(API, now);
    const out = API.applyStateDeltas(f,
      { mood: 'buzzing', comfort_delta: 1, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, opinion_notes: '', unsaid: '' },
      { history: CHARGED_HIST, gapMs: 2 * 3600000, now });
    f.state = out.state;
  }
  console.log(`tension after ${turn} charged turns (via the engine): ${f.state.tension}`);
  // the dynamic block runs tensionNote every build — this is what sets humming
  let note = API.tensionNote(f, API._now());
  console.log('tensionNote fired the hum: ' + JSON.stringify((note || ['(none)'])[0]));
  console.log('state.humming after tensionNote: ' + f.state.humming);

  // now mundane turns walk tension down toward 27: DECAY is -1 per mundane turn
  let mundane = 0;
  while (f.state.tension > 27 && mundane < 10) {
    mundane++;
    const now = BASE + (turn + mundane) * 3 * HOUR;
    setNow(API, now);
    const hummingBefore = f.state.humming;
    const out = API.applyStateDeltas(f,
      { mood: 'fine', comfort_delta: 0, closeness_delta: 0, attraction_delta: 0, confidence: 0.9, opinion_notes: '', unsaid: '' },
      { history: NEUTRAL_HIST, gapMs: 3 * 3600000, now });
    f.state = out.state;                          // app.js:1271 — whole-state replace
    console.log(`mundane turn ${mundane}: tension ${f.state.tension}; humming before turn=${hummingBefore} after turn=${f.state.humming}`);
  }
  console.log(`\nfinal: tension=${f.state.tension} (>= hysteresis floor 24, so the hum SHOULD persist)`);
  console.log('state.humming survived applyStateDeltas: ' + (f.state.humming !== undefined ? f.state.humming : 'NO — key absent (wiped: applyStateDeltas rebuilds state without copying it, api.js:1504-1608)'));
  const note2 = API.tensionNote(f, API._now());
  console.log('tensionNote now returns: ' + (note2 ? JSON.stringify(note2[0]) : 'null — the hum section is GONE despite tension ' + f.state.tension + ' >= 24'));
}
