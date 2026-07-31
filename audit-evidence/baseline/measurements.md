# BEFORE-audit baseline measurements — frozen `backup/v10.23/` engine

Branch: `audit/baseline`. Every number below comes from an actual run of the
harness in `audit-evidence/baseline/harness/` against **backup/v10.23/js/personas.js
+ backup/v10.23/js/api.js** loaded headlessly in a `vm` context with stubbed
`localStorage` (loading pattern per `.claude/skills/persona-pipeline/verify.js:1-33`).
No live app code was touched. `backup/v10.23/` is byte-identical to tag
`pre-audit-v10.23` (verified with `git diff --no-index js/ backup/v10.23/js/` — empty).

Clock pin: all runs fix "now" to **2026-08-05 20:00 container-local (UTC)**, a
Wednesday evening (`lib.js` `BASE`), so every hash-of-(id|dayKey) die reproduces
byte-for-byte. Seeding replicates `backup/v10.23/js/app.js:221-303`
(`startConversation`), i.e. the real slider-derived state of app.js:281-283:

| persona | comfort | closeness | attraction |
|---|---|---|---|
| kelly | 70 | 55 | 50 |
| bre | 88 | 90 | 30 |
| anna | 88 | 75 | 15 |
| samantha | 40 | 25 | 20 |
| tay | 35 | 20 | 20 |

Fixture: 40 exchanged messages of neutral, register-clean small talk
(`lib.js` `U_LINES`/`A_LINES`), last message 30 min ago, createdAt now−20d.
Where an engine die is involved, note that **none of these systems use
`Math.random`** — they are deterministic hashes of (friend.id | dayKey) — so
"rates" are estimated by running **200 trials with varying friend ids**
(sampling the same hash space); the seeded-id runs are exact.

---

## Item 1 — full assembled prompts (rich tier, mid-relationship)

Command: `node audit-evidence/baseline/harness/01-prompts.js`
Verbatim prompts with per-block boundaries: `audit-evidence/baseline/prompts/{kelly,bre,anna,samantha,tay}.txt`

```
kelly     persona=26161  dynamic=4941  plist=1072  phi=555  recap=882  instr=1991  TOTAL=35602
bre       persona=26402  dynamic=5588  plist=1413  phi=590  recap=878  instr=1991  TOTAL=36862
anna      persona=26879  dynamic=5298  plist=1789  phi=690  recap=880  instr=1991  TOTAL=37527
samantha  persona=29175  dynamic=6085  plist=2207  phi=690  recap=888  instr=1991  TOTAL=41036
tay       persona=28298  dynamic=5670  plist=1956  phi=663  recap=878  instr=1991  TOTAL=39456
```

Note vs plan: the plan's headline "~42,000 chars" matches Samantha *with her
opening act still live* (an earlier run at exchangedCount 39 measured 42,500);
at exchangedCount 40 (act just retired) she is 41,036 and the five personas
span **35.6k–41.0k**.

## Item 2 — cross-block duplicate scan

Command: `node audit-evidence/baseline/harness/02-dupscan.js`

**(a) normalized content-word 4-grams appearing in >1 block of one assembled prompt:**

```
kelly:    50 distinct duplicated 4-grams  (dynamic+persona 4, dynamic+plist 23, persona+plist 22, persona+recap 1)
bre:      56  (dynamic+persona 4, dynamic+plist 11, persona+plist 40, persona+recap 1)
anna:     69  (dynamic+persona 3, dynamic+persona+plist 3, dynamic+plist 23, persona+plist 39, persona+recap 1)
samantha: 76  (dynamic+persona 1, dynamic+plist 33, persona+plist 41, persona+recap 1)
tay:      50  (dynamic+plist 16, persona+plist 33, persona+recap 1)
```

Sample duplicated strings (full lists in the script output):
- kelly `dynamic+plist`: `"new place morgue best" / "place morgue best part" / …` — the
  entire opinion_notes text 4-gram-by-4-gram, plus `"attraction genuinely flirts back" …`
  (band text vs band gloss).
