# Prompt-fixes evidence — audit phases 1A + 1B (branch `audit/prompt-fixes`)

Method: a scratch harness (`promptdump.js`) loads `js/personas.js` + `js/api.js`
into a `vm` context, pins the clock (`_timeOffset`), assembles the real prompt
stages (`buildPersona` / `buildDynamicContext` / `_plist` / `_phi` /
`openerNudge` / `_buildPlainRequest`), and runs a word-level 4-gram scan across
blocks. **Before** = `backup/v10.23` (frozen pre-audit copy). **After** = this
tree. Fixed scenario clock: Wed 2026-08-12, 18:30 / 23:00 local.

Verification: `node .claude/skills/persona-pipeline/verify.js` — **263 passed,
0 failed** after the fixes (the pre-existing 196 assertions all still green
against the fixed code; the new contiguous `prompt-fixes` block at the end of
the file adds 67, each written red-first against v10.23 behavior and pairing
the failure case with its nearest good case).

Headline dup-scan numbers (same scenarios, before → after):

| scan | before | after |
|---|---|---|
| dynamic↔plist shared 4-grams, deep-state friend (band gloss + opinion + mood) | 31 | 5 (all five are the mood, which by design rides both blocks — now always the same fresh read) |
| nudge↔dynamic shared 4-grams on an opener run (beat + gap fact) | 28 | 0 |
| meta-rule ("context is not a topic") phrasings in one assembled prompt | 8 sites | 1 block-level statement |
| whole-prompt cross-block dups beyond the sanctioned persona↔plist slice (samantha / bre) | 77 / 39 | 26 / 19 |

The residual 26/19 are (a) the Samantha/Bre founding-event text riding both
backstory and seed memories — that is the per-template founding-fact channel
dedupe, owned by the parallel template agent (plan 1A, `personas.js` item) —
and (b) sub-sentence idiom collisions ("the two of you", "in your own words").

---

## 1A-1 · opinion_notes shipped twice + no TTL + incoherent revision — FIXED

**Before** (one request, both blocks):

```
[dynamic]  "opinion_notes": "Oh my god. He saw EVERYTHING. I am handling this with an apology and jokes …"
[plist  ]  [ Samantha's private read on Jon: Oh my god. He saw EVERYTHING. I am handling this with an apology and jokes … ]
```

**After**: dynamic state JSON line is gone (`(absent)` in the dump); the note
rides depth-4 only — a MOVE, not a delete-both (`js/api.js`
`buildDynamicContext` state JSON + `_plist`).

TTL added in `applyStateDeltas` (pattern-matched to the `unsaid` clock):
7-day unrefreshed expiry, model report restamps, legacy value gets a
start-of-clock stamp. Asserted: expires at day 8 unrefreshed; a note refreshed
on day 6 survives day 12 and expires 7 days after the refresh.

`_reviseNotes` low-confidence merge no longer `(o + ' ' + n).slice(-600)`
(which chopped the FRONT mid-word, walking the note into fragments): it now
drops whole leading sentences (oldest impressions) until the merge fits the
600 cap. Asserted: overflow fixture starts at a sentence boundary, keeps the
new addition at the end; a confident full revision still replaces.

## 1A-2 · mood contradiction at depth-4 — FIXED

**Before** (bre, mood "a few drinks in and lonely", 100 h silence):

```
[dynamic]  "mood": "sober and a little sheepish about last night",
[plist  ]  … Mood: a few drinks in and lonely; …
```

**After**: `_plist(friend, lastMessageTs, exchangedCount)` routes through the
same `_freshMood` read — `Mood: sober and a little sheepish…` at depth-4 too.
Callers updated (`_buildPlainRequest`, `_sendAnthropic`); legacy no-arg calls
degrade to the stored mood. Asserted: sober at 100 h, live mood unchanged at
30 min, and a seeded scenario mood still holds at depth-4 until the first
exchange (existing verify §7 stays green).

## 1A-3 · `_BAND_GLOSS` verbatim substring of `_BAND_TEXT` — FIXED

**Before** (deep-state friend, dynamic↔plist shared 4-grams — 31 total, incl.):

```
"attraction fully drawn in" · "fully drawn in warm" · "drawn in warm forward" · "in warm forward initiates" · "comfort completely at home" …
```

