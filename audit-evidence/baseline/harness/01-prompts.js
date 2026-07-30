/* Item 1 — full assembled prompt per persona (all five), rich tier, at a
   representative mid-relationship state: real app.js:281-283 seeding + 40
   exchanged messages of neutral fixture history. Saves each prompt verbatim
   to ../prompts/<name>.txt with per-block char counts.
   Run: node audit-evidence/baseline/harness/01-prompts.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { load, setNow, mkFriend, fixtureHistory, assemble, BASE, DAY, MIN } = require('./lib');

const OUT = path.resolve(__dirname, '../prompts');
const { API, Personas } = load();
setNow(API, BASE);

const ORDER = ['persona', 'dynamic', 'plist', 'phi', 'recap', 'instr'];

for (const id of ['kelly', 'bre', 'anna', 'samantha', 'tay']) {
  const friend = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY });
  const history = fixtureHistory(40, BASE - 30 * MIN);
  const lastTs = history[history.length - 2].ts;  // ts before his live message
  const blocks = assemble(API, friend, history, lastTs, 'rich', true);

  const counts = ORDER.map(k => `${k}=${blocks[k].length}`).join('  ');
  const total = ORDER.reduce((s, k) => s + blocks[k].length, 0);
  console.log(`${id.padEnd(9)} ${counts}  TOTAL=${total}`);

  const parts = ORDER.map(k =>
    `=========== BLOCK: ${k} (${blocks[k].length} chars) ===========\n${blocks[k]}`);
  const header = [
    `frenz backup/v10.23 assembled prompt — ${id} — tier=rich — BEFORE-audit baseline`,
    `Seed state (app.js:281-283): comfort=${friend.state.comfort} closeness=${friend.state.closeness} attraction=${friend.state.attraction}`,
    `exchangedCount=40 neutral fixture messages; createdAt=now-20d; last message 30min ago; clock=${new Date(BASE).toString()}`,
    `Char counts: ${counts}  TOTAL=${total}`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(OUT, id + '.txt'), header + '\n' + parts.join('\n\n') + '\n');
}
console.log('\nwrote audit-evidence/baseline/prompts/{kelly,bre,anna,samantha,tay}.txt');
