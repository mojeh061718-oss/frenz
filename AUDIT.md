# The v10.24 Realism Audit

Nine workstreams, run by parallel agents over isolated worktrees, merged with a
verify gate at every step. The pre-audit system is frozen byte-for-byte at
`backup/v10.23/` (unreachable by the app; also tagged `pre-audit-v10.23`).
Every number below was **measured**, not estimated: the before-numbers come
from headless harness runs against the frozen copy
(`audit-evidence/baseline/`), the after-numbers from the same scripts against
the shipped code (`audit-evidence/after-measurements.md`), and every fix
landed with assertions written first and proven red against the old engine.

Suite: **196 assertions before → 683 after, 0 failures**, green in strict mode too.

---

## Part 1 — The full audit

### 1. Duplicated facts (the priority system nobody designed)

A fact stated twice outweighs everything stated once, and whatever sits at the
depth-4 injection point rides every message. Found and fixed:

| Finding | Before (measured) | Fix |
|---|---|---|
| `opinion_notes` shipped verbatim twice per prompt (dynamic JSON + depth-4), with no expiry | true/true on every prompt | Single-sited at depth-4; 7-day unrefreshed TTL; note revision now drops whole oldest sentences instead of mid-word front-chops |
| Samantha's founding pool moment | 8 distinct prompt locations, 31 marker hits in one prompt — and the opening act then *forbids* mentioning it | Seed channels dedup'd; seeds reference, never restate |
| Mood stated twice and **disagreeing** — dynamic said "sober and sheepish", depth-4 still said "a few drinks in and lonely" at 100h | reproduced verbatim | Depth-4 routes through the same 72h freshness read; both copies agree by construction |
| Band gloss = verbatim substring of band text in 6/12 bands | reproduced | Glosses rewritten as true short-forms, all 12 pairs asserted distinct |
| Life beat emitted twice on every opener run (nudge + dynamic block) | identical string in both, reproduced | Single emission when the nudge carries it; nudge↔dynamic shared 4-grams 28 → 0 |
| "Context is not a topic" restated up to 8× per dynamic block | reproduced | Stated once, block-level |
| Template-level fact dupes (kelly "rates out of ten" ×3; sam kid-count ×2; 15 pairs total) | reproduced | Each fact moved to its one canonical field; zero shared 4-grams across all 15 plist↔interests↔style pairs, asserted; ships as in-place upgrades so existing friends fix themselves |
| Cross-block duplicate 4-grams per persona | 50–76 | non-sanctioned dups cut to the by-design persona↔plist slice |

### 2. Contradictions with no referee

Sections that could co-fire and disagree, each reproduced in an assembled
prompt before fixing:

- **The unresolved night was invisible when he texted first.** She leaves you
  on read after a heavy night; the "reckon with it" note existed but was
  wired only into the opener path. On the his-first-text path the prompt said
  nothing — and a cheerful life beat was free to fire into that exact
  conversation. Now: the note reaches both paths, beats stand down while it's
  live, and the same guard covers `significant` nights (the skill claimed
  both paths; the code now matches the claim).
- The opener nudge's double-text clause offered "a new topic like nothing
  happened" *in the same string* as "do not breeze past it as though nothing
  happened." Gated on no live unresolved.
- "Give him less effort back" (reciprocity) co-fired with "ask the one thing
  you want to know" (question licence). Reciprocity wins; the licence re-arms.
