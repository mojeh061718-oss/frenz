/* Item 6 — Anna example-bank routing.
   Her style is "Sentence case… Punctuation mostly correct…" but the router
   (_STYLE_PUNCTUATED, api.js:202) matches neither phrase, so _exampleBank
   falls through to the lowercase default bank (api.js:207).
   Run: node audit-evidence/baseline/harness/06-anna-bank.js */
'use strict';
const { load, setNow, mkFriend, BASE, DAY } = require('./lib');

const { API, Personas } = load();
setNow(API, BASE);

const friend = mkFriend(API, Personas, 'anna', { createdAt: BASE - 20 * DAY });
const style = friend.profile.style;
console.log('Anna style field (as seeded):\n  ' + JSON.stringify(style));
console.log('\n_STYLE_LOWERCASE.test(style)  = ' + API._STYLE_LOWERCASE.test(style) + '   (' + API._STYLE_LOWERCASE + ')');
console.log('_STYLE_PUNCTUATED.test(style) = ' + API._STYLE_PUNCTUATED.test(style) + '   (' + API._STYLE_PUNCTUATED + ')');

const bank = API._exampleBank(style);
const which = bank === API._EXAMPLES ? '_EXAMPLES (the LOWERCASE bank — default fall-through)'
  : bank === API._EXAMPLES_PUNCTUATED ? '_EXAMPLES_PUNCTUATED (the sentence-case bank)'
    : '(unknown)';
console.log('\n_exampleBank(annaStyle) returned: ' + which);
console.log('\nfirst two examples of the returned bank, verbatim:');
console.log('  [0] ' + bank[0]);
console.log('  [1] ' + bank[1]);
console.log('\nexamples actually shipped in her rich-tier persona (_exampleSetFor):');
for (const ex of API._exampleSetFor(friend.id, 'rich', style)) console.log('  - ' + ex);
