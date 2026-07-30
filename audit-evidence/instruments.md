# Phase 0 — instruments repair (branch `audit/instruments`)

Date: 2026-07-30. Baseline commit: pre-edit worktree state (suite: **196 passed, 0 failed**).
After: **223 passed, 0 failed, 1 intended-red** (`AUDIT_STRICT=1` promotes the intended-red to a hard failure; exit code verified 1 in strict mode, 0 otherwise).

## Item 1 — mkFriend seeds real states (FIXED)

Claim re-verified against live code before changing: `js/app.js` (friend
creation) derived state as `comfort = min(88, sliders.closeness+15)`,
`closeness = sliders.closeness`, `attraction = sliders.attraction || 0`,
plus `mood`, `opinion`, `unsaid: t.unsaidSeed || ''`,
`lastSignificant: t.significantSeed ? {ts: now, kind} : null`. Template
sliders confirmed in `js/personas.js`: kelly 55/50, bre 90/30, anna 75/15,
samantha 25/20, tay 20/20 (closeness/attraction).

Extraction: the seeding block moved (not copied) to **`Personas.seedState(t, sliders, now)`**
in `js/personas.js`; `app.js` now calls it, and `verify.js` `mkFriend` calls
it too (backdated 20 days), then applies `API.initFloors` exactly like the
app.js boot backfill. Fixtures also gain `unsaidSeed` (samantha),
`significantSeed` (samantha, tay) and `floors` — all previously absent.

Measured fixture states, before → after:

| persona  | before (cf/cl/at) | after (cf/cl/at) | floors (cf/cl/at) | unsaid | lastSignificant | nightNorm tier |
|----------|-------------------|------------------|-------------------|--------|-----------------|----------------|
| kelly    | 40/40/35          | 70/55/50         | 50/50/50          | —      | —               | normal (was normal) |
| bre      | 40/40/35          | 88/90/30         | 75/75/25          | —      | —               | normal (was normal) |
| anna     | 40/40/35          | 88/75/15         | 75/75/0           | —      | —               | normal (was normal) |
| samantha | 40/40/35          | 40/25/20         | 25/25/0           | seeded | seeded (backdated) | strange (was strange) |
| tay      | 40/40/35          | 35/20/20         | 25/0/0            | —      | seeded (backdated) | strange (was strange) |

The fixture also previously invented `tension: 10` and `_carry: {}` — real
installs have neither at creation; both dropped. Probed all four prompt
stages (persona/dynamic/plist/phi) per persona at the new states: no
NaN/`undefined` leaks.

**Assertions whose expectations changed: NONE.** The full suite was re-run
at real seeds and stayed green, §11 night norms included. Recomputed by
hand to confirm this is coincidence-of-outcome, not a dead test: at the
fake 40/40/35 state every persona scored closeness=building(1.2) +
attraction=building(0.8) + type bonus − established, giving
kelly 3.0 / bre 3.2 / anna 3.2 (normal) and samantha/tay 0.8 (strange);
at real seeds the margins move (kelly 5.0, bre 5.6, anna 4.8, samantha 0.0,
tay −1.2) but every tier lands the same, so the §11 assertions already
encoded the correct behavior. The suite now *measures* that rather than
assuming it. The "samantha can EARN night hours" and 3am `openerDue`
frequency assertions also re-verified at real seeds (measured: bre 11/120,
within the asserted 1–30 window; samantha 0/120).

## Item 2 — the four vacuous assertions (FIXED)

- `verify.js:72` (`ok(... || hist)` — always true): replaced with a real
  guard test: `_dropEchoes(["ya it's about secrets", 'so hows the new job going'], hist)`
  must drop the restated bubble and keep the real one (length 1, no
  "secrets"). Verified failable by inverting the expectation (fails).
- `verify.js:330` (`ok(note === null || true)`): replaced with
  `photoNote({pool:[]}) === null` **plus** the nearest-good counter-case:
  a configured grok-imagine entry yields the `## Sending photos` section in
  the open-candor voice.