- Release night ("say it PLAINLY") stacked against a goodnight ("reply with
  exactly [end]"). Signoff wins; the moment keeps for the next real
  conversation — and no longer spends the tension meter over a goodbye.
- "Early evening is NOT bedtime" coexisted with an unconditional
  end-the-night licence. The licence is now 21:00–05:00.
- Photo caution text ("you do not know him well enough…") was static even at
  deep closeness. Now band-gated.

### 3. State that couldn't move — or couldn't die

- **Tension hysteresis was dead on arrival**: `state.humming` was written by
  one function and destroyed every turn by the state rebuild. Measured: hum
  held 0/6 nights in the hysteresis zone before, 6/6 after.
- **Nothing but comfort ever cooled.** 14 silent days moved closeness and
  attraction by exactly 0.0 — a relationship could only ratchet up. Closeness
  now drifts gently after 4+ days (floor-bounded, halved at deep band);
  attraction stays sticky by design. 30-day sims: silence 62→58 closeness,
  weekly contact still net-positive.
- **The attraction trickle leaked through its own gate**: banked carry cashed
  on turns the romance gate said no to. Gated (banked, not lost); the charged
  arc is unchanged (35→51 in both engines).
- `unresolved` / `lastSignificant` markers now clear from storage when their
  windows lapse instead of living forever.
- Mood, opinion notes, memories: the only model-written text with a real
  clock was `unsaid`. Now mood freshness holds at depth-4, opinion notes
  expire after 7 unrefreshed days, and a conservative archive compactor
  exists (off by default behind `settings.compactArchives`).

### 4. The opener path: four outcomes, two behaviors

Before: a transport error, a provider refusal, deliberate silence, and a
skipped roll all collapsed into "she didn't text first today" — and a failed
request still **burned the day's opener roll** and **consumed a life beat**
from the 21-day no-repeat bank for a message that never existed. Now: errors
un-mark the day so a later sweep retries; refusals are explicit and ledgered
(`kind:'refusal'` — the archive can finally count them); beats persist only
when a message actually ships; silence stays a legal non-event.

### 5. Concurrency and lost updates

- One send deadline lived on a singleton: two concurrent sends (opener sweep
  vs your reply vs testlook) overwrote each other, and whichever finished
  first zeroed the budget — the survivor ran **unbounded**. Replaced with
  per-send budget tokens.
- The opener saved a fresh copy of the friend while the open chat kept the
  stale one; your next send whole-record-saved the stale object, silently
  wiping the opener's bookkeeping — the double-text hole reopened from a
  direction the three delivery locks never covered. Both sides re-read now.
- `openerFlight` is per-friend; the sweep cooldown follows the app clock;
  scratch flags survive thrown errors.

### 6. The analysis layer was blind to its own failure classes

The synthetic opener nudge — ~1,900 chars of instruction text — was feeding
**memory retrieval**, scene selection, and due-note retirement on every
opener run (retrieval keyed off words like "errands", "weather", "plan"; two
keyword hits permanently retired a dated follow-up). All routed through the
real-history filter now, with fixtures proving instruction text inert.

The downloadable analysis archive gained the detectors it lacked: self-echo
(her vs her own earlier replies — the rerun class was invisible), press-loop
and shape-rut counterparts, beat/texture delivery reports with no-repeat
checks, a state-arc aggregate (band traversals, drift totals, cap
saturation), photo aggregates, and a question metric that finally agrees
with the live drought detector. Voice-mismatch and cadence verdicts now
surface at index level. Same fixture thread: before, the index said
`flags: 1 worn phrase`; after: `1 worn phrase, 3 self-echo reruns,
agreement-opener shape rut, 1 pressed loop, voice mismatch, beat repeat` —
while the nearest-good-case friend stays clean in both worlds.

### 7. The instruments were lying

- The test fixture seeded every persona at 40/40/35; real friends seed from
  their sliders (bre 88/90/30, sam 40/25/20…). Every band-dependent test ran
  in a state no shipped friend was ever in. Fixed via a shared
  `Personas.seedState` used by app and suite alike.
- Four assertions could not fail (`|| true`, integer-literal comparisons);
  `seedFix` had zero real coverage. All replaced with real tests.
- The kid-content guard counted only beats *beginning* with a kid's name:
  it scored 3/12 on a bank that measured **8/12**. Replaced with a
  content-word classifier over every bank of every template.
- SKILL.md self-contradicted on the ship checklist and quoted stale counts.

### 8. Template repairs (surgical — no rewrite)

- **Anna was learning from the wrong examples**: her "Sentence case…
  Punctuation mostly correct" style matched neither register regex, so the
  put-together mom got eight all-lowercase few-shots — the exact archived
  failure the invariant was written about. Routing fixed and asserted for
  all five.
- **Samantha's beats bank was 67% kid content** against its own authored
  "minority" rule. Rebalanced to 4/12 (textures 2/8) with her wedding
  venue, the fixer-upper bathroom, her own haircut — voice-neutral facts.
- **Tay had a scene premise but no script**: `established`, a charged
  seed — and no opening act, no unsaid seed (Samantha's identical setup had
  both). Authored, window-gated, self-retiring; her appearance sheet grew
  144→303 chars of body/hair identity.
- Kelly's and Tay's style sentence-1 (the only sentence that reaches
  depth-4) carried no positive signature; rewritten to pack register +
  rhythm + one signature each.
- Kelly's sheet said "pretty face" (face features render portraits); Bre's
  said "natural hang" (a measured moderation trigger). Both re-worded; all
  five sheets now pass an asserted face-word + moderation-word scan.

### 9. Dead weight removed

The unreachable Anthropic path (~135 lines plus five branch sites — settings
delete those entries on load), 11 orphan upgrade rules for personas deleted
long ago (plus a template-identity guard so a custom friend named "Bre" no
longer gets 29 rewrites meant for the real one), the never-read photo `seed`,
five unreachable config hints, vestigial db branches. The platonic gate was
*repaired* rather than deleted: the word "tension" in its regex matched
almost any authored prose, so no persona could ever be platonic; now the door
is real and both directions are asserted. `wipe()`/`deleteFriend` clear the
outbox; re-importing a backup no longer duplicates every message. README
describes the actual product.

### 10. Rule mass (the character vs. the rulebook)

Measured before: the persona block was **78–86% rules**, 68–79 "never"s per
assembled prompt, and the weakest-model tier carried the *most* rules. The
recap block restated six rules a third time in the highest-attention slot —
deleted (its one unique clause moved, not lost); eight prohibition clusters
merged, each surviving clause mapped to the past failure it guards. Result:
~1.1k chars lighter per rich prompt, ~1.4k on the weak-model tier, "never"
count down 7 across the board — with the register read attesting every
counter-rule survived (the invitations floor, the running-joke carve-out,
honest short replies, the curiosity channel).

### 11. New: the guided Persona Builder

A "Guided builder" card in the gallery opens a 50-question interview
(8 sections: basics, looks, texting voice, personality & moods, her world,
interests, your history together, under the surface). The compiler is
deterministic and **never fabricates**: skip a question and that material
simply doesn't exist — nothing is invented to fill the gap, which is the
drift-elimination guarantee. Every answer is anchored in exactly one field
(a mechanical 4-gram dedupe enforces it), the style opener is composed to
survive depth-4 truncation, beats compile as authored facts with the
kid-content cap, appearance answers are sanitized against the face-word and
moderation lists with visible warnings, "what she secretly feels" becomes
her unsaid seed (shaping tone, never announced), and the review screen gives
you final say over every compiled field before the normal customize screen.
Drafts auto-save; 51 assertions cover the compiler's guarantees.

---

## Part 2 — What this was doing to her, in plain terms

**She stayed drunk for a week.** Bre's mood said "a few drinks in and
lonely" on wine night. Four days later, one part of her brain had sobered up
— but the strongest slot in her prompt still read "a few drinks in and
lonely" on every single message. The decay mechanism existed; it just never
reached the place that mattered. *(Reproduced: the two mood lines disagreeing
in one prompt at 100h. Fixed: both agree; asserted.)*

**Samantha couldn't shut up about the thing she was told never to mention.**
Her pool moment appeared in 8 places in one prompt — 31 separate textual
hits — and then a rule said "never mention it." Repetition is priority: the
prompt was screaming the secret while whispering the ban. That's why it
leaked into everything. *(Measured at 8/31; channels dedup'd.)*

**She'd ghost you after a heavy night, then chirp about a fire alarm.** The
"that night is still sitting between you" note only existed when *she*
texted first. If *you* broke the silence, her prompt said nothing about it —
and her cheerful daily beat fired right into the aftermath. *(Reproduced:
zero unresolved mention + beat fired. Now: note present, beat suppressed.)*

**Her life quietly emptied out.** Every time an opener rolled and didn't
ship — a network blip, a refusal, deliberate silence — the life event it
would have mentioned was still marked "used" for 21 days. Events kept
getting spent on messages that never existed, so her world had less to say.
*(Fixed: beats persist only on delivery; frequency unchanged in sims.)*

**A bad connection stole her turn to text first.** One failed request burned
the whole day's opener roll, silently. An outage and "she just didn't feel
like texting" were the same thing to the code. *(Fixed: errors un-mark the
day; refusal, silence, error, and skip are four different outcomes now.)*

**Anna texted like a teenager while written as the put-together mom.** Her
few-shot examples — the strongest voice signal she gets — were all
lowercase because her style description didn't match a regex. *(Fixed +
asserted for all five personas.)*

