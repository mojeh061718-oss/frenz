/* Item 7 — Samantha beats bank kid-content ratio.
   Classify all 12 beats (and the 8 textures) with a content-word list, per
   the plan's Phase-0 classifier prescription. The template's own rule
   (personas.js:218-221) says kid content must stay a MINORITY of the bank.
   Run: node audit-evidence/baseline/harness/07-sam-beats.js */
'use strict';
const { load } = require('./lib');
const { Personas } = load();

const t = Personas.byId('samantha');

// Content words that make a beat KID-LED: her children's names, the kids
// collectively, and kid-logistics vocabulary (practice/team/sitter/bedtime).
const KID_WORDS = /\b(kids?|cam|cam's|gunner|blaze|rocky|bedtime|sitter|practice|team|team-parents|milkshakes?|minivan|baby|toddler|newborn)\b/i;

function classify(bank, label) {
  console.log(`\n--- ${label} (${bank.length} entries) ---`);
  let kid = 0;
  bank.forEach((b, i) => {
    const m = b.match(KID_WORDS);
    const isKid = !!m;
    if (isKid) kid++;
    console.log(`  [${String(i).padStart(2)}] ${isKid ? 'KID  ' : 'other'} ${m ? '(' + m[0] + ')' : '     '}  ${b}`);
  });
  console.log(`${label} kid-content ratio: ${kid}/${bank.length} = ${(100 * kid / bank.length).toFixed(0)}%`);
  return kid;
}

classify(t.beats, 'beats');
classify(t.textures, 'textures');
console.log('\nauthored rule in the same template (personas.js:218-221): kid content must be a MINORITY of the bank.');
