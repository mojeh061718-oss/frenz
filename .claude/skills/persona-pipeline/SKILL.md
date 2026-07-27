---
name: persona-pipeline
description: How to change frenz's persona/prompt/state pipeline without breaking realism. Use whenever editing js/api.js prompt assembly, applyStateDeltas, persona templates, or anything the model reads. Covers the invariants, the sim harness, the balance traps, and the ship checklist.
---

# Changing the persona pipeline safely

frenz's realism lives in one long chain: persona template → `buildPersona(tier)`
→ `buildDynamicContext()` (room read, Tonight, tension, curiosity, wit, life
events, unresolved endings) → depth-4 `_plist` → `_phi` → the provider →
`applyStateDeltas()` (clamps, damping, carry, caps) → bands → back into the
next prompt. Every regression this project has ever had came from editing one
link while forgetting what another link assumed.

## The invariants — check these before AND after any change

1. **Every rule must have a counter-rule check.** The failure mode of this
   codebase is overcompensation: anti-repetition machinery that kills running
   jokes, filler-rejection that kills honest short replies, anti-metaphor
   weighting that kills all wit. When you add a guard, write down what GOOD
   behavior sits closest to the bad behavior it suppresses, and test that the
   good case survives. If you can't name the nearest good case, the guard is
   too broad.

2. **A rule may exist in exactly one place.** Repetition in the prompt is a
   priority system nobody designed — the model weighs a rule stated three
   times over one stated once. Before adding an instruction, grep the persona,
   dynamic block, plist and phi for a sibling. Move, don't copy.

3. **Two blocks that can co-occur must not disagree.** Any new dynamic section
   must be checked against every section that can be live in the same
   assembled prompt (assemble it and read it — don't reason from memory).
   The classic conflict shape: a "be curious, ask" block co-occurring with a
   "don't interview him" block with no precedence stated.

4. **State must be able to move.** After touching `applyStateDeltas`, caps,
   damping, or drift: run 30 simulated days and confirm each stat can
   actually traverse a band in a realistic session count, and that absence
   drift cannot outrun achievable gains. A frozen slider is the complaint
   that started the whole rewrite era.

5. **Silence, refusals, and errors are different things.** `[noreply]` is a
   reply (Read badge), a content refusal is the provider's decision (never
   rerouted, never persisted), a transport error is an outage (badge in the
   corner). Don't let a change collapse these into each other.

6. **The model's testimony is input, not truth.** Everything coming back in
   the state JSON goes through clamps/damping/caps. Never apply a raw delta.

## The sim harness — prove it, don't eyeball it

`scratchpad/sim.js` drives the REAL engine headlessly. Use it to:

- print the exact assembled prompt per persona per tier (`s.prompt()`),
  grep it for contradictions and duplicated rules;
- run `s.day()` / `s.turnMany()` over 30 days to verify state movement,
  tension arcs, opener cadence, and that no guard has gone overbroad;
- read `s.privateNotes()` to see which private directives co-occur tonight.

A claim about pipeline behavior that isn't demonstrated through the harness
or a test is a guess. The detectors have been right and the fixtures wrong
before (`_motifs` flagging a lazy test fixture); trust the run, then decide.

## Budget rules

- Input budget and output ceiling are separate. Persona/history spend input;
  reasoning + visible reply spend output (`max_tokens`). Starving output is
  what makes replies short and shallow.
- The budget is a ceiling, not a target: Grok's window is 1M, so nothing
  should ever be trimmed in practice. If `_buildPlainRequest` reports
  `omitted > 0` at the default budget, something is wrong — find it, don't
  raise a reserve constant.
- Any trim must be disclosed in-prompt ("aren't shown"), never silent.

## Ship checklist (every deploy)

1. `node providers.js` — the engine suite must pass, and any new behavior
   gets assertions here first.
2. The full 12-suite loop from the scratchpad (providers, smoke, retry,
   gallery-check, pool-ui-check, freshinstall-check, grok404,
   iphone-ui-check, sw-check, leak-check, bedrock-check, persona-upgrade).
3. Bump BOTH the version badge in `index.html` (next to the frenz logo) and
   `CACHE` in `sw.js` — they move together, always.
4. Existing friends must upgrade in place (`_UPGRADES` chain + boot
   backfills). A change that only works for fresh installs is half a change.
5. Commit and push to the designated branch. Tell the user to restart the
   app twice (the SW picks up the new cache on the second launch).

## Known balance dials (don't retune casually)

- `_TENSION` constants, `SESSION_CAP 8` / `DAY_CAP 12`, `DAMPEN 0.35`,
  `POSITIVE_SCALE 0.75`, fractional `_carry` — these were tuned against
  30-day simulations. Changing one changes the reachable arc length of a
  relationship; rerun the 30-day sim before and after.
- `playfulNote` odds (25% + 12/attraction band + 12 hum, cap 60) — wit is
  rationed on purpose; a crafted line lands because its neighbors are plain.
- `_curiosityLean` (0.85×–1.25×, upward only) — curiosity tips the other
  sliders; flattening it re-freezes strictly-friends personas by design.
