# The /v1/images/edits spike — measured 2026-08-01, live API

**Question:** frenz's faceless-photo doctrine rests on one premise, stated at
`js/api.js:2787`: "these models roll a new person every generation, so the one
identity anchor we can actually hold is to never show the one thing that varies
most." xAI now ships `POST /v1/images/edits` taking reference images. Does that
endpoint actually give us a same-woman-every-photo anchor, or does it only
apply cosmetic edits to the source?

**Method:** throwaway Node probe (`probe.js` beside this file; key via
`XAI_API_KEY`, never committed). Prompts assembled by the LIVE engine loaded in
a vm (verify.js pattern) — including one full production `_imagePrompt` output,
because a consistency win that dies under our real 2.6k-char prompt is not a
win. Model: `grok-imagine-image-quality` (the db.js default). Reference: the
canonical appearance-sheet render (`testLookPrompt`, Samantha's sheet — redhead
/ freckles / leg-only tattoos: maximally checkable identity markers). 11 images
total, n=1 per cell — a spike, not a benchmark.

## Verdict: outcome (A) — edits COMPOSE new scenes, and identity holds

| # | Ask | Result |
|---|---|---|
| Q1 scene composition | reference + "same woman now on her couch / in her kitchen / on a beach" | **Composes.** Entirely new rooms, poses, lighting — not a filtered source. Same hair (same half-up style), same freckling, same build, same leg-only floral tattoos. See `01-scene-couch.png` vs `00-reference.png`. |
| Q2 outfit change | same reference, red sundress vs oversized hoodie | **Identity survives.** The documented IP-Adapter weak spot did not manifest: same woman in both, face plausibly consistent, tattoos/build/hair intact. (Kept in the session scratchpad; reproducible via probe.js.) |
| Q3 full pipeline prompt | production `_imagePrompt` (pov, heat 1) + `_IMAGE_AVOID` through /edits, control through /generations | **The whole argument in one pair.** `06-full-pipeline.png`: same woman as the reference, face still hidden (phone over face), `_CAMERA` night-flash register fully intact. `07-control-generations.png` (today's live path, same prompt): a visibly different woman — sparser tattoos, lighter freckling, different build. |
| Q4 latency / declines | 11 calls | 4.2–7.9s per call, **0 declines** — far inside `TIMEOUTS.image` 45s and the 110s photo budget. Full param set accepted verbatim (`aspect_ratio`, `resolution`, `respect_moderation`, `b64_json`, base64 data-URI source). |
| Q5 moderation with reference | includes a heat-1 thin-cami scene | No change observed: 0 declines. (Single day, single account — treat as "no new triggers found", not "none exist".) |
| Face lock (outcome-A test) | invented face reference + café + park scenes | **Locks.** Same face across all three down to the necklace and the cracked phone case with its pink sticker. `08-face-reference.png` / `09-face-cafe.png`. |

## Caveats measured, for the design that follows

1. **Reference bleed is real and mostly a gift.** With no outfit in the prompt,
   the reference's grey tank + black shorts carried into every scene; the face
   set carried the same worn navy tee and phone case. That is continuity for
   free — her wardrobe becomes *hers* — but it must be a KNOWN behavior: a
   scene that names clothing overrides cleanly (Q2), a scene that doesn't
   inherits the reference.
2. **Pose bleed: a mirror-style reference nudges compositions mirror-ward.**
   The outfit test came back as a spontaneous phone-over-face mirror selfie
   nobody asked for, and the full-pipeline pov render drifted toward the
   reference's mirror pose (face still hidden — the doctrine held — but the
   framing was the mirror's, not the pov pool's). If framing variety matters,
   the stored reference should be pose-neutral, or per-framing references
   considered.
3. **Tattoos are same-style, same-placement, not stroke-identical.** At phone-
   photo fidelity this reads as the same person; a pixel-peeper would spot it.
4. **n=1 per cell.** Every claim above is one render deep. The shape of the
   answer is unambiguous (the control/edit pair alone settles the premise), but
   drift rates over dozens of photos are unmeasured.

## What this means

The faceless doctrine's premise is dead on our own provider, on the model we
already default to, with our existing key. Facelessness is now a *choice* —
in-fiction motivated for some personas — not a constraint. The reference path
(one locked render per friend, fed to /edits) delivers the "same body and the
same rooms" claim the removals audit had to strike as false
(`audit-evidence/removals.md:37`).

