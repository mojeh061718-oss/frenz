# Phase 4A + 4B — archive detectors & verify coverage (branch `audit/detectors`)

Evidence for the detector work. Everything below was produced by running the
real engine headlessly; nothing is asserted from memory.

- Fixture: two synthetic friends over `buildArchive` — **Echo** (a thread
  deliberately containing one of each failure class) and **Clean** (the
  nearest good case for every detector: varied riffs on a shared bit, real
  questions, matching voice, spaced bank logs).
- `archive-before.md` — the same fixture through the **frozen pre-audit
  reference** (`/home/user/frenz/backup/v10.23`, tag `pre-audit-v10.23`).
- `archive-after.md` — the same fixture through this branch.

## The headline: what the archive was blind to

Index line for Echo, before (v10.23):

```
- **Echo** — 32 messages · 6/1/2026 – 6/2/2026 · flags: 1 worn phrase
```

Same thread, after:

```
- **Echo** — 32 messages · 6/1/2026 – 6/2/2026 · flags: 1 worn phrase, 3 self-echo reruns, agreement-opener shape rut, 1 pressed loop, voice mismatch, beat repeat
```

The thread contains a self-echo run, the cami press loop, a 4-of-5
agreement-opener stretch, a punctuated style written in lowercase, a beat
that repeated 12 days into its 21-day window, a cap-saturated burst, an
absence-drift event, a senderr, a refusal, and a 3-rung photo decline
ladder. **v10.23 saw one worn phrase.** The voice MISMATCH existed in the
v10.23 per-friend appendix but never reached the index.

And the nearest-good-case friend stays clean in both worlds:

```
- **Clean** — 16 messages · 6/1/2026 – 6/1/2026 · no red flags
```

## 4A — detectors added to `_archDiagnostics` / `buildArchive` (js/api.js)

All reuse the live pipeline's own primitives so archive and live guards
agree by construction (`_normBubble`, `_stem`, `_echoScore`,
`_QUESTION_SHAPED`, `_AGREE_OPEN`, and `_pressLoop` itself). All rolling
windows; no O(n²) over full history. Purely local — zero network.

