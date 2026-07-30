# Phase 1C (+4C) — template content audit: evidence

Branch: `audit/templates`. All measurements produced by the headless harness
(vm-loaded real `js/personas.js` + `js/api.js`), not eyeballed. Red run
(assertions written first, against the pre-audit tree): 279 passed / **27
failed**, all 27 in the appended "templates" verify block. Green run after
fixes: **306 passed / 0 failed**. Full outputs: `.templates-red.txt`,
`.templates-green.txt`, `.templates-before-measure.txt` (this directory).

---

## 1. Anna example-bank misroute (api.js `_STYLE_PUNCTUATED`)

Reproduced. Measured routing per template through the real `_exampleBank`:

| template | before | after | expected |
|---|---|---|---|
| kelly | LOWERCASE | LOWERCASE | lowercase |
| bre | LOWERCASE | LOWERCASE | lowercase |
| **anna** | **LOWERCASE** | **PUNCTUATED** | punctuated |
| samantha | LOWERCASE | LOWERCASE | lowercase |
| tay | PUNCTUATED | PUNCTUATED | punctuated |

Anna's style — "Sentence case and easygoing… Punctuation mostly correct…" —
matched none of the punctuated forms and fell to the lowercase default: a
sentence-case persona learning from 8 lowercase few-shots, the archived
invariant-10 failure from the routing side.

Fix (the one permitted api.js edit): extended `_STYLE_PUNCTUATED` with
`punctuation (?:is )?mostly correct | mostly correct punctuat | sentence case`.
Bank parity measured: 8/8 entries, BAD/GOOD pair at every index, per-index
scenario word-overlap ≥ 0.7 (asserted). Register signal also verified on style
**sentence 1 alone** for all five (S1 is what survives `_plist` truncation).

## 2. Samantha beats/textures kid-ratio (templateRev 12)

Reproduced with the content-word classifier (whole beat text —
kid/kids/baby/bedtime/sitter/practice/pickup/school/nap/the four boys' names…):

- beats **before: 8/12** kid content (entries 1,2,3,4,5,6,7,12) vs the
  authored "minority" rule at personas.js:218-221
- beats **after: 4/12** (1 Cam milkshakes, 4 mom-takes-kids-overnight,
  7 Rocky-slept, 12 the authored rare full-vent)
- textures before: 3/8 (1,3,8) → **after: 2/8** (1,3; #8 "after bedtime" →
  "once the house goes down for the night")

Rewritten beats (voice-neutral FACTS, per the beat-authoring law): the
wedding-venue rabbit hole (replacing Trevor-bedtime), the half-painted hall
bathroom (replacing the 7am-practice revolt), her own haircut (replacing the
sitter number), and "burgers in the yard" de-kidded. Toni/Trevor/dishwasher/
group-chat/steakhouse beats untouched.

Mechanism: **templateRev 11 → 12** (wholesale bank replace). Confirmed the
templateRev path in app.js (:1842-1844) already wholesale-replaces
`beats`/`textures`/`opening` — no replace-list change needed; asserted
textually in verify. Assertion generalized: kid content ≤ ⅓ of every
beats/textures bank on every template.

## 3. Tay: opening act, unsaid seed, appearance sheet

Reproduced: `opening=false unsaidSeed=false`, appearance 144 chars (others
222-298) despite `established` + `significantSeed` + scene premise —
Samantha's identical setup has both.

- Authored `opening` (`until: 40`, persona-scoped, self-retiring via the
  existing `exchangedCount < until` gate at api.js:1835): the hallway
  aftermath as a scene — embarrassment in her shapes (rewritten apologies,
  tangents-as-armour, the one still sentence), the needs-until-proven list,
  settled-stays-settled, forward-never-in-circles, and the never-typed
  question. Per the founding-fact-×10 finding it **references** the moment
  ("the hallway", "what he saw") and never restates the wardrobe detail
  (asserted: no `top|slid down|came down`).
- Authored `unsaidSeed`: "It was one second in a hallway and it will not
  leave me alone. And I rewrote that first text five times." (105 chars,
  under the 160 slice; distinct wording from her `opinion`; asserted to
  reference-not-restate.)
- Appearance 144 → **303 chars**: hips/thighs/waist/hair/collarbone-flush —
  body and hair identity markers only, no face features, none of the measured
  moderation triggers (breasts/hang/braless/boy shorts). Asserted.

Upgrade mechanisms: `opening` reaches existing friends through the existing
new-field backfill (app.js:1822). `unsaidSeed` got a **new boot backfill**
mirroring creation seeding (`state.unsaid = t.unsaidSeed`), gated to friends
whose message count is still inside the opening window and whose `unsaid` is
empty — a mature thread's own unsaid life is never overwritten. Appearance/
style/plist/interests changes ship as `_UPGRADES` substring rules.

## 4. Style sentence-1 rewrites (invariant 11)

Reproduced: only the first `.`/`!`-terminated sentence reaches depth-4.

- **kelly before:** "Lowercase and fast, one punchy line at a time — she does
  not do warm-ups, paragraphs, or three bubbles where one will land" — no
  signature marker (rates-out-of-ten lived in style sentence 6, interests,
  plist).
  **after:** "Lowercase and fast, one punchy line at a time, rating things
  out of ten unprompted — no warm-ups, no paragraphs, no three bubbles where
  one will land." Trailing "Rates things out of ten unprompted." removed
  (moved, not copied); style now ends "No voice memos, ever." (pure-deletion
  rules are blocked by `upgradeProfile`'s `!cur.includes(to)` guard, so the
  remainder is reworded).