**After**: high/deep (and the overlapping low/building) gloss entries are true
short-forms with distinct wording (e.g. attraction deep: "all the way in —
openly warm, makes the first move" vs the contract's "fully drawn in — warm,
forward, initiates"). Asserted: no gloss entry shares a substring or a
word-4-gram with its band contract, for every stat × band; the attraction-low
gloss keeps its in-her-voice-deflection and playable-frame anchors.

## 1A-4 · life beat double-emit on opener runs — FIXED

**Before**: `openerNudge` ("If you want material: Toni sent you two photos of
a dress…") and `buildDynamicContext` ("Meanwhile, something real happened in
your world: Toni sent you two photos of a dress…") both emitted the identical
`_lifeBeat` string in the same request — nudge↔dynamic scan: 28 shared
4-grams.

**After**: the dynamic-block copy is suppressed on opener runs (synthetic last
turn is the tell); the same gate also removed the second copy of the gap fact
("It has been about 30 hours since the last message"), which the nudge opens
with — the dynamic gap note now rides only when HE texts first. Scan: **0**
shared 4-grams. Asserted both ways: no beat/gap line in the dynamic block on
an opener run; beat and gap note still fire on an ordinary his-text day.

## 1A-5 · "context is not a topic" restated 6-10× — FIXED

**Before**, one assembled prompt carried 8 phrasings of the same law:
persona "You are not a status ticker… scenery: it gets one mention…", energy
"Energy is not a topic — … never announced", texture "That is scenery, not a
topic — … one mention at most", wildcard "(Never announced, never
explained.)", week-event "It is background, not an announcement…", reveals
"Background truths, not announcements…", memories "Never announce the
remembering…".

**After**: stated once, as a block-level rule at the top of the dynamic block
("A standing rule for this whole block: context is never the topic…").
Every per-section restatement stripped; each section's non-duplicative content
kept (texture's "only when it fits", week-event's ask-exception, reveals'
voiced-when-called-for exception, memories' never-re-tell/never-list/quiet-
update rules, the rhythm section's written-to-his-last-message test).
Asserted: the rule appears exactly once; eight specific restatement strings
are absent; the kept clauses are present.

---

## 1B-1 · openerNudge doubleText vs unresolvedNote — FIXED

**Before**, one assembled nudge contained both "a new topic like nothing
happened" (doubleText) and "Do not breeze past it as though nothing happened"
(unresolved). **After**: doubleText is gated on no live unresolved; ordinary
double-texts keep the clause. Asserted both ways.

## 1B-2 · beat not suppressed on his-first-text while significant live — FIXED

**Before**: with `lastSignificant` 3 days old and HE texting first, the
dynamic block carried the significant reckoning AND the cheerful dress beat
side by side. **After**: the beat is suppressed while a significant or
unresolved note is live on the his-first-text path too (invariant 16 now true
on both paths). Skipping the `_lifeBeat` call also leaves the 21-day no-repeat
slot unburned. Asserted: suppressed beside the note; still fires on ordinary
nights (and existing §5 frequency assertions stay green).

## 1B-3 · unresolvedNote never reached the his-first-text prompt — FIXED

**Before**: after she left him on read, his next-day text assembled a prompt
with NO mention of it — and a cheerful beat available (reproduced in the
dump: unresolved `(absent)`, beat present). **After**: the gap note in the
dynamic block emits `unresolvedNote` within its 14-day window; unresolved
outranks significant (only one appears); stated once per assembled prompt
(nudge owns it on opener runs — grep across nudge + dynamic counts exactly 1);
a lapsed (>14 d) unresolved stays silent.

## 1B-4 · reciprocityNote + question licence co-fire — FIXED

**Before**: the same all-serve stretch produced "give less effort back" and
"ask the one thing you actually want to know" in one prompt. **After**:
reciprocity wins; the licence is skipped that turn and still fires on a
drought without the reciprocity signature. Asserted both ways.

## 1B-5 · release night vs signoff room read — FIXED

**Before** (release active, his last message "Night sam"): one prompt carried
"say the thing PLAINLY" + "reply with exactly [end]" + the beat offer + the
question licence + the reciprocity complaint. **After**: on a signoff turn the
content-demand sections (beat, question licence, reciprocity) stand down and
the release note defers — and `applyStateDeltas` neither spends the meter nor
restamps/marks significance over a goodbye, so the moment genuinely keeps for
the next real conversation. Asserted: all five suppressions; release still
rides and still spends/stamps on a live non-signoff turn.

## 1B-6 · early-evening "NOT bedtime" vs unconditional end-the-night licence — FIXED

**Before**: at 18:30 the clock said "early evening is NOT bedtime" while the
same block said "you're allowed to actually end the night". **After**: the
licence is time-aware (21:00–05:00) — absent at 18:30, present at 23:00 so she
can still leave at night. Asserted both ways.

## 1B-7 · photoNote guarded text static under deep closeness — FIXED

**Before**: "you do not know him well enough for any of this to be casual"
rode unchanged at closeness 85. **After**: band-gated at closeness ≥ high —
the distance claim is replaced by "that closeness is what makes a picture
possible at all, not what makes it casual…"; the survive-the-wrong-person
caution, ATMOSPHERE rule, and rarity rule are unchanged; near-strangers keep
the original wording; `open` candor untouched. Asserted all four ways.

---

## Residuals noted for other phases (not in 1A/1B scope)

- Mood still appears in both the dynamic JSON and the plist by design; the
  two now always agree (the contradiction was the finding).
- Samantha/Bre founding-event text rides backstory + seed memories
  (persona↔dynamic dups in the scan) — plan 1A per-template item, owned by
  the parallel `personas.js` agent, as is the authored "Never announced." in
  Samantha's texture bank (`personas.js:239`).
- `applyStateDeltas`' release-spend gate keys off the same
  `_classifyUserTurn(signoff)` read the prompt side uses — one authority.
- `_buildPlainRequest`'s probe/real double-call untouched (engine agent);
  every change here is a pure function of (friend, history, clock) and
  produces identical output on both calls of one request.
