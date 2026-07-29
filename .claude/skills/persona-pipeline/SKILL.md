---
name: persona-pipeline
description: How to change frenz's persona/prompt/state pipeline without breaking realism. Use whenever editing js/api.js prompt assembly, applyStateDeltas, persona templates, or anything the model reads. Covers the invariants, the sim harness, the balance traps, and the ship checklist.
---

# Changing the persona pipeline safely

frenz's realism lives in one long chain: persona template → `buildPersona(tier)`
→ `buildDynamicContext()` (room read, Tonight, tension, curiosity, wit, life
events, life beats, unresolved endings) → depth-4 `_plist` → `_phi` → the
provider → `applyStateDeltas()` (clamps, damping, carry, caps) → bands → back
into the next prompt. Every regression this project has ever had came from
editing one link while forgetting what another link assumed.

## The invariants — check these before AND after any change

### What the model reads

1. **Every rule must have a counter-rule check.** The failure mode of this
   codebase is overcompensation: anti-repetition machinery that kills running
   jokes, filler-rejection that kills honest short replies, anti-metaphor
   weighting that kills all wit. When you add a guard, write down what GOOD
   behavior sits closest to the bad behavior it suppresses, and test that the
   good case survives (the verify suite has a "gremlin" test for exactly
   this). If you can't name the nearest good case, the guard is too broad.

2. **A rule may exist in exactly one place — and so may a FACT.** Repetition
   in the prompt is a priority system nobody designed: the model weighs a
   thing stated twice over everything stated once. This has broken most often
   with rules (the attraction/pace ruling once shipped in THREE places and
   two very different characters both answered flat), but it breaks with
   facts too: Samantha's newborn was named in her plist traits AND in the
   interests slice riding the same depth-4 block, and the measured result was
   the baby in nearly every reply for weeks. Before adding anything, grep the
   persona, dynamic block, plist and phi for a sibling. Move, don't copy.

3. **Anything static at the generation point becomes her only topic.** The
   depth-4 slot is the strongest lever in the prompt, and whatever sits there
   unchanged rides EVERY message. A fixed "first two sentences of interests"
   made whatever concrete noun happened to lead the field into the
   character's entire personality (the Rocky fixation). Content near the
   generation point must ROTATE — deterministically (per `_dayKey`, like the
   vibe dice) so it holds steady across an evening and moves on tomorrow.
   When adding anything to `_plist` or `_phi`, ask: what does this look like
   on message 400?

