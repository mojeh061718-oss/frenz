# Phase 3 — Removals: evidence

Branch: `audit/removals` (off `1646557` v10.23). Verify suite: **196 green before**, **223 green after** (27 new assertions in one contiguous `removals` block at the end of verify.js). No version stamps touched.

Red-then-green: the new `removals` verify block, run against the pre-audit engine (HEAD copies of api.js/personas.js), fails **10 assertions** (platonic gate ×4, compact examples ×3, `_UPGRADES` hygiene ×3) and passes fully against the branch. (`backup/v10.23/` does not exist in this worktree's base commit — Phase −1 had not landed here — so the pre-audit reference is `git show HEAD:…`, used throughout.)

Byte-identical live paths: a 46-point comparison harness (scratchpad `bytecmp.js`) assembled `buildPersona` (rich/full/compact), `buildDynamicContext`, `_plist`, `_phi` for all five templates, plus `upgradeProfile` on unstamped current-template snapshots, `_bandRank` over its full domain, and `_skipReason`/`_effectiveBudget` on both live presets, old engine vs new. **Only diffs: the five compact-tier personas** (+719–738 chars each — the sanctioned example restoration). Everything a production request reads is byte-identical.

---

## 1. Anthropic path — REMOVED

**Unreachability proof.** `db.js` `Settings.get()` filters the pool on every load: `s.pool = s.pool.filter(e => e && e.kind !== 'anthropic' && RETIRED.indexOf(e.preset) < 0)` — no `kind:'anthropic'` entry can survive into `activeEntries()`, so `_sendEntry`'s fallthrough to `_sendAnthropic` could never fire for an anthropic entry. Full pre-deletion reference list for `anthropic|claude-opus` in js/ (grep, pre-edit): api.js:235 (`_isCapableModel`), 2114 (`entryConfigured`), 2242 (`_entryKeyed`), 2993–3130 (`_sendEntry` fallthrough + `_sendAnthropic`, 135 lines / 5,748 chars net), 4969–4988 (`_plainCompletion` anthropic fallback — the plan's "listModels ~:4969" actually lands in `_plainCompletion`; `listModels` itself at 5031 had no anthropic branch), 5150–5191 (testConnection Bedrock-Claude dialect), 5208–5230 (testConnection anthropic tail); db.js:148 (DEFAULT_SETTINGS), 169 (the filter itself, kept).

**One honestly-reachable edge, removed deliberately:** a Bedrock entry whose *hand-typed* model id matched `/claude/i` (`_bedrockIsClaude`) routed to `_sendAnthropic` with `bedrock=true` (Mantle's Anthropic dialect). Not offered anywhere in the UI (the Bedrock datalist ships only `xai.grok-4.3`), unsupported by the Grok-only product, and the plan calls for deletion either way. After removal every Bedrock entry rides `_bedrockOaiEntry` → the OpenAI-compatible Mantle route, in `_sendEntry` and in `testConnection` alike. `_bedrockIsClaude` deleted (both call sites gone).

**DEFAULT_SETTINGS `apiKey`/`model`/`effort` removed.** Reader census before removal: `settings.apiKey|settings.model|settings.effort` appeared ONLY in the deleted paths (api.js 236, 2114, 2242, 3010/3015/3055, 4973/4978, 5209–5230). The Settings UI binds per-entry fields only (`e.apiKey`, `e.model` — app.js 2026–2046); index.html has no top-level key/model/effort inputs; verify.js never reads them. `_isCapableModel`'s `settings.model` fallback removed with its only-caller updated (`_buildPlainRequest` passes the entry).

**`_plainCompletion`**: non-openai entries are now skipped outright. Behavior-identical for live pools: a Bedrock-only pool previously made a doomed keyless call to api.anthropic.com → 401 → `continue` → returned null; it now returns null without the wasted round trip. KNOWN GAP preserved and documented in-code: scene-record completions still don't work on Bedrock-only setups; routing them through `_bedrockOaiEntry` is a one-line behavior *change* left for an engine pass.

**Stale copy fixed with the path:** app.js Bedrock model hint ("Claude models are listed…" — the datalist lists only Grok) and api.js's "same handling as an Anthropic refusal" / "prompt-caches on Anthropic" comments.

## 2. `_UPGRADES` hygiene — REMOVED (13 rules) + GUARDED

**Orphans: 11 rules, not the plan's 12.** Exact census of pre-audit `_UPGRADES` (86 rules total, matching the plan's denominator): Bre 29, Samantha 29, Kelly 9, Tay 8, orphans 11 — Roz ×2, Claire ×1, Priya ×1, Elena ×1, Jules ×1, Nat ×1, Megan ×2, Kate ×2. All 11 target personas absent from `templates` (grep for each name post-deletion: zero hits). Deleted surgically by exact rule match (regex anchored on `name`+`from`+`to`), array order otherwise untouched, no renumbering — safe to merge against the parallel audit/templates agent, which appends at the tail.

