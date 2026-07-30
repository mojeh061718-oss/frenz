# Engine audit evidence — Phase 2A (correctness) + 2B (design decisions)

Branch: `audit/engine`. Baseline for every "before" number: the
`pre-audit-v10.23` tag (byte-identical to `backup/v10.23`), loaded headlessly
via the SKILL sim-harness pattern (`vm` + real `js/personas.js` + `js/api.js`).
Harness: `sim30.js` (scratchpad; deterministic scenarios, identical inputs to
both engines). Assertions: `verify.js` "engine" block, written FIRST and run
red against the baseline before any fix.

## Red-then-green

Against the pre-audit engine, the engine block failed 33 assertions
(everything the fixes claim); every prior section stayed green (220 passing).
After the fixes: **263 passed, 0 failed** — including all 220 pre-existing
assertions, unmodified except one persona-name correction in a brand-new
engine assertion (Toni belongs to Bre's text, not Kelly's).

Representative red lines from the baseline run:

```
FAIL engine: humming survives applyStateDeltas
FAIL engine: tension 27 stays humming (inside the hysteresis zone)
FAIL engine: one request surfaces a due note exactly once (2)
FAIL engine: nudge vocabulary cannot retire a due follow-up
FAIL engine: retrieval no longer keys off the nudge instruction text
FAIL engine: the nudge does not inflate exchangedCount
FAIL engine: per-send budget tokens exist
FAIL engine: _leanContext resets when assembly throws (no compact-tier leak)
FAIL engine: prompt disclosure and ledger agree after the trim (54 vs 59)
FAIL engine: banked warmth does not cash through a romanceOk=false turn (35 -> 36)
FAIL engine: sentence-initial capitalizations are not canon (samantha)
FAIL engine: a custom persona no longer inherits the world cast
FAIL engine: identical descriptions rotate framing across days (1 distinct in 20 days)
FAIL engine: closeness now cools over a real silence (62)
FAIL engine: unresolved clears from storage after its 14-day window
FAIL engine: pinned same-theme memories cap at 3 (5 selected)
```

## 30-day simulations — before vs after

Any change near `applyStateDeltas` / caps / damping / drift requires the
30-day sim on both engines (SKILL balance-dial rule). Identical deterministic
scenarios; numbers side by side.

### [1] 30-day arc — 20 sessions × 3 exchanges, 40% charged, drift before each session

| persona | before (pre-audit) | after |
|---|---|---|
| kelly | c 40→89, cl 40→56, a 35→42, tension 74, flips 2, releases 2 | c 40→89, cl 40→56, a 35→41, tension 69, flips 2, releases 2 |
| bre | c 40→92, cl 40→57, a 35→42, tension 75, flips 2, releases 3 | identical (a 42, tension 75) |
| anna | c 40→87, cl 40→56, a 35→40, tension 56, flips 2, releases 1 | a 35→39, tension 51, rest identical |
| samantha | c 40→86, cl 40→55, a 35→40, tension 0, flips 2, releases 3 | a 35→39, rest identical |
| tay | c 40→87, cl 40→56, a 35→41, tension 40, flips 2, releases 3 | a 35→40, tension 27, rest identical |

Floors identical in every run ({comfort:75, closeness:50, attraction:25});
band-traversal counts identical; drift cost inside an ordinary 2-3-day cadence
is zero in both engines (the 2-day drift threshold never engages).

The only movement: attraction ends 0-1 point lower and tension a few points
lower for some personas — this is the **carry gate working**. Before, warmth
banked on charged nights cashed on the next PLAIN exchange (and that phantom
attraction tick fed the tension meter `BUILD_ATTR` on a mundane turn). After,
the same bank cashes one session later, on a turn that is actually charged.
Release counts are unchanged for every persona.

### [2] Pure absence — comfort 62 / closeness 62 / attraction 40, 30 silent days

| | before | after |
|---|---|---|
| comfort | 62 → 50 (floor) | 62 → 50 (floor) |
| closeness | 62 → **62 (immortal)** | 62 → **58** (floor-bounded at 50) |
| attraction | 40 → 40 | 40 → 40 (sticky by design) |

### [3] Invariant 15 — contact every 5 days (2 exchanges/burst), 60 days

| | before | after |
|---|---|---|
| closeness | 40 → 59 | 40 → **47 (still rising)** |
| comfort | 40 → 35 | 40 → 35 (unchanged behavior, pre-existing) |

