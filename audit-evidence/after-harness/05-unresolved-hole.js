/* Item 5 — his-first-text unresolved hole.
   Friend with unresolved = {kind:'read', ts: 2 days ago}. HE texts first
   (non-opener path). unresolvedNote is referenced only at api.js:1106/1159/
   1188 (openerDue + openerNudge) — buildDynamicContext never emits it, and
   the life beat has no unresolved guard on this path (api.js:1820).
   Run: node audit-evidence/baseline/harness/05-unresolved-hole.js */
'use strict';
const { load, setNow, mkFriend, fixtureHistory, BASE, DAY, HOUR, MIN } = require('./lib');

const { API, Personas } = load();

// find a day where the beat die fires, so the "cheerful beat on an
// unresolved night" half is demonstrable too
let day = -1;
for (let d = 0; d < 10; d++) {
  setNow(API, BASE + d * DAY);
  if (API._lifeBeat(mkFriend(API, Personas, 'kelly', { createdAt: BASE - 20 * DAY }))) { day = d; break; }
}
const NOW = BASE + day * DAY;
setNow(API, NOW);

const friend = mkFriend(API, Personas, 'kelly', { createdAt: BASE - 20 * DAY });
friend.unresolved = { kind: 'read', ts: NOW - 2 * DAY };

console.log('unresolved on friend: ' + JSON.stringify(friend.unresolved));
console.log('unresolvedNote(friend) (the note the ENGINE has ready): ' +
  JSON.stringify(API.unresolvedNote(friend)).slice(0, 120) + '...');

// two days ago she read his message and did not answer → last real message
// is HIS, 2 days old; now he texts first again
const lastTs = NOW - 2 * DAY;
const history = fixtureHistory(39, lastTs);
history.push({ role: 'user', text: 'ok i get it. you went quiet on me. still. how was the week', ts: NOW - MIN });

const dynamic = API.buildDynamicContext(friend, lastTs, 0, history.length, [], null, history);

const MARKERS = [/unresolved/i, /did not answer/i, /deliberately/i, /on read/i, /went quiet/i, /reckon/i, /breeze past/i];
const hits = MARKERS.map(re => {
  const line = dynamic.split('\n').find(l => re.test(l));
  return { re: String(re), hit: !!line, line: line ? line.trim().slice(0, 110) : null };
});
console.log('\n--- grep of the assembled dynamic block for any unresolved mention ---');
for (const h of hits) console.log(`  ${h.re}  ->  ${h.hit ? 'FOUND: ' + h.line : 'not present'}`);
const any = hits.some(h => h.hit && !/went quiet/.test(h.line || ''));  // his own words excluded
console.log('unresolved note present anywhere in dynamic block: ' + any);

const beat = API._lifeBeat(friend);
console.log('\nlife beat fired on this unresolved night: ' + !!beat);
if (beat) {
  const di = dynamic.indexOf(beat);
  console.log('beat line in dynamic block: ' + (di >= 0));
  console.log('...' + dynamic.slice(Math.max(0, di - 55), di + beat.length + 20) + '...');
}
console.log('\ngap note actually emitted (the ONLY acknowledgment of the 2-day silence):');
const gapLine = dynamic.split('\n').find(l => /It has been about/.test(l));
console.log('  ' + (gapLine || '(none)').trim());
