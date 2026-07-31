/* Item 10 — rule-mass numbers.
   - persona block chars per persona per tier (full/rich/compact)
   - rules-vs-character split (character = "## Who you are" + "## The people
     around you" sections; everything else in the persona block = rules)
   - "never" counts (persona block and full assembled prompt)
   - phi static fraction over 40 sends (distinct strings + byte-identical
     prefix share); plist static fraction over 30 days.
   Run: node audit-evidence/baseline/harness/10-rulemass.js */
'use strict';
const { load, setNow, mkFriend, fixtureHistory, assemble, BASE, DAY, MIN } = require('./lib');

const { API, Personas } = load();
setNow(API, BASE);
const IDS = ['kelly', 'bre', 'anna', 'samantha', 'tay'];

function sections(persona) {
  // split into '## '-headed sections; the preamble (first two lines) counts as rules
  const idx = [];
  const re = /^## .*$/gm;
  let m;
  while ((m = re.exec(persona))) idx.push({ at: m.index, title: m[0] });
  const out = [];
  for (let i = 0; i < idx.length; i++) {
    const end = i + 1 < idx.length ? idx[i + 1].at : persona.length;
    out.push({ title: idx[i].title, text: persona.slice(idx[i].at, end) });
  }
  return out;
}

console.log('=== persona block chars per tier + rules/character split ===');
for (const id of IDS) {
  const friend = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY });
  const row = [id.padEnd(9)];
  for (const tier of ['full', 'rich', 'compact']) {
    row.push(`${tier}=${API.buildPersona(friend, tier).length}`);
  }
  const persona = API.buildPersona(friend, 'rich');
  const secs = sections(persona);
  const isChar = t => /^## Who you are|^## The people around you/.test(t);
  const charChars = secs.filter(s => isChar(s.title)).reduce((a, s) => a + s.text.length, 0);
  const total = persona.length;
  const rules = total - charChars;
  row.push(`| rich split: character=${charChars} rules=${rules} (${(100 * rules / total).toFixed(1)}% rules)`);
  console.log('  ' + row.join('  '));
}

console.log('\n=== "How you text" style line (also arguably character) — counted separately ===');
for (const id of IDS) {
  const friend = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY });
  const persona = API.buildPersona(friend, 'rich');
  const styleLine = persona.split('\n').find(l => l.startsWith('Your texting style: ')) || '';
  console.log(`  ${id.padEnd(9)} style line = ${styleLine.length} chars`);
}

console.log('\n=== "never" counts ===');
for (const id of IDS) {
  const friend = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY });
  const history = fixtureHistory(40, BASE - 30 * MIN);
  const blocks = assemble(API, friend, history, history[history.length - 2].ts, 'rich', true);
  const personaN = (blocks.persona.match(/\bnever\b/gi) || []).length;
  const full = ['persona', 'dynamic', 'plist', 'phi', 'recap', 'instr'].map(k => blocks[k]).join('\n');
  const fullN = (full.match(/\bnever\b/gi) || []).length;
  const negations = (full.match(/\b(never|no\b|not\b|don't|doesn't|nothing|nobody|none)\b/gi) || []).length;
  console.log(`  ${id.padEnd(9)} persona "never"=${personaN}   assembled prompt "never"=${fullN}   assembled never/no/not/... negations=${negations}`);
}

console.log('\n=== phi static fraction over 40 sends (history.length 2..80 step 2) ===');
function lcpLen(strs) {
  let p = strs[0];
  for (const s of strs) { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); }
  return p.length;
}
function lcsuffLen(strs) {
  let p = strs[0];
  for (const s of strs) {
    let i = 0;
    while (i < p.length && i < s.length && p[p.length - 1 - i] === s[s.length - 1 - i]) i++;
    p = p.slice(p.length - i);
  }
  return p.length;
}
for (const id of IDS) {
  const friend = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY });
  const phis = [];
  for (let turn = 2; turn <= 80; turn += 2) {
    API._witLicensed = true;   // the normal case: buildDynamicContext licenses wit whenever no release night
    phis.push(API._phi(friend, true, turn, [], ''));
  }
  const distinct = new Set(phis).size;
  const avg = phis.reduce((a, s) => a + s.length, 0) / phis.length;
  const lcp = lcpLen(phis), lcs = lcsuffLen(phis);
  console.log(`  ${id.padEnd(9)} distinct phi strings over 40 sends: ${distinct}; ` +
    `byte-identical prefix ${lcp} chars (${(100 * lcp / avg).toFixed(1)}% of avg ${avg.toFixed(0)}); prefix+suffix static ${(100 * (lcp + lcs) / avg).toFixed(1)}%`);
}

console.log('\n=== plist static fraction over 30 days ===');
for (const id of IDS) {
  const friend = mkFriend(API, Personas, id, { createdAt: BASE - 20 * DAY });
  const ps = [];
  for (let d = 0; d < 30; d++) {
    setNow(API, BASE + d * DAY);
    ps.push(API._plist(friend));
  }
  const distinct = new Set(ps).size;
  const avg = ps.reduce((a, s) => a + s.length, 0) / ps.length;
  const lcp = lcpLen(ps), lcs = lcsuffLen(ps);
  console.log(`  ${id.padEnd(9)} distinct plists over 30 days: ${distinct}; static prefix+suffix = ${lcp}+${lcs} chars = ${(100 * (lcp + lcs) / avg).toFixed(1)}% of avg ${avg.toFixed(0)}`);
}
setNow(API, BASE);