Closeness gains outrun the new drift even at a thin 5-day cadence; the
engine-9 verify assertion pins the weekly-contact case (40 → 46, rising)
permanently. Note comfort already ran net-negative at this thin cadence in
the BASELINE engine — that is the existing comfort dial, untouched here.

### [4] Beat & texture dice, 60 days — must be unchanged

| persona | before | after |
|---|---|---|
| samantha | beats 29/60, repeats<21d 0, textures 40/60 | identical |
| tay | beats 26/60, repeats<21d 0, textures 38/60 | identical |

### [5] Hum hysteresis — charge to ~34, decay through the 24-30 zone

| | before | after |
|---|---|---|
| hum held on prompt builds inside the zone | **0/6** | **6/6** |

The flag `tensionNote` writes was destroyed by `applyStateDeltas`' fresh
state object every turn; the 24-30 hysteresis zone was dead code. Now carried
forward; the flicker (audit #1) cannot recur.

### [6] Trickle arc — 30 charged days, attraction 0-reported throughout

Both engines: attraction 35 → 51 (band traversal intact). The carry gate
changes nothing on the path the trickle was designed for.

## Per-finding disposition (2A)

All findings reproduced live in the harness before fixing; none failed to
reproduce.

1. **`state.humming` wiped every turn** — reproduced (red: "humming survives
   applyStateDeltas"). Fixed: carried forward in `applyStateDeltas`' next
   object. Sim [5]: 0/6 → 6/6.
2. **Double `buildDynamicContext` + dueNotes mutation** — reproduced (red:
   dueSurfaced hit 2 after ONE request). Fixed: the probe (and the post-trim
   disclosure rebuild) pass `dryRun` through to `dueNotes`; counters spend
   once per request; retire-at-3 restored and asserted. Beat/texture rolls
   verified idempotent per day (engine-2 assertion). `Settings.get()`'s
   localStorage write is one-time (flag-guarded in db.js) — the double call
   it rode on is gone with the dry probe; no db.js change needed.
3. **Synthetic nudge leaking into analysis inputs** — reproduced on all three
   inputs (BM25 query, `_sceneContext`, `dueNotes` retirement) plus the
   `exchangedCount`/phi-turn inflation. Fixed: all four routed through
   `_realHistory`; nudge-in-history fixtures (built via `openerNudge`, i.e.
   `_isSyntheticTurn`'s own format) assert both directions — instruction
   vocabulary is inert, his real references still retrieve/retire.
4. **Request-scoped scratch** — `_deadline`/`_forgiven` replaced by per-send
   budget TOKENS (`_openBudget`/`_closeBudget`; effective deadline = tightest
   live token; forgiveness per token). The first-finisher-zeroes-the-deadline
   → `_budgetLeft() === Infinity` race is gone (asserted). `_leanContext` now
   set/cleared in try/finally (throw-leak asserted red/green). `_strictNext`
   cleared in `_chatOnEntry`'s finally (budget-break leak). **Documented
   residual singletons:** `_witLicensed` (set and consumed inside one
   synchronous build — no await between; commented at the set site),
   `_notify` (UI-owned, worst case a notification titled with the other
   friend's name during overlap), and the min-over-tokens rule itself (two
   overlapping sends are both governed by the earlier deadline — a bounded
   early give-up, the safe direction).
5. **`currentFriend` stale-object lost update** — fixed: `sendMessage`
   re-reads the friend record at entry and re-points the module global;
   opener saves refresh `currentFriend` when the chat is open on that friend.
   (Source tripwires in verify engine-13 until the Phase-0.4 app harness.)
6. **Opener outcome conflation (invariant 18)** — transport error now
   un-marks `lastOpenerDay`/`lastOpenerAt` (through a fresh read, only if our
   own stamp is still in place, only if nothing landed); `result.refusal`
   handled explicitly on the opener path (day stays burned, nothing
   persisted, `kind:'refusal'` ledger event); `runReply`'s refusal branch
   ledgers the same kind. Silence (empty bubbles) remains a distinct
   non-event.
7. **Skipped/empty opener consumed a life beat** — fixed at the persistence
   boundary: the roll only ever lives on the in-memory copy (the day-mark
   save happens BEFORE the nudge rolls), and the empty/refusal branches no
   longer save the friend, so an unshipped beat is never committed and its
   21-day slot never burns. Delivered openers persist it exactly as before
   (sim [4]: frequency/rotation byte-identical).
8. **Silent final trim** — the safety-trim loop now rebuilds the disclosure
   line (dry) and re-measures until prompt and ledger agree; asserted by
   forcing a probe/real divergence bigger than the reserve (red: "54 vs 59";
   green: equal). A trim from omitted==0 now discloses itself.
9. **Attraction trickle cashing through romanceOk=false** — fixed: the gate
   that zeroes the delta also holds the bank (kept, not lost); asserted both
   ways plus sims [1]/[6].
10. **`_canonNames` pollution** — fixed: only mid-sentence capitalizations in
    HER OWN text (personality/interests/backstory/plist) count; world names
    join only when her own text uses them. Measured sets, before → after:
    - kelly: `[jon,kelly,nothing,samantha,sunday,tay,toni]` → `[jon,kelly,sunday]`
    - bre: `[arkansa,bre,fifteen,jon,samantha,sunday,tay,toni]` → `[arkansa,bre,jon,sunday,toni]`
    - samantha: `[cam,jon,mae,neither,samantha,sunday,tay,toni,trevor]` → `[cam,jon,samantha,toni,trevor]`
    - custom persona: `[biscuit,dana,jon,samantha,sunday,tay,toni]` → `[biscuit,dana,jon]`
    Counter-cases pinned by assertion: trevor (samantha) and taylor (tay)
    keep the 5-of-8 threshold; the existing §21 trevor tests stay green.
    (`arkansas`/`sunday` survive where they are genuinely mid-sentence
    fixtures of her life — a place she lives, the family's Sunday dinners —
    which is the correct side of invariant 13.)
11. **Smaller fixes** — `openerFlight` carries `friendId` and his send
    cancels only the same-thread flight; `sweepOpeners` cooldown reads
    `ClaudeAPI._now()`; a background/foreground opener whose ONLY content was
    dropped (photo markers) applies no state and clears nothing
    (`if (!landed) return`); `_frame` salts the hash with `_dayKey`
    (asserted: rotates across days, stable within one); the recovery-ladder
    heat-0 reset now carries its rationale in place (heat-1 rung considered
    and rejected: doubles worst-case ladder latency inside the slow path for
    a marginal tone win).

## 2B decisions (each with the before/after sims above)

- **Closeness absence drift**: added — comfort-like, floor-bounded, slower
  (engages at 4+ days vs 2, caps at 3/application vs 4, deep-band halving
  kept). Attraction deliberately untouched (sticky by design — dies by
  events, not calendars). Sims [2]/[3] + engine-9 assert drift cannot outrun
  achievable gains.
- **Drift on the opener path**: added via a shared `coolForAbsence` helper
  used by both `sendMessage` and `maybeOpener`, with a `driftAnchor` on the
  friend root so the same silence is priced once no matter who texts first
  (the opener path can cool-and-save without producing a message).
- **`_recentRomance` signatures**: documented in place, no behavior change —
  the attraction gate may hear the model's own high-confidence testimony
  (refusing to was calling her a liar), the tension METER may not (it
  schedules release nights; invariant 17). The sims show no case where the
  asymmetry misbehaves; unifying on the raw-including form would let one
  hallucinated delta start marching a thread toward a confession night.
- **unresolved/lastSignificant hygiene**: cleared in storage when their
  read-windows lapse (14d/10d), inside `applyStateDeltas`; live markers
  survive (asserted both ways).
- **Pinned theme cap**: pinned memories now cap at 3-same-theme (one seat
  more than unpinned, never a blanket pass); off-theme material still rides.
- **Compaction**: implemented `compactArchives` — memories beyond 300
  (non-pinned, importance ≤3, no pending date; lowest importance, coldest
  first), scenes beyond 200 (oldest-first, importance ≤3 only, standalone
  `facts` folded into memories through `mergeMemories`). **My call: OFF by
  default**, behind `settings.compactArchives` — memories are the long-arc
  carrier and a wrong retirement is undetectable later; the compactor should
  earn the default against real exported archives first. No Settings UI was
  added (flag is data-level); flipping the default later is a one-line
  change with this machinery already asserted.

## Files

- `js/api.js` — engine fixes (state, retrieval, budget tokens, trim, canon,
  frame, compactor)
- `js/app.js` — delivery fixes (opener outcomes, stale object, drift helper,
  refusal ledger, flight scoping, compaction call site)
- `.claude/skills/persona-pipeline/verify.js` — "engine" block (67
  assertions), appended, no existing section renumbered
- `.claude/skills/persona-pipeline/SKILL.md` — one dial line for the new
  closeness drift
- Version stamps NOT bumped (per audit ground rules; the release that ships
  the merged audit bumps all three together).