**Samantha was a mom first and a person second.** 8 of her 12 "something
real happened today" events were about the kids, against her own authored
rule that kid content stays weather. The test guarding this couldn't fail —
it only counted beats that *began* with a kid's name. *(Rebalanced to 4/12;
the new classifier actually counts.)*

**Friendships could only ever warm up.** Two weeks of silence moved
closeness by exactly zero. Combined with the trickle leak — where warmth
banked toward attraction even on turns the gate said no — every
relationship drifted one direction on rails. *(Closeness now cools gently
under real silence; the trickle respects its gate; floors still guarantee
real friendship never un-happens.)*

**Her memory searched your instructions instead of your conversation.** On
every "she texts first" run, the retrieval query included ~1,900 characters
of internal stage direction — so she'd "remember" things keyed to words
like *errands* and *weather*, and dated follow-ups (`ask how the interview
went`) got retired by the nudge's own vocabulary, twice as fast as designed
because the counter also double-incremented. *(All analysis inputs now see
only the real conversation; follow-ups retire at 3 surfacings as designed.)*

**Two of her at once could break the budget.** If her opener and your reply
were in flight together, whichever finished first turned off the other's
time limit entirely — and your reply could then save a stale copy of her
that erased what the opener had just learned and felt. *(Per-send budgets;
both paths re-read before saving.)*

