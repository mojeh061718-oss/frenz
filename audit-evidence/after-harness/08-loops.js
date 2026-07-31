/* Item 8 — 30-day dice loops via addTimeOffset / pinned _timeOffset.
   The engine's dice are all deterministic hashes of (friend.id | dayKey),
   so a single 30-day run per seeded friend id is exact; RATES are estimated
   over 200 trials by varying the friend id (sampling the same hash space).
   Math.random is not used by any of these systems (only selectMemories
   jitter, pinned via API._rand).
   Run: node audit-evidence/baseline/harness/08-loops.js */
'use strict';
const { load, setNow, mkFriend, BASE, DAY } = require('./lib');

const { API, Personas } = load();
const IDS = ['kelly', 'bre', 'anna', 'samantha', 'tay'];
const DAYS = 30, TRIALS = 200;

/* ---- (a) life beats: fire rate + 21-day-window repeats ---- */
console.log('=== (a) life beats — 30 days, daily 20:00 roll, one persisted friend each ===');
for (const id of IDS) {
  setNow(API, BASE);
  const f = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY });
  const fired = [];   // {day, idx}
  for (let d = 0; d < DAYS; d++) {
    setNow(API, BASE + d * DAY);
    const beat = API._lifeBeat(f);
    if (beat) fired.push({ day: d, idx: f.profile.beats.indexOf(beat) });
  }
  let repeats = 0;
  for (let i = 0; i < fired.length; i++)
    for (let j = i + 1; j < fired.length; j++)
      if (fired[i].idx === fired[j].idx && fired[j].day - fired[i].day < 21) repeats++;
  console.log(`  ${id.padEnd(9)} fired ${String(fired.length).padStart(2)}/30 days (${(100 * fired.length / 30).toFixed(0)}%), ` +
    `repeats inside 21 days: ${repeats}  [days: ${fired.map(x => x.day).join(',')}]`);
}
console.log('  -- 200-trial rate (fresh friend per trial, ids <tpl>-t<i>) --');
for (const id of IDS) {
  let fires = 0, repeats = 0;
  for (let t = 0; t < TRIALS; t++) {
    setNow(API, BASE);
    const f = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY, id: `${id}-t${t}` });
    const fired = [];
    for (let d = 0; d < DAYS; d++) {
      setNow(API, BASE + d * DAY);
      const beat = API._lifeBeat(f);
      if (beat) { fires++; fired.push({ day: d, idx: f.profile.beats.indexOf(beat) }); }
    }
    for (let i = 0; i < fired.length; i++)
      for (let j = i + 1; j < fired.length; j++)
        if (fired[i].idx === fired[j].idx && fired[j].day - fired[i].day < 21) repeats++;
  }
  console.log(`  ${id.padEnd(9)} fire rate ${(100 * fires / (TRIALS * DAYS)).toFixed(1)}% of days (${fires}/${TRIALS * DAYS}), 21-day repeats across all trials: ${repeats}`);
}

/* ---- (b) depth-4 interests-slice rotation coverage ---- */
console.log('\n=== (b) depth-4 interests slice — 30 days of _plist per persona ===');
for (const id of IDS) {
  const f0 = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY });
  const nSent = (f0.profile.interests || '').split(/(?<=[.!])\s+/).filter(Boolean).length;
  const slices = new Set();
  for (let d = 0; d < DAYS; d++) {
    setNow(API, BASE + d * DAY);
    const m = API._plist(f0).match(/Your life right now[^:]*: ([^;]*)/);
    slices.add(m ? m[1] : '(none)');
  }
  console.log(`  ${id.padEnd(9)} interests sentences=${nSent}; distinct slices over 30 days=${slices.size} (coverage ${slices.size}/${nSent})`);
}