**"Twelve years" Bre rules (2): dead, then deleted.** Rules `from:'Best friends since sophomore year of college.'` and `from:'A decade of every embarrassing story since'` both target `backstory`. Gate trace: in `upgradeTemplateFriends` (app.js), `upgradeProfile` runs at the top of the per-friend pass and the `templateRev` wholesale-replace runs *below it in the same pass* (rev 11 > any legacy rev), overwriting `backstory` from the current fifteen-year template before the single `DB.saveFriend(f)` at the loop's end — so the two rules' output can never survive to disk. Current template text is fifteen-year canon ("Best friends for fifteen years, since college… Fifteen years of every embarrassing story"). The other `twelve`-mentions in Bre personality/plist rule chains are live upgrade-chain links and were left alone (out of scope).

**Template-identity guard.** `app.js` did NOT record template origin at creation (profile carried `templateRev` but no id), so per the scope's contingency: creation now stamps `profile.template = t.id` (gallery) / `'custom'` (blank editor; the editor's edit path MERGES, so stamps survive edits). `upgradeProfile` skips any rule whose template id contradicts a present stamp; unstamped legacy friends keep the historical name match — **residual risk, documented in-code**: a pre-stamp hand-built friend named e.g. "Bre" can still match, mitigated by the from-strings being long verbatim template prose. The same veto (stamp can only VETO the name match, never add one) was applied to `upgradeTemplateFriends`' template lookup — otherwise the guard would be cosmetic: the rev-11 `templateRev` wholesale-replace would still bulldoze a stamped custom "Bre" far worse than 29 substring rules; renamed-template-friend behavior is unchanged (they matched nothing before and match nothing now).

## 3. Pure dead code — REMOVED (with reference proofs)

