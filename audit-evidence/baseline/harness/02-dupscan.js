/* Item 2 — cross-block duplicate scan.
   (a) normalized content-word 4-grams present in >1 block of one assembled
       prompt, per persona (same assembly as 01-prompts.js);
   (b) known case: opinion_notes verbatim in dynamic AND plist;
   (c) known case: Samantha founding-fact occurrence count across all
       channels at exchangedCount 8 with opening act live + unsaidSeed +
       seeded opinion (plan claims 10 — this measures it);
   (d) known case: _BAND_GLOSS vs _BAND_TEXT verbatim-substring check.
   Run: node audit-evidence/baseline/harness/02-dupscan.js */
'use strict';
const { load, setNow, mkFriend, fixtureHistory, assemble, grams4, BASE, DAY, MIN } = require('./lib');

const { API, Personas } = load();
setNow(API, BASE);

const ORDER = ['persona', 'dynamic', 'plist', 'phi', 'recap', 'instr'];

console.log('=== (a) content-word 4-grams appearing in >1 block of one assembled prompt ===');
for (const id of ['kelly', 'bre', 'anna', 'samantha', 'tay']) {
  const friend = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY });
  const history = fixtureHistory(40, BASE - 30 * MIN);
  const blocks = assemble(API, friend, history, history[history.length - 2].ts, 'rich', true);
  const sets = {};
  for (const k of ORDER) sets[k] = grams4(blocks[k]);
  const hits = new Map();   // gram -> [blocks]
  for (let i = 0; i < ORDER.length; i++) {
    for (let j = i + 1; j < ORDER.length; j++) {
      for (const g of sets[ORDER[i]]) {
        if (sets[ORDER[j]].has(g)) {
          if (!hits.has(g)) hits.set(g, new Set());
          hits.get(g).add(ORDER[i]); hits.get(g).add(ORDER[j]);
        }
      }
    }
  }
  console.log(`\n--- ${id}: ${hits.size} distinct duplicated 4-grams across blocks ---`);
  // group by block-pair signature for readability
  const byPair = {};
  for (const [g, bs] of hits) {
    const key = [...bs].sort().join('+');
    (byPair[key] = byPair[key] || []).push(g);
  }
  for (const key of Object.keys(byPair).sort()) {
    console.log(`  [${key}] ${byPair[key].length} grams:`);
    for (const g of byPair[key]) console.log(`     "${g}"`);
  }
}

console.log('\n=== (b) opinion_notes shipped verbatim in dynamic AND plist ===');
{
  const friend = mkFriend(API, Personas, 'kelly', { createdAt: BASE - 20 * DAY });
  const history = fixtureHistory(40, BASE - 30 * MIN);
  const blocks = assemble(API, friend, history, history[history.length - 2].ts, 'rich', true);
  const op = friend.state.opinion_notes;
  console.log('opinion_notes (seeded, nonempty): ' + JSON.stringify(op));
  console.log('verbatim in dynamic block: ' + blocks.dynamic.includes(op));
  console.log('verbatim in plist block:   ' + blocks.plist.includes(op));
  console.log('dynamic line: ' + (blocks.dynamic.split('\n').find(l => l.includes(op.slice(0, 40))) || '(none)').trim());
  console.log('plist line:   ' + (blocks.plist.split('\n').find(l => l.includes(op.slice(0, 40))) || '(none)').trim());
}

console.log('\n=== (c) Samantha founding-fact occurrences, exchangedCount=8, opening act LIVE ===');
{
  // fresh scenario: created 2 days ago, 8 messages exchanged, last message
  // 30 min ago. unsaidSeed + seeded opinion ride; opening act live (8 < 40).
  const friend = mkFriend(API, Personas, 'samantha', { createdAt: BASE - 2 * DAY });
  const history = fixtureHistory(8, BASE - 30 * MIN);
  const blocks = assemble(API, friend, history, history[history.length - 2].ts, 'rich', true);
  const RE = /walk(?:ed|s)? in(?:to)?\b|walk-?in|saw everything|what he saw|what he thought when he saw|five (?:whole )?seconds|(?:didn't|did not) stop|held (?:your|his|my|eye)[^.\n]{0,20}eyes?|looked right at him|caught samantha|caught (?:her|you) mid|deep in (?:her|your) own private moment|alone.?time.{0,15}couch|mid-'alone time'/gi;
  let total = 0;
  for (const k of ORDER) {
    const text = blocks[k];
    const lines = text.split('\n');
    for (const line of lines) {
      const ms = line.match(RE);
      if (ms) {
        total += ms.length;
        console.log(`  [${k}] ${ms.length}x ${JSON.stringify(ms)} :: ${line.trim().slice(0, 150)}`);
      }
    }
  }
  console.log(`TOTAL founding-fact marker hits across the assembled prompt: ${total}`);
  // channel-level count: how many distinct prompt locations RESTATE the event
  console.log('(each printed line above is one location; count of lines = distinct channels)');
}

console.log('\n=== (d) _BAND_GLOSS vs _BAND_TEXT verbatim-substring check ===');
{
  for (const stat of ['comfort', 'closeness', 'attraction']) {
    for (const band of ['low', 'building', 'high', 'deep']) {
      const gloss = API._BAND_GLOSS[stat][band];
      const full = API._BAND_TEXT[stat][band];
      const sub = full.includes(gloss);
      console.log(`  ${stat}/${band}: gloss ${sub ? 'IS a verbatim substring' : 'differs'} of band text` +
        (sub ? `  ("${gloss}")` : ''));
    }
  }
}