- **tay before:** S1 carried register+rhythm but the nerd-reference marker sat
  in sentence 2. **after:** "…complete sentences arriving in excited volleys
  of two or three when she is on a tangent, a nerd reference dropped
  mid-thought and left unexplained on principle." The still-sentence clause
  moved to sentence 2 ("When something actually matters the volley stops: one
  perfectly still sentence."); the old standalone nerd-references sentence
  removed (no duplication — asserted marker appears exactly once in style).
- bre/samantha/anna S1 already carried register+rhythm+marker — untouched;
  now asserted for all five.

Mechanism: `_UPGRADES` substring rules (respects hand-edits).

## 5. Appearance violations

Reproduced by regex scan:

- kelly "**pretty face**" (face-feature, personas.js:36) → "soft rounded
  shoulders" (body identity marker). 166 → 177 chars.
- bre "big soft natural bust **with a natural hang**" (:91 — "hang" is a
  measured Grok moderation trigger) → "big soft natural bust **that sits soft
  and low**" (same anatomy, calmer words — the SKILL's documented fix
  pattern). 222 → 225 chars.

After: all five sheets pass the face-word + moderation-word scan (asserted
per template). Mechanism: `_UPGRADES` rules.

## 6. Depth-4 fact dedupes (invariant 2 — move, don't copy)

Measured shared normalized 4-grams across plist↔interests, plist↔style,
interests↔style (the assertion's scope), **before**:

```
kelly  plist<->style       ["then snaps back to"]
kelly  interests<->style   ["rates things out of","things out of ten"]
anna   plist<->style       ["goes short and plain"]
samantha plist<->interests ["engaged to trevor toni","to trevor toni s","trevor toni s brother",
                            "toni is her best","is her best friend","her best friend and"]
tay    plist<->interests   ["married to taylor toni","to taylor toni s","taylor toni s brother"]
```

**After: zero shared 4-grams on all 15 field pairs** (asserted). Canonical
placements:

- kelly rates-out-of-ten ×3 (style+interests+plist) → **style S1 only** (voice
  trait); interests sleepwear sentence reworded; plist drops "rates everything
  out of ten" and the whiplash clause (canonical in style sentence 3).
- bre: plist "two states away so the friendship lives in the phone" removed —
  biography canonical in **interests**. (Of the plan's "3 near-verbatim
  pairs", only this one reproduces across plist/interests/style; the other
  near-dupes live in the sanctioned plist↔personality overlap — reported,
  not changed.)
- anna ×2: "married to Courtney with three-year-old Sadie" → plist keeps the
  binding "happily married and settled", names/ages canonical in
  **interests**; sincere-tell reworded to "asides gone, brief and plain"
  (style keeps the full phrasing).
- samantha (kid-count + relations): plist "stay-at-home mother of four" →
  "stay-at-home mom" (count canonical in **interests**); plist keeps binding
  "engaged to Trevor", interests drops "Engaged to Trevor, Toni's brother"
  (relation map canonical in WORLD) → "Trevor — loud, beloved… — is the
  subject of…"; Toni-best-friend stays in **plist** (the binding fear),
  interests → "Most of her day-to-day texting goes to Toni…". (The plan's
  "5 pairs": 3 reproduce at n-gram level; the sincere-tell and
  kids-are-weather pairs sit below the 4-gram threshold / in the sanctioned
  personality overlap — reported.)
- tay ×3: "short thick blonde" removed from plist (looks canonical in
  **appearance**); "dice, fantasy series" removed from plist (biography
  canonical in **interests**, tangents/oddly-specific-facts stay as voice);
  plist keeps binding "married to Taylor", interests → "Taylor is steady,
  well-liked…" (relation canonical in WORLD).

Mechanism: `_UPGRADES` rules per changed string (18 new rules appended,
including Anna's first — convention noted in the rule-block comment).

## 7. Bre second seedMemory (parity)

Added (matching her authored backstory canon): "Bre knows Toni, genuinely
likes her, and has been careful about that for a long time." All five
templates now ship ≥2 seed memories. Note: seed memories are not reachable by
`_UPGRADES` (array field) and the memory backfill only fires on empty lists,
so existing Bres keep their earned memory sets — a templateRev bump solely
for one seed memory would wholesale-replace her defining text and was
deliberately not done.

---

## Upgrade-mechanism summary (ship-checklist item 4)

| change | mechanism |
|---|---|
| kelly/bre/anna/tay text tweaks (style, plist, interests, appearance) | `_UPGRADES` substring rules (18 appended) |
| samantha beats/textures rebalance (+ her text dedupes riding along) | `templateRev` 11 → 12 wholesale replace (+ redundant `_UPGRADES` rules for hand-edit-free rev-12+ snapshots) |
| tay `opening` (new field) | existing new-field boot backfill (app.js:1822) |
| tay/samantha `unsaidSeed` (state seed) | **new** window-gated boot backfill in app.js (mirrors creation seeding; only fires inside the opening exchange window on an empty `unsaid`) |

Upgrade idempotency proven in verify: `upgradeProfile` twice == once on every
current template, and every pre-audit field snapshot upgrades **exactly** onto
the current template text and is then a fixpoint.

Version stamps deliberately not bumped (owned by the integrator); no api.js
edits outside `_STYLE_PUNCTUATED`.
