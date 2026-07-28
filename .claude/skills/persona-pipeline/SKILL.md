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
   This is the invariant that has broken most often and cost the most. The
   attraction/pace ruling once shipped in THREE places (persona ladder,
   state block, depth-4 gloss) while each character's signature shipped in
   one — and the measured result was two very different characters both
   answering flat. Count copies before adding: `_buildPlainRequest` the
   prompt and grep it. Two is already a bug.

7. **Rule mass is itself a failure mode.** Every rule here was added for a
   real past failure, so each is individually defensible — but the model has
   finite attention, and the character is competing with the rulebook for
   it. Measured at v8.0: the persona block is ~21k chars against ~4k of
   character. When adding a rule, ask what it should REPLACE, and prefer
   positive specification ("do Y") over another prohibition — the prompt
   already carries ~60 "never"s, and prohibition-heavy prompts produce
   cautious, flavourless writing.

8. **Load rules situationally.** A platonic friendship does not need the
   escalation/intimacy rulebook, and handing it over doesn't sit inert — it
   tilts every reading toward subtext that isn't there. `buildPersona`'s
   `charged` flag gates that material on relationship type, with a door left
   open for a friendship that genuinely develops attraction. Same pattern
   applies to anything else that only matters in one situation.

9. **Examples teach VOICE, not just shape.** "Shape only, never wording" does
   not survive contact with a few-shot: a friend whose style said "properly
   punctuated" wrote 0/12 capitalized messages because every example was
   lowercase. Example banks are register-matched (`_exampleBank`), and any
   new example must be added to BOTH banks at the same index.

10. **Only the FIRST sentence of `style` reaches the generation point.**
    `_plist` truncates it, and that sentence rides depth-4 — the
    highest-attention slot in the prompt. It must carry register + bubble
    rhythm + her one signature marker, and its register signal must be
    unambiguous (not both "lowercase" and "properly punctuated", which is
    what Kelly's said for a long time while stating no shape at all).
    Everything after sentence one is still read, but only from the far
    weaker system-block position.

11. **Never gate a stable character property on volatile state.** The first
    cut of the charged/platonic gate keyed off the attraction band, which
    meant Kelly — flirtiness 85, "plays open sexual tension like a sport" —
    would have lost her whole signature after one quiet week pushed her
    under the band boundary. `_isPlatonic` reads type, sliders and her own
    authored text, and defaults to CHARGED whenever the evidence is
    ambiguous: the two failure directions are not symmetric.

12. **Slider prose is for characters who have none of their own.** A
    template with 2k chars of hand-written personality does not need a
    generic clause restating a trait it already expresses better —
    `sliderText` only speaks for dials the user actually moved off the
    template default.

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
- read `s.privateNotes()` to see which private directives co-occur tonight;
- count instruction weight: assemble the prompt and grep for how many times
  a ruling appears versus how many times her signature does. If restraint
  outnumbers character, the writing will show it.

The analysis archive (Settings → Download analysis archive) is the other
half of this: it runs the detectors over real conversations and reports
worn phrases, mirroring, and **voice fidelity** (does her output match the
punctuation/register her style field claims). A claim about live behaviour
should be checked against an archive, not eyeballed.

A claim about pipeline behavior that isn't demonstrated through the harness
or a test is a guess. The detectors have been right and the fixtures wrong
before (`_motifs` flagging a lazy test fixture); trust the run, then decide.

## Budget rules

- Input budget and output ceiling are separate. Persona/history spend input;
  reasoning + visible reply spend output (`max_tokens`). Starving output is
  what makes replies short and shallow.
- The raw history window is bounded BY DESIGN (`HISTORY_WINDOW`), not by the
  context budget. A 1M window is not free: focused context beats
  full-history stuffing on real chat benchmarks (Chroma context-rot /
  LongMemEval: 20-30 point drops), old turns are distractors, and a long run
  of her own replies teaches the model to imitate itself — stale, rutted,
  mirroring. So `omitted > 0` is the NORMAL state of a long relationship;
  scenes + memories + the recap carry everything older than the window.
- The budget (`contextTokens`) stays a safety ceiling only. If the char-room
  packing loop — not the window — is what's trimming at the default budget,
  something is wrong; find it, don't raise a reserve constant.
- Any trim must be disclosed in-prompt ("aren't shown"), never silent.
- Cache invariant: the system message is byte-stable per (friend, tier) —
  all volatile content (dynamic block, recap, plist, phi) rides as injected
  messages after the history, and the window's left edge moves only in
  `HISTORY_STEP` chunks. Breaking either busts the provider's prefix cache
  on every send.

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