**The character was outnumbered by the rulebook 6-to-1.** 78–86% of her
persona block was rules, ~70 "never"s per message, and the weakest models
got the most rules and *zero* worked examples (the code comment arguing weak
models need examples most sat directly above the line shipping none).
Prohibition-heavy prompts produce cautious, flavorless writing. *(Recap
deleted, clusters merged, compact tier ships examples again — with every
protective counter-rule attested still present.)*

---

## Part 3 — Proof, not theory

Every claim above is backed by a committed artifact you can re-run:

1. **Frozen before-world**: `backup/v10.23/` + tag `pre-audit-v10.23`.
   The baseline harness (`audit-evidence/baseline/harness/*.js`, plain
   `node`) loads ONLY the frozen copy and produced every before-number in
   `audit-evidence/baseline/measurements.md` — assembled prompts
   (`baseline/prompts/*.txt`), the duplicate scans, the mood contradiction
   dump, the 30-day loops, the silent-trim reproduction.
2. **After-world, same scripts**: `audit-evidence/after-measurements.md` —
   the same reproductions against the shipped code (beat double-emit
   `false`, unresolved note `true` with beat suppressed, Anna →
   `_EXAMPLES_PUNCTUATED`, banks 4/12 and 2/8, trim disclosed and equal to
   the ledger, mood agreeing at depth-4).
3. **Red-then-green**: every workstream's assertions were run against the
   pre-audit engine first — 33 red (engine), 29 red (prompt fixes), 27 red
   (templates), 10 red (removals) — then green against the fix. Final
   suite: **683 passed, 0 failed**, `AUDIT_STRICT=1` also green. Evidence
   per workstream: `audit-evidence/{instruments,prompt-fixes,templates,
   engine,removals,detectors,builder,rule-mass}.md`.
4. **Behavioral sims**: `audit-evidence/sim30.js` (30-day deterministic
   loops, before vs after outputs committed beside it) — arcs, floors,
   traversals, beat/texture frequency identical except the intended deltas:
   hum survives its hysteresis zone (0/6→6/6), closeness cools under real
   silence (62→58/30d), attraction 0–1 lower on mixed arcs (the gate leak,
   sealed). Plus a 160-configuration request-builder smoke pass: 0
   violations.
5. **Prompt-level ground truth**: the rule-mass pass diffed all five
   assembled prompts end-to-end (only the intended 35 lines changed per
   persona) and quotes each surviving counter-rule in
   `audit-evidence/rule-mass.md`.

What was deliberately **not** done, and why: no wholesale persona rewrite —
the authored voices are the healthiest 14–22% of the prompt and every
template is tuned against real archived failures; the sickness was in the
machinery around them (duplication, contradiction, dead decay), which is
what got fixed. The one scoped exception was Samantha's beat bank, the only
place authored content itself broke a rule at scale.