Implementation is gated on the owner's call (plan §5): full outcome-(A) upgrade
(faces possible) vs narrow outcome-(B) shape (keep faceless framings, use the
reference to lock build/hair/skin only).

## v10.32 live check — the SHIPPED engine's prompts through /images/edits

Run after implementation (plan verification item 2), reference =
`00-reference.png`, prompts assembled by the live `_imagePrompt`:

- `live-hidden-pov.png` — hidden persona, pov, heat 1, reference riding, the
  sheet absent from the prompt (asserted false at runtime). Same woman as
  the reference — tattoo placement, freckling, build — head out of frame,
  snap register intact, no mirror-pose bleed. 7.7s, no decline.
- `live-shown-selfie.png` — `photoFace:'shown'` + locked reference, selfie
  mode through the real selector (`_modeFor` returned `selfie`,
  `_faceShown` true), `_imageAvoid(false)`. Same woman, face visible,
  arm's-length front camera, room behind her. 7.0s, no decline.

Both branches of the shipped design behave as the spike predicted.

## v10.33 pre-flight — JPEG data URIs and the downscale target

The upload path needs a downscaled reference: the data URL rides in EVERY
`/images/edits` body, sits on the friend record, and lands in the backup export.
Two things were unknown, both now measured (`jpeg-probe.js`):

| Question | Answer |
|---|---|
| Does `/images/edits` accept a **JPEG** data URI? | **Yes.** `data:image/jpeg;base64,…` at 768×1024 q85 accepted, 200 with an image, no decline. Every prior spike call had been PNG. |
| Does a downscaled JPEG reference hold identity as well as the full PNG? | **Yes.** `jpeg-1024-ref.png` (151 KB payload) vs `png-full-ref.png` (401 KB payload), same scene prompt: same woman in both — hair, freckling, build, leg tattoos, wedding ring. No visible fidelity cost. |

Payload arithmetic at 1024px longest edge, from the shipped reference:
JPEG q85 = 116 KB on disk → **151 KB base64**; PNG = 1.0 MB → **1.34 MB
base64**. A 9× difference on every photo she sends. Dials fixed at
**1024px longest edge, JPEG, q0.85**.

**Not measured, and left to the owner's smoke test:** whether a *real
photograph* (as opposed to a model-generated reference) holds identity and
clears moderation the same way. Every render in this file used a generated
reference; that is the honest limit of what has been tested.

## v10.33 — a REAL photograph as reference (owner-supplied, not committed)

The one thing the earlier spikes could not test. Source: an owner-supplied
photo of a consenting adult; it and its renders stay out of the repo by
design — only the findings are recorded here. Two framings through the
shipped `_imagePrompt`, reference riding, heat 0, `photoFace` hidden.

**Identity: holds.** Freckling, hair (including the same messy bun), build and
even the source's grey cami carried into both renders. A real photograph
anchors identity as well as a generated reference — the feature works.

**Framing: a face-forward reference DEFEATS the faceless pov rule.** The
assembled prompt said "her head is outside the picture entirely" and the render
came back a face-centred portrait. The source was a chest-up, face-forward
bathroom selfie, and its composition overrode the framing instruction. This is
the v10.32 pose-bleed caveat at full strength: the earlier note said a mirror
reference "nudges pov compositions mirror-ward"; a face-forward reference does
not nudge, it wins.

The mirror framing rendered correctly (phone over face, full body) — because a
mirror framing and a face-forward reference agree. Background bleed was also
strong: the source bathroom appeared in the mirror render.

**Consequences for the upload path:**

1. The v10.31 quality gate is the safety net and it fires correctly here (a
   visible face where the framing forbade one is exactly what `_screenSystem`
   flags) — but it burns its single re-roll on most pov shots, and it ships the
   second roll regardless. A mismatched reference degrades to "one wasted
   generation per photo", not to a broken feature.
2. **Reference shape must match the persona's face policy**, and the picker's
   copy has to say so: for a `hidden` persona the framings show her BODY, so the
   reference must show her body — full-length or waist-up, neutral stance, plain
   background. A chest-up portrait leaves everything the framings actually show
   (build below the shoulders, and in this persona's case leg tattoos and a soft
   stomach named in her sheet) to be invented fresh each generation, which is the
   consistency the feature exists to remove.
