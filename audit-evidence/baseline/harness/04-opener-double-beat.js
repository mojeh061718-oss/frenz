/* Item 4 — opener-run double-beat.
   Same friend, same day: app.js's opener flow builds openerNudge (which
   embeds _lifeBeat, api.js:1213-1216) and then _buildPlainRequest builds
   buildDynamicContext (which embeds _lifeBeat again, api.js:1820-1821).
   _bankPick is deterministic per (friend, day), so both calls return the
   SAME beat and the identical string ships twice in one request.
   Run: node audit-evidence/baseline/harness/04-opener-double-beat.js */
'use strict';
const { load, setNow, mkFriend, fixtureHistory, BASE, DAY, HOUR } = require('./lib');

const { API, Personas } = load();

// scan forward from BASE for the first day Kelly's beat die fires (45%/day)
let day = -1;
for (let d = 0; d < 10; d++) {
  setNow(API, BASE + d * DAY);
  const probe = mkFriend(API, Personas, 'kelly', { createdAt: BASE - 20 * DAY });
  if (API._lifeBeat(probe)) { day = d; break; }
}
const NOW = BASE + day * DAY;
setNow(API, NOW);
console.log(`beat die fires for kelly-1 on BASE+${day}d (${new Date(NOW).toString()})`);

const friend = mkFriend(API, Personas, 'kelly', { createdAt: BASE - 20 * DAY });
const lastTs = NOW - 30 * HOUR;                       // 30h silence — opener territory
const history = fixtureHistory(39, lastTs);           // ends on her message → he never answered? no: ends U
// make her the last speaker (opener run, not a double-text: append her line)
history.push({ role: 'assistant', text: 'anyway. tell me tomorrow', ts: lastTs + 60000 });

// --- exactly the app's opener sequence ---
const gapMs = API._now() - (lastTs + 60000);
const nudge = API.openerNudge(gapMs, true, friend);
const histWithNudge = history.concat([{ role: 'user', text: nudge, ts: API._now() }]);
const dynamic = API.buildDynamicContext(friend, lastTs + 60000, 0, history.length, [], null, histWithNudge);

const beat = API._lifeBeat(friend);   // same-day repeat call returns the same pick
console.log('\ntoday\'s beat: ' + JSON.stringify(beat));
console.log('\nbeat in openerNudge:          ' + nudge.includes(beat));
console.log('beat in buildDynamicContext:  ' + dynamic.includes(beat));

const nLine = nudge.split(/(?<=\.)\s(?=If you want material)/).find(x => x.includes(beat)) || '';
console.log('\n--- nudge excerpt ---');
const ni = nudge.indexOf(beat);
console.log('...' + nudge.slice(Math.max(0, ni - 60), ni + beat.length + 80) + '...');
console.log('\n--- dynamic block excerpt ---');
const di = dynamic.indexOf(beat);
console.log('...' + dynamic.slice(Math.max(0, di - 60), di + beat.length + 80) + '...');
console.log('\nIDENTICAL beat string in both blocks of one request: ' + (nudge.includes(beat) && dynamic.includes(beat)));