- `verify.js:469/:470` (`ok(!(7 > 7))`, `ok(7 > 6)` — integer literals,
  zero app coverage): removed; `seedFix` application extracted from
  `app.js:1862-1873` (move, not copy) to **`Personas.applySeedFix(f, tpl)`**
  and covered for real in the "instruments" block: rev-6 straggler
  corrected (55/70 → 25/40, landing exactly on today's seedState numbers),
  rev-7 friend crossing to 8+ skipped, clamp at 0, unnamed stats untouched,
  no-seedFix template is a no-op. Because the harness cannot load app.js
  (DOM), the wiring is pinned at source level: assertions require app.js to
  contain `Personas.seedState(` / `Personas.applySeedFix(` and to carry no
  inline copy of the `Math.min(88, ...)` formula.

## Item 3 — kid-content classifier (FIXED, one intended-red)

Re-verified before changing: old `verify.js:524` regex
`/^(Cam|Gunner|Blaze|Rocky|One of those days)/` scores samantha beats
**3/12**; the content-word classifier (kid, kids, son(s), daughter(s),
baby/babies, newborn(s), sitter(s), bedtime, practice(s), team-parents,
school, toddler(s), plus each template's authored child names — anna:
Sadie; samantha: Cam/Cameron/Gunner/Blaze/Rocky) measures **8/12** — the
old assertion could not fail on a majority-kid bank.

Measured ratios (assertion: kid content < half the bank, ratio printed):

| bank              | measured | verdict |
|-------------------|----------|---------|
| kelly beats       | 0/12     | green |
| kelly textures    | 0/6      | green |
| bre beats         | 1/12     | green (ward-kid beat; "practicing an instrument" correctly NOT flagged) |
| bre textures      | 0/6      | green |
| anna beats        | 2/12     | green |
| anna textures     | 2/6      | green |
| **samantha beats**| **8/12** | **INTENDED RED** — goes green when the `audit/templates` bank rebalance (~4/12) merges; gated via `okIntendedRed` (counted separately, run still exits 0; `AUDIT_STRICT=1` makes it fail) |
| samantha textures | 3/8      | green (minority) |
| tay beats         | 0/12     | green |
| tay textures      | 0/6      | green |

Classifier counter-cases asserted (invariant 1): mid-sentence "bedtime"
flags; a Trevor-only evening does not; adult "practicing an instrument"
does not; an authored child name does.

## Item 4 — stale meta (FIXED)

- `verify.js:1` header: "asserts the v10.1 realism changes" → version-free
  wording pointing at SKILL.md; notes the run prints the live count.
- SKILL.md assertion count: "144 assertions as of v10.9" → "220+ as of the
  v10.24 audit — the run prints the live count" (actual today: 223 green +
  1 intended-red).
- SKILL.md rule-mass figure: "Measured at v8.0: ~21k rules vs ~4k character"
  → re-measured live (rich tier, per template): persona block 26,159–29,173
  chars; authored character (personality+interests+style+backstory+world)
  4,015–6,666; rules ≈ 22.0–22.5k = 77–85%. (Kelly 26159/22144 rules,
  bre 26400/22145, anna 26877/22007, samantha 29173/22507, tay 28296/22443.)
- Ship-checklist self-contradiction: step 3 ("do NOT tell users to restart
  twice" — atomic snapshot since v10.6) is current truth; step 5's "Tell
  the user to restart the app twice" rewritten to match step 3.
- Merge-artifact paragraph (harness / opening acts / testlook+panic cover
  spliced into one, with a dangling "It loads..." referring two topics
  back): split into three paragraphs — (1) headless suite + vm loading +
  simchat harness + "use it to" bullets, (2) opening acts, (3) the two
  out-of-band tools. No content dropped.

## Rules compliance

- No version stamps bumped (index.html badge, sw.js CACHE, APP_JS_VERSION
  untouched).
- New assertion sections appended at END of verify.js in one contiguous
  block labeled "instruments"; no existing sections renumbered.
- `backup/v10.23/` not present on this branch's tree; nothing read from or
  written to it.
- Every extraction is a MOVE: app.js keeps no inline copy of seeding or
  seedFix logic (asserted).

## Not reproduced / deferred

- Expected §11 assertion failures at real seeds: did **not** reproduce —
  every existing assertion already held (analysis above). No fixture-driven
  expectation rewrites were needed anywhere in the suite.
- Loading full app.js into the vm harness (plan Phase 0 item 4: boot
  backfills, templateRev replace, opener delivery locks): deferred — app.js
  is DOM-coupled end to end; this phase extracted the two state-seeding
  paths into `Personas` (loadable, now covered) and pinned app.js to them
  at source level. The remaining app.js-only mechanisms stay a Phase 4B
  coverage item.