- samantha `dynamic+plist`: `"oh god saw everything" … "didnt stop looked right" …` —
  her whole opinion note twice.
- every persona `persona+recap`: `"even makes chat awkward"` (the recap block restates
  the persona's shy-stays-shy rule).

**(b) opinion_notes verbatim in two blocks (seeded nonempty from the template):**

```
opinion_notes: "New place is a morgue. He was the best part of that job and I am not going to say that out loud. ..."
verbatim in dynamic block: true    (state JSON, api.js:1786)
verbatim in plist block:   true    ("[ Kelly's private read on Jon: ... ]", api.js:1991)
```

**(c) Samantha founding-fact count, exchangedCount 8, opening act LIVE, unsaidSeed + seeded opinion:**

```
[persona] 1x  Personality ("walked in")
[persona] 7x  backstory ("walked into","deep in her own private moment","saw everything","did not stop","five seconds","held your eyes","five seconds")
[dynamic] 4x  opinion_notes in state JSON ("saw EVERYTHING","didn't stop","looked right at him","five seconds")
[dynamic] 4x  opening act ("what he saw","what he thought when he saw","did not stop","five seconds")
[dynamic] 7x  seeded memory #1 ("walked into","caught Samantha","mid-'alone time'","saw everything","did not stop","five seconds","five seconds")
[dynamic] 1x  seeded memory #2 ("walked in")
[plist]   4x  opinion_notes AGAIN ("saw EVERYTHING","didn't stop","looked right at him","five seconds")
[plist]   3x  unsaid seed ("saw everything","didn't stop","looked right at him")
TOTAL marker hits: 31 across 8 distinct prompt locations
```

**Measured truth vs plan:** the plan says the founding fact "appears 10× in one
prompt". Measured: **8 distinct prompt locations restate the event, with 31
individual founding-fact marker hits**. Whether that is "8" or "10" depends on
how a location is counted (e.g. counting personality+backstory separately per
sentence gets to 10) — the duplication itself is massively confirmed, the exact
count "10" is definition-dependent. And yes: the opening act that restates it
also forbids mentioning it ("You never mention that you did not stop, or the five seconds").

**(d) band-gloss vs band-text verbatim substrings** (comment at api.js:1946-1950
claims the gloss is a short form):

```
verbatim substring of _BAND_TEXT: comfort/high ("at ease — candid"), comfort/deep ("completely at home"),
  closeness/building ("becoming real friends"), closeness/high ("genuinely close"),
  closeness/deep ("inner circle"), attraction/deep ("fully drawn in — warm, forward, initiates")
differs: comfort/low, comfort/building, closeness/low, attraction/low, attraction/building, attraction/high
```

6 of 12 glosses ship verbatim inside the full band text of the same prompt —
including all four high/deep pairs of comfort/closeness the plan names.

## Item 3 — mood contradiction (Bre, 100h gap)

Command: `node audit-evidence/baseline/harness/03-mood.js`

```
state.mood (raw, as stored): "a few drinks in and lonely"
dynamic block state JSON : "mood": "sober and a little sheepish about last night",
depth-4 plist            : Mood: a few drinks in and lonely
contradiction present: YES — the two copies disagree
```

Reproduced exactly: `buildDynamicContext` routes mood through `_freshMood`
(api.js:1782 — intox mood breaks after 7h, any mood after 72h), while `_plist`
reads raw `s.mood` (api.js:1963). 100 hours after her last message, one block
says she is sober, the depth-4 block — the strongest position — still says she
is drinking.

## Item 4 — opener-run double-beat

Command: `node audit-evidence/baseline/harness/04-opener-double-beat.js`

```
today's beat: "The office fire alarm went off mid-afternoon and everyone stood in the parking lot for forty minutes."
beat in openerNudge:          true   ("If you want material: The office fire alarm went off ...")
beat in buildDynamicContext:  true   ("Meanwhile, something real happened in your world: The office fire alarm went off ...")
IDENTICAL beat string in both blocks of one request: true
```

Reproduced: `_bankPick` is deterministic per (friend, day), so the nudge
(api.js:1213-1216) and the dynamic block (api.js:1820-1821) carry the identical
beat sentence in the same request on every opener run where the beat die fires.

## Item 5 — his-first-text unresolved hole

Command: `node audit-evidence/baseline/harness/05-unresolved-hole.js`

Friend with `unresolved = {kind:'read', ts: now−2d}`; HE texts first; non-opener
dynamic block assembled:

```
unresolvedNote(friend) (the note the ENGINE has ready): " IMPORTANT: last time, you read his message and deliberately did not answer. ..."
grep of assembled dynamic block: /unresolved/ /did not answer/ /deliberately/ /on read/ /reckon/ /breeze past/  -> ALL not present
unresolved note present anywhere in dynamic block: false
life beat fired on this unresolved night: true   ("Meanwhile, something real happened in your world: The office fire alarm went off ...")
only acknowledgment of the silence: "(It has been about 48 hours since the last message. React to the gap naturally if it matters to you. ...)"
```

Reproduced: after she leaves him on read, if HE texts first the model is told
nothing about the unresolved ending (unresolvedNote is wired only into
openerDue/openerNudge, api.js:1106/1188), and a cheerful life beat fires into
the same prompt with no guard (api.js:1820 has no `!unresolved` check — the
opener path at :1213 does).

## Item 6 — Anna example-bank routing

Command: `node audit-evidence/baseline/harness/06-anna-bank.js`

```
Anna style: "Sentence case and easygoing, ... Punctuation mostly correct because typing fast was never her thing. ..."
_STYLE_LOWERCASE.test(style)  = false
_STYLE_PUNCTUATED.test(style) = false   (/properly punctuat|proper punctuat|proper grammar|full sentences|correct punctuat|punctuates|capitali[sz]|formal|polite|prim|precise/i)
_exampleBank(annaStyle) returned: _EXAMPLES (the LOWERCASE bank — default fall-through)
first two examples verbatim:
  [0] They text: "hey" — BAD: "HEY! I'm doing good, just relaxing. What are you up to today?" — GOOD: "hey. you survived monday i see"
  [1] You texted "ok update on the devon thing. i was right" and they reply: "why" — BAD: "Just felt like it." then "Nothing deep." (...) — GOOD: "bc he did EXACTLY what i said he'd do" then: "showed up to her party with the girl he swears is just a coworker" — ...
```

Reproduced: "Sentence case" and "Punctuation mostly correct" match neither
router regex, so the sentence-case persona receives all-lowercase few-shots
(her rich-tier prompt ships `"avoiding laundry with everything i've got..."` and
`"barely. this better be good"`).

## Item 7 — Samantha beats kid-ratio

Command: `node audit-evidence/baseline/harness/07-sam-beats.js`

Content-word classifier `/(kids?|cam|gunner|blaze|rocky|bedtime|sitter|practice|team|milkshakes?|minivan|baby|...)/i`:

```
beats:    KID = indexes 0,1,2,3,4,5,6,11  ->  8/12 = 67%
textures: KID = indexes 0,2,7             ->  3/8  = 38%
```

Full classified list in the script output. Honest nuance: of the 8 flagged
beats, 6 are kid-LED (0,1,4,5,6,11) and 2 are her-own-life events that mention
kids in passing (2: burgers-with-kids-in-the-yard invitation; 3: empty-house
night because mom takes the kids). So the measured range is **50% kid-led to
67% kid-mention**, against the template's own authored rule (personas.js:218-221)
that kid content stays a MINORITY. The plan's "58-67%" is consistent with this.

## Item 8 — 30-day dice loops

Command: `node audit-evidence/baseline/harness/08-loops.js`

**(a) life beats** (daily 20:00 roll, persisted beatLog):

```
seeded ids, 30 days:  kelly 14/30 (47%), bre 15/30 (50%), anna 14/30 (47%), samantha 14/30 (47%), tay 12/30 (40%) — repeats inside 21 days: 0 for all
200-trial rate:       kelly 44.6%  bre 45.4%  anna 44.7%  samantha 44.7%  tay 44.8%  — 21-day repeats across 1000 trial-months: 0
```

Dial says ~45%: **confirmed**, and the 21-day no-repeat window **holds** (0 repeats
in 6000 rolled days per persona).

**(b) depth-4 interests-slice rotation coverage** (30 days of `_plist`):

```
kelly 8 sentences → 8 distinct slices; bre 7→7; anna 6→6; samantha 6→6; tay 8→8   (full coverage for all five)
```

**(c) openerDue at seed state, last message 8h earlier** (his), fresh friend each roll:

```
                       3am due          evening (20:00) due     _nightNorm
kelly     seeded 30d:   4/30             12/30                  score 5.0  normal
bre       seeded 30d:   3/30             12/30                  score 5.6  normal
anna      seeded 30d:   4/30             14/30                  score 4.8  normal
samantha  seeded 30d:   0/30             12/30                  score 0.0  strange
tay       seeded 30d:   0/30             13/30                  score -1.2 strange
200-trial (1000 rolls/slot): kelly 11.6%/44.4%  bre 10.1%/45.6%  anna 9.1%/46.4%  samantha 0.0%/45.4%  tay 0.0%/45.6%
```

Evening ≈ the 45% dial for everyone; 3am ≈ 10% for the three 'normal'-tier
friends and exactly 0% for the two established personas ('strange' tier blocks
the 2-5am roll entirely).

**(d) textures** (30 evenings, persisted textureLog):

```
seeded ids:  kelly 17/30 (57%), bre 20/30 (67%), anna 17/30 (57%), samantha 19/30 (63%), tay 19/30 (63%) — repeats inside 8 days: 0
200-trial:   kelly 61.1%  bre 61.4%  anna 61.3%  samantha 64.9%  tay 61.6%  — 8-day repeats: 0
```

Dial says ~65%: measured 61-65% (the 6-entry banks occasionally exhaust their
8-day window, which suppresses a would-be fire — that is the mechanism working,
not failing). No-repeat window **holds**.

## Item 9 — 30-day applyStateDeltas traversal

Command: `node audit-evidence/baseline/harness/09-state-30day.js`
(one positive session/day: raw +2/+2/+1 comfort/closeness/attraction at conf 0.9;
`friend.state = outcome.state` exactly as app.js:1271)

**(a) neutral fixture history — attraction NEVER moves** (`_recentRomance` gate
zeroes every positive attraction delta; the +0.34 trickle also requires the gate):

```
kelly    70/55/50 → day30 100/100/50   attraction 50→50 (frozen), bands high/high/high → deep/deep/high
bre      88/90/30 → day30 100/100/30   attraction frozen
anna     88/75/15 → day30 100/100/15   attraction frozen
samantha 40/25/20 → day30  86/71/20    attraction frozen; comfort building→deep in 25 days
tay      35/20/20 → day30  82/67/20    attraction frozen
```

**(a2) charged history ("i keep thinking about you…") — the gate opens:**

```
kelly    day30 100/100/78 tension 96 (attraction high→deep on day ~30)
bre      day30 100/100/57 tension 96
anna     day30 100/100/40 tension 100
samantha day30  86/71/45  tension 83
tay      day30  82/67/46  tension 75
```

Movement per day ≈ +1.5 comfort/closeness (2 × 0.965 conf-scale × 0.75
POSITIVE_SCALE × curiosity lean), ≈ +0.9 attraction when allowed. Bands
traverse in realistic session counts. Full day-by-day tables in the script output.

**(b) 14 days of silence from the day-30 state** (applyAbsenceDrift with the
real gap, as the app calls it):

```
                 comfort Δ at gap 2/4/6/8/10/12/14 days     closeness Δ    attraction Δ
kelly (deep cl.)  -1/-1/-2/-2/-2/-2/-2                       0 at ALL gaps  0 at ALL gaps
bre   (deep cl.)  -1/-1/-2/-2/-2/-2/-2                       0              0
anna  (deep cl.)  -1/-1/-2/-2/-2/-2/-2                       0              0
samantha          -1/-2/-3/-4/-4/-4/-4                       0              0
tay               -1/-2/-3/-4/-4/-4/-4                       0              0
```

**Measured and confirmed: closeness and attraction have NO decay path at all**
(`applyAbsenceDrift`, api.js:940-960, touches only comfort and tension) — two
of the three floor-guarded stats are monotonic-up. Comfort cooling caps at 4
points (2 for deep-closeness friends) regardless of gap length; tension bleeds
1/day.

**(c) the humming wipe:**

```
tension after 7 charged turns (via the engine): 32
tensionNote fired the hum: "## The hum (private)";  state.humming after tensionNote: true
mundane turn 1: tension 31; humming before turn=true  after turn=undefined
... (turns 2-5 walk tension 30→27, humming stays undefined)
final: tension=27 (>= hysteresis floor 24, so the hum SHOULD persist)
state.humming survived applyStateDeltas: NO — key absent (applyStateDeltas rebuilds state without copying it, api.js:1504-1608)
tensionNote now returns: null — the hum section is GONE despite tension 27 >= 24
```

Reproduced: `tensionNote` writes `state.humming` (api.js:1402) but ONE
`applyStateDeltas` + the app's whole-state replace (app.js:1271) destroys it.
The 24-30 hysteresis band is dead code: at tension 27 the hum note vanishes.

## Item 10 — rule-mass numbers

Command: `node audit-evidence/baseline/harness/10-rulemass.js`

**Persona chars per tier + rules/character split** (character = `## Who you are`
+ `## The people around you` sections):

```
kelly      full=27694  rich=26161  compact=23987  | rich: character=3763  rules=22398 (85.6% rules)
bre        full=27931  rich=26402  compact=24227  | rich: character=3958  rules=22444 (85.0% rules)
anna       full=28467  rich=26879  compact=24845  | rich: character=4601  rules=22278 (82.9% rules)
samantha   full=30589  rich=29175  compact=27001  | rich: character=6296  rules=22879 (78.4% rules)
tay        full=29879  rich=28298  compact=26173  | rich: character=5403  rules=22895 (80.9% rules)
```

Confirmed: the **full tier (weakest models) carries the MOST rules** — full >
rich > compact for every persona. The plan's "22.5k rules vs 3.7k character
(86%)" matches Kelly exactly; the range across personas is **78.4-85.6% rules**
(the style line, another ~443-639 chars of authored voice, is counted as rules
here; moving it to "character" shifts each ratio down ~1.5-2 points).

**"never" counts:**

```
kelly     persona "never"=52   assembled "never"=73   all negation tokens (never/no/not/don't/nothing/nobody/none)=215
bre       persona 49  assembled 68  negations 206
anna      persona 51  assembled 74  negations 211
samantha  persona 54  assembled 79  negations 242
tay       persona 53  assembled 75  negations 237
```

(Plan said "78 never + ~60 more negations" — measured 68-79 "never" per
assembled prompt; total negation-token counts run higher than the plan's
phrasing, 206-242, under a broader token list.)

**phi static fraction over 40 sends** (history.length 2..80 step 2, wit licensed —
the normal case):

```
kelly     distinct phi strings: 17/40; byte-identical prefix 297 chars = 45.5% of avg 652; prefix+suffix static 85.4%
bre       18/40; prefix 44.8%; prefix+suffix 84.2%
anna      17/40; prefix 45.6%; prefix+suffix 85.7%
samantha  16/40; prefix 46.6%; prefix+suffix 87.0%
tay       17/40; prefix 45.1%; prefix+suffix 84.9%
```

Measured framing vs plan: the plan says "_phi is 77-100% byte-identical every
turn". By our measure, ~85% of the phi block (common prefix+suffix) is
byte-identical across ALL 40 sends, and only 16-18 distinct strings occur in 40
sends (i.e. most turns repeat an earlier phi verbatim). Same direction; the
plan's 77-100% reads as a per-consecutive-pair figure, ours is across the whole
40-send window.

**plist static fraction over 30 days:**

```
kelly     distinct plists: 8/30; static prefix+suffix = 86.1% of avg 1138 chars
bre       7/30; 84.7% of 1385
anna      6/30; 86.5% of 1737
samantha  6/30; 83.9% of 2304
tay       8/30; 90.4% of 2004
```

**Measured truth vs plan:** the plan says "plist is ~68% static"; measured at a
FIXED state (nothing else changing, only the daily interests-slice rotation)
the plist is **84-90% static** — i.e. *more* static than the plan claims. The
68% figure presumably credited live mood/opinion/unsaid churn as dynamic; with
state held constant, the only rotating content is the 2-sentence life slice.
The audit report should use the higher measured number for the worst case.

## Item 11 — silent-trim reproduction

Command: `node audit-evidence/baseline/harness/11-silent-trim.js`

Setup: hand-lowered budget (contextTokens=6200 → 24,800 budget chars; overhead
alone exceeds it so the packing room floors at 1000 chars), 13-message history
(~860 chars incl. packing overhead) that fits the floor entirely → pre-trim
`omitted == 0`; then the final safety trim (api.js:3362-3368) fires:

```
history messages in: 13
history messages surviving in request: 1
final request chars: 32262 (budget 24800)
returned req.omitted = 12   <-- the ledger will record this
disclosure line in the shipped dynamic block: NONE — the prompt says nothing was omitted
MISMATCH (silent trim): returned omitted=12 vs prompt disclosure=none  -> REPRODUCED
control (contextTokens=200000): returned omitted=0 — no trim at a real budget
```

Reproduced exactly as the plan describes: the dynamic block bakes its
disclosure from the pre-trim `omitted` (0 → no line at all), the final trim
then silently drops 12 of 13 history messages, and the returned `omitted=12`
disagrees with a prompt that discloses nothing. (Also observed: even after
dropping all droppable history the request still exceeds the budget — the trim
cannot reach a budget smaller than the fixed overhead.) At Grok's real 1M
budget this path never fires (control), matching the code comment; the
disclosure-invariant violation is real whenever it does.

---

## Plan claims our measurements qualify or contradict

1. **"Samantha's founding fact appears 10× in one prompt"** — measured **8
   distinct prompt locations / 31 marker hits** at exchangedCount 8 with all
   channels live. Duplication confirmed and severe; the literal "10" is
   definition-dependent (see item 2c).
2. **"a full assembled prompt is ~42,000 chars"** — true only for Samantha with
   the opening act live (42.5k); measured range across personas at
   mid-relationship is **35.6k-41.0k** (item 1).
3. **"86% rules vs 14% character"** — Kelly measures 85.6%; the established
   personas carry more character (Samantha 78.4%). Range **78-86%** (item 10).
4. **"plist is ~68% static"** — measured **84-90% static** at fixed state; the
   plist is *more* static than the plan says (item 10).
5. **"_phi is 77-100% byte-identical every turn"** — compatible but reframed:
   ~45% of the block is a byte-identical prefix across all 40 sends, ~85%
   prefix+suffix static, and 40 sends produce only 16-18 distinct phi strings
   (item 10).
6. **Samantha beats "58-67% kid content"** — 67% by kid-mention classifier,
   50% strictly kid-led (item 7).
7. Everything else named in items 3, 4, 5, 6, 9, 11 reproduced exactly as
   described (mood contradiction, double beat, unresolved hole + beat firing,
   Anna's lowercase bank, frozen closeness/attraction decay, humming wipe,
   silent trim).