| Item | Proof of deadness |
|---|---|
| `RETIRED_PRESETS` (api.js:145) | Sole grep hit outside its definition: none. db.js carries its own local `RETIRED` list (kept, it's the one that runs). |
| `_OBJECT_SUBJECT` + rationale comment (api.js:2553–2559) | Zero references (grep `_OBJECT_SUBJECT`: definition only). `_modeFor` defaults to `'scene'`, which is the behavior the comment claimed this regex provided. |
| photo `seed` option + comment (app.js:948–951) | `_generateImage` reads `o.width/height/mode/raw/appearance/heat/quality` — never `o.seed`; neither xAI body (`prompt/n/aspect_ratio/response_format`-shaped) nor Nova body carries a seed. The "same body and the same rooms" consistency claim was false; replaced with an accurate note (appearance sheet + faceless framings are the anchors). Companion comment fix at api.js `_FRAMING` ("seeded per photo (see generateImage)" → deterministic description hash, see `_frame`). |
| `hints.contextCap` (api.js:3268) | No preset defines `contextCap` (grep: the one read site only). Cerebras — the cited example — was retired from `POOL_PRESETS`. |
| `hints.rpd`/`tpm` in `_skipReason` (api.js:2253–2254) | Both live presets ship `rpd: null, tpm: null` (api.js:129/139). Branches unreachable; deleted. Siblings intentionally KEPT: `entryAvailable`'s identical guards and `usageInfo.rpdHint` (status-line plumbing) were not in scope — noted for a future pass. |
| `splitSticky` (api.js:3173–3178) | No preset defines `splitSticky` (grep: definition-site reads only). `sticky` was therefore always false; the `!sticky` qualifier collapsed. (`splitDefault` at `_modeRec` is equally preset-less but out of scope; noted.) |
| db.js:46 `result._value` | Grep `_value` across repo: this line only. Every `_tx` callback returns an IDBRequest; `.result` is the only live leg. |

## 4. Unreachable-branch repairs — FIXED GATES, BEHAVIOR KEPT

**`_FLIRT_TEXT` "tension" (api.js:284).** Reproduced: `/…|tension|…/` matched plain prose ("hates tension at work"), so `_isPlatonic` returned false for any hand-built friend whose text used the word at all — the invariant-7 platonic door was welded shut. (For the five shipped templates the regex was moot: Kelly fails on flirtiness 85, the others on type.) Narrowed: bare `tension` removed; `(?:romantic|charged|unspoken|unresolved) tension|tension between` added so relational tension still counts ("sexual tension" already matched via `sexual`). Both directions asserted in verify: all five templates still charged AND carrying `## Pace`; a hand-built plain-prose friend (type friend, flirtiness 20, attraction band low, the word "tension" in her personality) passes `_isPlatonic` and her persona contains `## Being a good friend` and not `## Intimacy, if it gets there`; counter-case: the same friend at flirtiness 85 stays charged (invariant 8's ambiguity bias untouched — the gate still reads only stable properties).

**`curiosityNote` q<25 (api.js:~4753).** LIVE, not dead: the customize UI ships a 0–100 curiosity slider for every type (app.js `SLIDER_DEFS`), so custom incurious friends reach it; all five templates author curiosity ≥ 55, so no shipped persona does. Documented in-code (including the `_noQuestionStretch` exemption that keeps the two from contradicting); branch kept.

**`full` tier + compact examples.** `full` kept as the documented weak-model fallback; its unreachability in the shipped pool (every live model matches `_CAPABLE_MODEL`) is now stated in the `_isCapableModel` design comment. The compact contradiction resolved WITH the comment: `_exampleSetFor('compact')` returned `[]` while both the bank comment ("On the compact tier only the first three ship") and the capability essay (weak models need the failure spelled out) said otherwise. Compact now ships the first three of the **register-matched** bank (those three were authored to cover interview-bot AND dry-nothing; register match preserves invariant 10). ~719–738 chars against a ≥8k-token budget. Asserted: count, identity (first three), register routing (Tay → punctuated bank), presence in the assembled compact persona, and rich-tier count unchanged.

## 5. db hygiene — FIXED

- `wipe()` now clears `outbox` (a parked send survived a full wipe and would deliver a ghost reply into a fresh install's first boot).
- `deleteFriend()` now deletes the friend's outbox records (matched on `rec.friendId`; records are written with it at app.js `putOutbox`; store has no byFriend index so it's a tiny `getAll` scan).
- `importAll()` idempotent by content identity: messages keyed `friendId+ts+role+text+photoDesc` (photoDesc folded in so two captionless photos in one second stay distinct), events keyed `friendId+ts+kind`, NUL-joined (the `\u0000` separator, so field boundaries cannot collide); existing keys skipped, and duplicates *within* one backup file (artifacts of a previous bad re-import) collapse too. Known accepted edge: two genuinely distinct events with identical friend+ms-timestamp+kind would dedupe — not producible by the app (each event follows a network round trip).

## 6. Stale comments — status

| Claim | Action |
|---|---|
| "6144 reserve" vs 7424 (api.js:~3313) | Reproduced; comment now says 7424. |
| "compact ships first three" vs `[]` (api.js:162–168) | Resolved by the §4 code fix — the comment is now TRUE and unchanged. |
| "six enumerated prohibitions / six worked examples" vs eight (api.js:~220) | **Did not reproduce — kept as is.** The banks hold 8 entries, but the comment counts what a weak model *sees*: the cardinal-rule list is exactly 6 bullets, and the full tier ships exactly 6 examples (`pick(interview,4)+2 dry`). |
| humming "survives reloads" (api.js:~1400) | **Left for the integrator** per instruction: the parallel audit/engine agent is fixing `applyStateDeltas`' failure to copy `state.humming`; once that lands the line is correct. (On this branch alone it is still wrong — flag at integration if the engine fix didn't land.) |
| flirtiness-55 claim (personas.js:~404–406) | Reproduced (sliders now 85/60/40/45/50 across five templates — none at 55, not "three of four"); reworded timelessly. |
| undocumented curiosity slider (personas.js:1–6) | Reproduced; header now lists curiosity, including its live engine read. |
| `_bandIndex`/`_bandRank` (api.js:503/1370) | Unified: `_bandRank` now derives from `_BANDS` (findIndex over keys) — one ordering source; full-domain equivalence checked in the byte-compare harness (`low/building/high/deep/unknown/''/undefined`). |

## 7. README — REWRITTEN

Anthropic key/model/effort instructions and the Claude model table dropped; now describes the real product: Grok via xAI or Bedrock (no-failover rationale included), the personas gallery + sliders, she-texts-first openers, life beats/textures, relationship floors, photos + `testlook`, the analysis archive, idempotent backup import, PWA install. 41 → 46 lines.

## Skipped / not reproduced (reported per mandate)

- **`friend.stateReseeded` (app.js:1912–1919): KEPT — the "permanent dead branch" claim did not reproduce.** Grep shows *no* install path sets the flag (only the migration itself does, after running once): every newly created friend enters the branch on first boot, and the migration is still load-bearing for imported pre-fix backups. For fresh default-slider friends it is a no-op save; but a romantic friend whose user LOWERED the attraction slider below the template default gets silently lifted back on first boot — a live (mis)behavior deletion would have changed. Now bounded by the template-identity veto (§2) for stamped customs; the slider-override wrinkle is flagged for the engine phase.
- **"12 orphan rules"**: actual count 11 (census above); total pre-audit rules 86 as planned, 73 after.
- **"six … vs eight" comment**: accurate as written (see §6).
- `entryAvailable` rpd/tpm guards, `usageInfo.rpdHint`, `splitDefault`: same deadness class as the removed hint branches but not in scope — left, noted.