4. **Tone is not content, and the pipeline needs both.** Vibes, wildcards and
   week-events are all TONE, and tone is deliberately invisible ("never
   announced"). If tone is all you generate, her only concrete material is
   the origin incident, the depth-4 slice, and her own recent messages — and
   long threads go stale by construction. Life beats (`_lifeBeat`, per-
   template `beats` banks) are the CONTENT channel: concrete events she is
   allowed to say out loud, rolled ~45% of days, logged on the friend, never
   repeated within three weeks. Beats are authored as FACTS, not jokes — her
   voice writes the delivery, for the same reason example banks are
   shape-only (see 10).

5. **Two blocks that can co-occur must not disagree.** Any new dynamic
   section must be checked against every section that can be live in the same
   assembled prompt (assemble it and read it — don't reason from memory).
   Classic shapes: a "be curious, ask" block against a "don't interview him"
   block with no precedence; a cheerful beat offered as opener material on an
   unresolved night, when the unresolved note explicitly forbids small talk
   that pretends nothing happened (the beat is suppressed there — keep it
   that way).

6. **Rule mass is itself a failure mode.** Every rule here was added for a
   real past failure, so each is individually defensible — but the model has
   finite attention, and the character is competing with the rulebook for it.
   Measured at v8.0: ~21k chars of rules against ~4k of character. When
   adding a rule, ask what it should REPLACE, and prefer positive
   specification ("do Y") over another prohibition — the prompt already
   carries ~60 "never"s, and prohibition-heavy prompts produce cautious,
   flavourless writing. A distance rule needs a positive floor too: "you
   barely know him" stated three times with no "ordinary invitations are
   natural" clause reads as a ban on being a person.

7. **Load rules situationally.** A platonic friendship does not need the
   escalation/intimacy rulebook, and handing it over doesn't sit inert — it
   tilts every reading toward subtext that isn't there. `buildPersona`'s
   `charged` flag gates that material on relationship type, with a door left
   open for a friendship that genuinely develops attraction. Same pattern for
   anything that only matters in one situation.

8. **Never gate a stable character property on volatile state.**
   `_isPlatonic` reads type, sliders and her own authored text — never the
   attraction band, which one quiet week can cross. Default to CHARGED when
   ambiguous: the two failure directions are not symmetric.

9. **Slider prose is for characters who have none of their own.**
   `sliderText` only speaks for dials the user actually moved off the
   template default; a template with 2k chars of authored personality needs
   no generic clause restating a trait it already expresses better.

10. **Examples teach VOICE, not just shape.** "Shape only, never wording"
    does not survive contact with a few-shot: a friend whose style said
    "properly punctuated" wrote 0/12 capitalized messages because every
    example was lowercase. Example banks are register-matched
    (`_exampleBank`); any new example goes in BOTH banks at the same index.
    Beats follow the same law from the other side: authored as neutral facts
    so the model can't lift a phrasing.

11. **Only the FIRST sentence of `style` reaches the generation point.**
    `_plist` truncates it, and that sentence rides depth-4. It must carry
    register + bubble rhythm + her one signature marker, with an unambiguous
    register signal. Everything after sentence one is read only from the far
    weaker system-block position.

### The guards

12. **A guard is only as good as its tokenizer.** The echo guards scored "ya
    it's about secrets" vs "ya its about keeping a secret" at 0.40 against a
    0.8 threshold — apostrophes split "it's" into "it s" while "its" stayed
    whole, and secret/secrets counted as different words. The most natural
    human restatement is minor rewording, which is exactly what naive token
    overlap is worst at. `_normBubble` strips apostrophes; `_stem` folds
    plurals; both sides of every comparison go through them. If you touch
    normalization, re-run the restatement tests — and remember the
    `_MOTIF_STOP` list is written in apostrophe-stripped forms ("dont",
    "youre") and silently stops matching if normalization changes.

13. **Guard exemptions expire.** The his-words exemption exists to protect
    shared running jokes — and as a lifetime pass it became the biggest
    blind spot in the pipeline: the moment he engaged a topic once, her
    restating it forever was invisible to every detector ("rocky" in 8 of
    her 8 consecutive messages, zero flags, because he had asked about the
    baby once). A bit is exempt while it is LIVE (he used it more than once,
    or recently); a dead bit she alone keeps reviving is the rut the
    detectors exist for. Any future allow-list gets the same treatment:
    scope it in time or count, never forever.

14. **The opener path is its own contract.** The opener/double-text nudge
    rides the request as a synthetic user turn wrapped in
    `<system-reminder>`. The PROVIDER must see it; every ANALYSIS function
    must not — `_realHistory` / `_isSyntheticTurn` exist for this, and every
    guard, room read, and reciprocity counter goes through them. Before this,
    the parrot guard compared her opener against the nudge's own instruction
    text and a verbatim restatement of his last real message sailed through.
    And on this path silence is a legal outcome: `_dropEchoes` returns
    nothing rather than shipping the least-bad echo, and app.js treats empty
    bubbles as "she just didn't text first today" — never save, never clear
    `unresolved`, never bump `lastActivity` on a message that wasn't sent.
    Two more clauses of the same contract, learned from the reported freeze:
    her INITIATIVE never locks his keyboard — a foreground opener is a
    cancellable token (`openerFlight`), not a `beginSend()`, and the user's
    send trumps and discards it — and the boot sweep competes with the
    user's own sends for the SAME per-minute provider quota, so it bails
    under `_underPressure()`, caps firings per launch, and always yields to
    a live send. A blocked composer must SAY it is blocked; a silent
    early-return on Send is a freeze report waiting to be filed.

### The state

15. **State must be able to move — and to decay.** These are the two failure
    directions of the same axis. Frozen: after touching `applyStateDeltas`,
    caps, damping, or drift, run 30 simulated days and confirm each stat can
    traverse a band in a realistic session count, and that absence drift
    cannot outrun achievable gains. Immortal: every model-written text
    channel (mood, `unsaid`, opinion notes, memories) is a theme-recirculation
    loop — the model writes "the secret" once, it rides depth-4 every turn,
    which produces more secret talk, which re-warms the memories. So text
    state rots on purpose: `unsaid` expires after 3 days unrefreshed, any
    mood breaks after 72h of silence (once the relationship has actually
    started — a scenario persona's seeded mood is the setup for the first
    exchange and holds until it happens), and `selectMemories` caps
    same-keyword memories at two per turn. If you add a persisted text field
    the model writes, give it a TTL the same day.
    And decay has a third law: **time erodes, it never demotes.** Entering a
    band sets a ratchet floor (`state.floors`, at the band's lower bound) —
    absence drift cools INSIDE the level and stops at the floor, because a
    week of silence cannot un-friend people who genuinely became friends.
    Floors bind time only: a real fight still costs at full price, below
    the floor if it goes that deep, and a stat a fight dug below its floor
    is frozen to time (silence neither digs further nor refunds). Floors
    never move down and never lift a stat up.

16. **A significant conversation is a debt the next opener must pay.** The
    night tension came to a head, a line leaned on, a real shift — followed
    by days of silence — must not be reopened with "rocky has been so hard
    lately". `applyStateDeltas` stamps `lastSignificant` on such bursts;
    `significantNote` fires between 1.5 and 10 days later (quiet inside the
    first day — that's the same conversation still breathing; lapsed after
    ten; cleared if a later conversation ended the silence; outranked by
    `unresolved`, whose own window is 14 days). While it is live, beats and
    bold openers are suppressed on both the opener path and his-first-text
    path — cheerful news is exactly the pretending both notes forbid — and
    it is stated once per assembled prompt (the nudge on opener runs, the
    gap note otherwise).

17. **The model's testimony is input, not truth.** Everything coming back in
    the state JSON goes through clamps/damping/caps. Never apply a raw delta.

18. **Silence, refusals, and errors are different things.** `[noreply]` is a
    reply (Read badge), a content refusal is the provider's decision (never
    rerouted, never persisted), a transport error is an outage (badge in the
    corner), and a skipped opener is a non-event. Don't let a change collapse
    any of these into each other.

## The sim harness — prove it, don't eyeball it

The suite ships WITH this skill so it survives sessions: run
`node .claude/skills/persona-pipeline/verify.js` (134 assertions as of
v10.8). The agent-driven conversation harness (`scratchpad/simchat.js`
pattern: an agent plays both Jon and the provider over the real engine)
found seven shipped fixes the unit suite alone never would — rerun that
kind of test after any large behavior change. Opening acts (`profile.opening = {text, until}`) are the pattern
for scene-premise personas: persona-scoped direction for the aftermath
conversation, injected into the dynamic block only while `exchangedCount`
is under the window, self-retiring before the reveal ladder takes over —
situational loading with a built-in expiry, never a permanent rule. Two out-of-band tools live beside the pipeline and must STAY out of
band: the composer command `testlook` (renders the persona's appearance
sheet as a neck-down mirror shot — no history, no state, no model call, no
acknowledgment, swept with the transient notes) and the triple-tap panic
cover (pure UI). Neither may ever leak into anything the model reads. It loads `js/personas.js` then `js/api.js` into a `vm` context with
stub `localStorage` and drives the REAL engine headlessly — extend it there,
and add assertions for any new behavior before shipping. Use it to:

- print the exact assembled prompt per persona per tier (`buildPersona` +
  `buildDynamicContext` + `_plist` + `_phi`), grep it for contradictions and
  duplicated rules/facts;
- replay the exact reported failure (the restatement double-text, the Rocky
  history) against the guards and watch it get caught — and replay the
  nearest GOOD case and watch it survive;
- run 30-day loops over `applyStateDeltas` and the per-day dice (`_plist`
  slice, `_lifeBeat`, openers) via `addTimeOffset`, checking movement,
  rotation, frequency, and no-repeat windows.

The analysis archive (Settings → Download analysis archive) is the other
half: it runs the detectors over real conversations and reports worn phrases,
mirroring, and voice fidelity. A claim about live behaviour is checked
against an archive; a claim about pipeline behavior is demonstrated in the
harness. Anything else is a guess — and the detectors have been right when
the fixtures were wrong before.

## Budget rules

- Input budget and output ceiling are separate. Persona/history spend input;
  reasoning + visible reply spend output (`max_tokens`). Starving output is
  what makes replies short and shallow.
- The raw history window is bounded BY DESIGN (`HISTORY_WINDOW`), not by the
  context budget. Focused context beats full-history stuffing (Chroma
  context-rot / LongMemEval: 20-30 point drops); old turns are distractors,
  and a long run of her own replies teaches the model to imitate itself. So
  `omitted > 0` is the NORMAL state of a long relationship — scenes +
  memories + the recap carry everything older than the window.
- The budget (`contextTokens`) stays a safety ceiling only. If the packing
  loop — not the window — is what's trimming at the default budget, find the
  cause; don't raise a reserve constant.
- Any trim must be disclosed in-prompt ("aren't shown"), never silent.
- Cache invariant: the system message is byte-stable per (friend, tier) —
  all volatile content (dynamic block, recap, plist, phi, beats) rides as
  injected messages after the history, and the window's left edge moves only
  in `HISTORY_STEP` chunks. Per-day rotation belongs in the injected
  messages, NEVER in the system block.

## Ship checklist (every deploy)

1. Run the headless verify suite (rebuild from the pattern above if the
   scratchpad is fresh) — all assertions green, and any new behavior gets
   assertions FIRST.
2. The full 12-suite loop where available (providers, smoke, retry,
   gallery-check, pool-ui-check, freshinstall-check, grok404,
   iphone-ui-check, sw-check, leak-check, bedrock-check, persona-upgrade).
3. Bump ALL THREE version stamps together: the badge in `index.html`,
   `CACHE` in `sw.js`, and `APP_JS_VERSION` in `app.js` (the skew tripwire —
   Settings reports loudly if the shell ever runs mixed versions). Since
   v10.6 the shell is an atomic cache-first snapshot and the page reloads
   itself once on update — do NOT tell users to "restart twice" any more,
   and never revert the SW to per-file network-first: independent fetches
   are how flaky networks assembled a half-updated app with dead buttons.
4. Existing friends must upgrade in place. Three mechanisms, pick the right
   one: `_UPGRADES` substring rules for text tweaks (respects hand-edits),
   boot backfills in app.js for brand-new FIELDS (`beats`, `appearance` —
   substring rules can't create a field), `templateRev` bump only for full
   rewrites (it wholesale-replaces defining text). A change that only works
   for fresh installs is half a change.
5. Commit and push to the designated branch. Tell the user to restart the
   app twice (the SW picks up the new cache on the second launch).

## Known balance dials (don't retune casually)

- `_TENSION` constants, `SESSION_CAP 8` / `DAY_CAP 12`, `DAMPEN 0.35`,
  `POSITIVE_SCALE 0.75`, fractional `_carry` — tuned against 30-day
  simulations; changing one changes the reachable arc length of a
  relationship. Rerun the 30-day sim before and after.
- `playfulNote` odds (25% + 12/attraction band + 12 hum, cap 60) — wit is
  rationed on purpose; a crafted line lands because its neighbors are plain.
- `_curiosityLean` (0.85×–1.25×, upward only) — curiosity tips the other
  sliders; flattening it re-freezes strictly-friends personas by design.
- Life beats: ~45% of days, 21-day no-repeat, banks of ~12, ONE per prompt,
  suppressed on unresolved nights. More frequent reads as a news ticker;
  much rarer and her life stops running.
- Textures (`_lifeTexture`): the dinner-then-couch layer — evening-gated
  (17:00-02:00), ~65% of evenings, 8-day no-repeat, scenery not topic (one
  mention at most). Authored mundane on purpose: "invent it fresh" produced
  generic inventions, and cute-event-only banks produced the "bake sale"
  complaint. Kid/dependent content stays a MINORITY of any bank and leads
  at most one interests sentence — the weather-not-topic rule is authored
  into the persona so the rare vent lands as real.
- Decay clocks: `unsaid` TTL 3 days, mood break 72h (post-first-exchange),
  memory theme cap 2. Shorter clocks make her forgetful and cold; longer
  ones bring the immortal-theme loop back.
- Rut exemption liveness: exempt if he used it ≥2 times or within his last
  4-6 messages. Widening it re-opens the lifetime-pass blind spot; narrowing
  it starts flagging genuinely shared bits.
- Night norms (`_nightNorm`): closeness×1.2 + attraction×0.8 + type bonus
  (close_friend 1.2 / friend 0.6) + flirt-sport 0.4 − established 1.2;
  tiers at <1 strange / <2.5 notable / else normal. Computed from LIVE bands
  on purpose — hand-authoring "3am is weird for me" onto a persona would
  freeze a thing that must be earnable. Deep-night openers (2-5am) need the
  'normal' tier and roll at 10%; 5am-8am nobody texts first, norms or not.
- Photo framing pools (`_FRAMING`): scene default, pov only on body words,
  mirror only on fit-check words; every framing is faceless by construction
  (head past the frame edge, phone over the face) and the pov pool must stay
  VARIED — near-identical torso shots made every body photo the same photo.
- Floors & reckoning clocks: floors at band lower bounds (0/25/50/75), the
  historic comfort-10 kindness floor kept; significantNote window 1.5-10
  days, unresolved window 14 days, unresolved > significant. Shortening the
  significant window brings back small-talk-past-the-moment; lengthening it
  past two weeks reads as her holding a grudge against calendar time.