1. **Self-echo pass** (`_archSelfEcho`) — her replies vs her OWN previous 6,
   with `_dropEchoes`' exact carve-outs (tiny reactions pass; verbatim short
   lines outside her own last burst are deliberate callbacks), spike bar 0.7
   (the guard's stricter trailing threshold). Hit example (after-dump):
   `- **Self-echo** … 3 reruns of her own earlier line (reworded restatement, ≥0.7) at #0008, #0010, #0014`
2. **Agreement-opener shape** (`_archShapeRut`) — `_AGREE_OPEN` rate over the
   thread + worst 5-reply stretch at the live 3-of-5 threshold:
   `worst stretch 4/5 at #0018–#0026 — SHAPE RUT (live threshold 3-of-5)`
3. **Pressed loops** (`_archPressLoops`) — the live `_pressLoop` slid across
   the thread on 16-message slices, hits coalesced into episodes:
   `- **Pressed loops**: 1 episode … around #0018`
4. **Beat/texture delivery report** (`_archBankLines`) — from
   `beatLog`/`textureLog`: surfaced-per-week rate + assert-in-report on the
   21-day / 8-day no-repeat windows (live-data check):
   `- **Life beats**: 3 surfaced over 25 days (0.8/week) — **REPEAT INSIDE THE 21-DAY WINDOW** … entry #4 repeated after 12 days`
5. **State-arc aggregate** (`_archStateArc`) — band traversals with dates
   (replayed through the live `_bandFor` hysteresis), absence-drift totals,
   floors set, cap saturation (±SESSION_CAP per 90-min burst, ±DAY_CAP per
   day), and refusal/senderr/imgerr tallies by kind (invariant 18):
   `- **Band traversals**: comfort building→high (6/1/2026)` /
   `- **Cap saturation**: 1 burst hit the ±8 session cap · 0 days hit the ±12 day cap` /
   `- **Outcome ledger**: 1 transport error(s) · 1 refusal(s) · 3 photo error event(s)`
   (the `refusal` kind is counted the day audit/engine starts ledgering it;
   0 prints a note saying so).
6. **Question definition unified** — the interview/drought verdict and the
   index flag now use the live `_QUESTION_SHAPED` (unmarked questions count);
   the raw `?`-ending rate stays as the secondary number:
   `- **Questions from her**: 33% question-shaped (raw "?"-endings 0%)`
7. **Index-level flags** — voice-fidelity MISMATCH and flat cadence now
   propagate into the index `flags`, alongside the new self-echo / shape-rut /
   pressed-loop / beat-repeat / texture-repeat flags.
8. **Photo aggregates** (`_archPhotoLines`) — delivered photos from message
   markers; decline episodes (rungs coalesced within 3 min), decline rate,
   moderation re-framing rung count, hard failures:
   `- **Photos**: 1 delivered · 1 decline episode (50% decline rate) · 3 moderation re-framing rungs logged · 0 hard failures`
   Framing *choices* are not ledgered — only re-framing rungs are recoverable,
   and the report says so in its own comment rather than guessing.

`_archDiagnostics(msgs, profile)` grew two optional params
(`friend`, `events`); the only caller (`buildArchive`) passes them. No live
guard behavior was touched — api.js edits are confined to the archive
section (~3703-3980) plus the new pure helper methods beside it.

## 4B — verify.js "detectors" block (appended at end, D1-D10)

113 new assertions, one contiguous block; existing sections untouched and
unrenumbered. The footer gained one wrapper (`Promise.allSettled` over
`global.__asyncChecks`) so D3's stubbed `recordScene` promise settles before
the summary — behavior identical when no async checks are registered.

| Item | Status |
| --- | --- |
| D1 `[end]`/`[noreply]`/silence distinctions (`_stripEnd`, `_wantsSilence`, `_END_RE`, `_NOREPLY_RE`) | 9 assertions, green; counter-case: "end of story" survives |
| D2 `_injectDepth` at 2/3/6/10 incl. assistant-first (the documented silent failure) | 5 assertions, green |
| D3 scene pipeline: `sceneStale` thresholds, `recordScene` chunking (SCENE_CHUNK 35, stubbed provider), `_sceneContext` selection + budget, scenes gated on omitted>0 | 12 assertions, green |
| D4 cache invariant: persona byte-stable per (friend, tier) across days; window left edge in HISTORY_STEP chunks; trim disclosure == reality across budgets | 15 green + **1 intended-red** (below) |
| D5 parse salvage: `_looseParse` (fenced/prose/truncated), `_finishReply` state-blob strip + clamp, `_normStateRaw`, `_extractStateBlob` counter-case | 9 assertions, green |
| D6 `readTheRoom`: all 4 explicit forks, innuendo, frame, `_isWithdrawing` (+ counter-case), `_recentTone` classes | 15 assertions, green |
| D7 frequencies: `playfulNote` (base ~25% = 95/400; band+hum capped 60% = 242/400; both faces speak), `openerDue` ordinary hours (ROLL_PCT 88/200; MIN_GAP_H 0/50; DOUBLE_TEXT_GAP_H 0/200 at 8h, 134/200 at 21h) | 8 assertions, green |
| D8 photo: pov-pool distinctness (worst pairwise echo 0.75 < 0.8, faceless by construction), `_imageHeat`/`_HEAT_TONE` per level, heat never on scene, `photoCandor` open vs guarded, no-entry silence, `_RECOVERY_LADDER` order | 13 assertions, green |
| D9 `sliderText`: silent for untouched dials, one clause per moved dial, same-band nudge is not a move, characterless custom gets the full set | 5 assertions, green |
| D10 archive additions over the synthetic fixture: every new detector fires on Echo (with message refs) AND every nearest-good-case stays clean on Clean | 25 assertions, green |

**Intended-red (AUDIT_STRICT-gated):** D4's "final safety trim keeps the
disclosure honest". The final trim at `api.js:_buildPlainRequest` drops
history AFTER the dynamic block baked its `omitted` count; when the finished
request outgrows the probe estimate the extra drops are undisclosed. The
assertion simulates the probe/final divergence (dynamic grows 30k chars
after the probe) and measures: **disclosed 120 vs actually omitted 199**.
Written to the CORRECT behavior per the plan (Phase 2A: rebuild the
disclosure after trimming), deferred by default with a comment, enforced by
`AUDIT_STRICT=1`. Coordinate with the audit/engine merge.

Overlap check against parallel agent scopes: `_exampleBank` routing/parity
and the appearance-sheet face-word/moderation-word scans belong to the
prompt-fixes/templates scopes (Phase 1C) and were left out of this block on
purpose; nothing in D1-D10 duplicates an existing section (verified by
re-reading all 22 sections before writing).

## Verification

```
node .claude/skills/persona-pipeline/verify.js      → 309 passed, 0 failed (1 DEFER noted)
AUDIT_STRICT=1 node …/verify.js                     → 309 passed, 1 failed (the intended-red only)
```

(196 pre-existing assertions all still green; no existing section modified.)

No version stamps touched (`index.html` badge, `sw.js` CACHE,
`app.js` APP_JS_VERSION all unchanged) — archive + verify changes are not a
shell deploy. No live-guard behavior changed.
