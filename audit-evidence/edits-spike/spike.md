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
