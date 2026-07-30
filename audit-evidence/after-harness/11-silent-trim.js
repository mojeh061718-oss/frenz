/* Item 11 — silent-trim reproduction (api.js:3354-3368 in the backup copy).
   The dynamic block bakes its "(About N earlier messages aren't shown...)"
   disclosure from `omitted` BEFORE the final safety trim runs. When the
   packing loop kept everything (omitted == 0) but the finished request still
   overflows the budget, the final trim drops history anyway — returned
   `omitted` > 0 while the prompt discloses nothing.
   Setup: budget small enough that overhead alone exceeds budgetChars (room
   floors at 1000, so a short history is kept in full → omitted=0), then the
   final while-loop fires.
   Run: node audit-evidence/baseline/harness/11-silent-trim.js */
'use strict';
const { load, setNow, mkFriend, fixtureHistory, BASE, DAY, MIN } = require('./lib');

const { API, Personas } = load();
setNow(API, BASE);

const friend = mkFriend(API, Personas, 'kelly', { createdAt: BASE - 20 * DAY });
// 13 messages, starting on a USER turn (so the window's start-alignment
// shift drops nothing) and ~860 chars incl. packing overhead — under the
// packing loop's 1000-char floor, so the pre-trim `omitted` is exactly 0.
const history = fixtureHistory(13, BASE - 30 * MIN);
const lastTs = history[history.length - 2].ts;

// entry: hand-lowered budget (the code comment itself says this path "stays
// only so a hand-lowered budget degrades instead of overflowing")
const entry = { kind: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-4', apiKey: 'k', contextTokens: 6200 };
const budgetChars = API._effectiveBudget(entry) * 4;
console.log('budgetTokens=' + API._effectiveBudget(entry) + '  budgetChars=' + budgetChars);

const req = API._buildPlainRequest(entry, friend, history, lastTs, API._jsonInstruction(), true);

const total = req.system.length + req.messages.reduce((s, m) => s + m.content.length, 0);
console.log('history messages in: ' + history.length);
const histKept = req.messages.filter(m => !m.content.startsWith('[') && !m.content.startsWith('<system-reminder') && !/^## Your current private state/m.test(m.content)).length;
console.log('history messages surviving in request: ' + histKept);
console.log('final request chars: ' + total + ' (budget ' + budgetChars + ')');
console.log('\nreturned req.omitted = ' + req.omitted + '  <-- the ledger will record this');

const dynMsg = req.messages.find(m => /## Your current private state/.test(m.content));
const disclosure = dynMsg.content.split('\n').filter(l => /aren't shown|earlier messages/.test(l));
console.log('disclosure line in the shipped dynamic block: ' + (disclosure.length ? JSON.stringify(disclosure) : 'NONE — the prompt says nothing was omitted'));
const claims = dynMsg.content.match(/\(About \d+ earlier messages[^)]*\)/);
console.log('prompt claims omitted = ' + (claims ? claims[0] : '0 (no disclosure line at all)'));
console.log('\nMISMATCH (silent trim): returned omitted=' + req.omitted + ' vs prompt disclosure=' + (claims ? claims[0] : 'none') +
  '  -> ' + (req.omitted > 0 && !claims ? 'REPRODUCED' : 'not reproduced with this setup'));

// sanity control: same call at a roomy budget — no trim, no mismatch
const entry2 = Object.assign({}, entry, { contextTokens: 200000 });
const req2 = API._buildPlainRequest(entry2, friend, history, lastTs, API._jsonInstruction(), true);
console.log('\ncontrol (contextTokens=200000): returned omitted=' + req2.omitted + ' — no trim at a real budget');
