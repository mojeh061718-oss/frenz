/* Item 3 — mood contradiction reproduction.
   Bre, state.mood = "a few drinks in and lonely" (her template seed mood),
   last message 100h ago. The dynamic block routes mood through _freshMood
   (api.js:1782); the plist reads raw s.mood (api.js:1963). Dump both.
   Run: node audit-evidence/baseline/harness/03-mood.js */
'use strict';
const { load, setNow, mkFriend, fixtureHistory, BASE, DAY, HOUR } = require('./lib');

const { API, Personas } = load();
setNow(API, BASE);

const friend = mkFriend(API, Personas, 'bre', { createdAt: BASE - 20 * DAY });
console.log('state.mood (raw, as stored): ' + JSON.stringify(friend.state.mood));

// history ended 100 hours ago; he texts now (his-first-text after the gap)
const lastTs = BASE - 100 * HOUR;
const history = fixtureHistory(39, lastTs);                       // old thread
history.push({ role: 'user', text: 'the meeting ran long today so i just got home', ts: BASE - 60000 });

const dynamic = API.buildDynamicContext(friend, lastTs, 0, history.length, [], null, history);
const plist = API._plist(friend);

const dynMood = dynamic.split('\n').find(l => /"mood"/.test(l));
const plMood = (plist.match(/Mood: [^;]*/) || ['(none)'])[0];

console.log('\n--- side by side, same assembled prompt, 100h after her last message ---');
console.log('dynamic block state JSON : ' + dynMood.trim());
console.log('depth-4 plist            : ' + plMood);
console.log('\n_freshMood(friend, lastTs, 39) = ' + JSON.stringify(API._freshMood(friend, lastTs, 39)));
console.log('plist reads raw s.mood         = ' + JSON.stringify(friend.state.mood));
console.log('\ncontradiction present: ' + (dynMood.includes(friend.state.mood) ? 'NO' : 'YES — the two copies disagree'));