/* ---- (c) opener due rate, 3am vs evening, at seed state ---- */
console.log('\n=== (c) openerDue at seed state — last message 8h earlier (his), fresh friend each day ===');
console.log('   (deterministic 30-day count on <tpl>-1, then 200-trial rate)');
for (const id of IDS) {
  const counts = { night: 0, evening: 0 };
  for (let d = 0; d < DAYS; d++) {
    for (const [label, hour] of [['night', 3], ['evening', 20]]) {
      const now = BASE + d * DAY + (hour - 20) * 3600000;
      setNow(API, now);
      const f = mkFriend(API, Personas, id, { createdAt: now - 20 * DAY });
      const msgs = [{ role: 'user', text: 'ok talk later', ts: now - 8 * 3600000 }];
      if (API.openerDue(f, msgs, now)) counts[label]++;
    }
  }
  const nn = (() => { setNow(API, BASE); return API._nightNorm(mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY })); })();
  console.log(`  ${id.padEnd(9)} 3am due ${String(counts.night).padStart(2)}/30, evening(20:00) due ${String(counts.evening).padStart(2)}/30   [_nightNorm: score=${nn.score.toFixed(1)} tier=${nn.tier}]`);
}
for (const id of IDS) {
  let night = 0, evening = 0, n = 0;
  for (let t = 0; t < TRIALS; t++) {
    for (let d = 0; d < 5; d++) {   // 200 trials x 5 days = 1000 rolls per hour slot
      for (const [label, hour] of [['night', 3], ['evening', 20]]) {
        const now = BASE + d * DAY + (hour - 20) * 3600000;
        setNow(API, now);
        const f = mkFriend(API, Personas, id, { createdAt: now - 20 * DAY, id: `${id}-t${t}` });
        const msgs = [{ role: 'user', text: 'ok talk later', ts: now - 8 * 3600000 }];
        const due = API.openerDue(f, msgs, now);
        if (label === 'night' && due) night++;
        if (label === 'evening' && due) evening++;
      }
      n++;
    }
  }
  console.log(`  ${id.padEnd(9)} 200x5 rolls: 3am ${(100 * night / 1000).toFixed(1)}%  evening ${(100 * evening / 1000).toFixed(1)}%`);
}

/* ---- (d) textures: fire rate + 8-day repeats ---- */
console.log('\n=== (d) textures — 30 evenings (20:00), one persisted friend each ===');
for (const id of IDS) {
  setNow(API, BASE);
  const f = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY });
  const fired = [];
  for (let d = 0; d < DAYS; d++) {
    setNow(API, BASE + d * DAY);
    const tx = API._lifeTexture(f);
    if (tx) fired.push({ day: d, idx: f.profile.textures.indexOf(tx) });
  }
  let repeats = 0;
  for (let i = 0; i < fired.length; i++)
    for (let j = i + 1; j < fired.length; j++)
      if (fired[i].idx === fired[j].idx && fired[j].day - fired[i].day < 8) repeats++;
  console.log(`  ${id.padEnd(9)} fired ${String(fired.length).padStart(2)}/30 evenings (${(100 * fired.length / 30).toFixed(0)}%), repeats inside 8 days: ${repeats}`);
}
console.log('  -- 200-trial texture rate --');
for (const id of IDS) {
  let fires = 0, repeats = 0;
  for (let t = 0; t < TRIALS; t++) {
    setNow(API, BASE);
    const f = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY, id: `${id}-t${t}` });
    const fired = [];
    for (let d = 0; d < DAYS; d++) {
      setNow(API, BASE + d * DAY);
      const tx = API._lifeTexture(f);
      if (tx) { fires++; fired.push({ day: d, idx: f.profile.textures.indexOf(tx) }); }
    }
    for (let i = 0; i < fired.length; i++)
      for (let j = i + 1; j < fired.length; j++)
        if (fired[i].idx === fired[j].idx && fired[j].day - fired[i].day < 8) repeats++;
  }
  console.log(`  ${id.padEnd(9)} fire rate ${(100 * fires / (TRIALS * DAYS)).toFixed(1)}% of evenings, 8-day repeats across all trials: ${repeats}`);
}
