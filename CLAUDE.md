# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## What this is

**Variable-input templates for the label description field** on the Constructions Tagger
annotation platform (`constructions-tagger-web.onrender.com`) — a client-side add-on pasted into
the browser DevTools console, injected into the host app's own `#label-modal` (Create **and**
Edit). Annotators fill a handful of small fields (material, keyword, source, top/bot elevations,
thickness, ...) instead of typing the whole free-text description by hand every time; a live
preview shows exactly what will be written; **Fill Description** writes it into the host's own
`#label-description` textarea. The human always reviews the text and clicks the app's own
**Save** — this add-on never submits the form and never touches `annotationState` directly.

Standalone sibling to `boon-tagger-mask`, `boon-command-line`, `boon-ocr`, and
`boon-label-management` (all under `~/Projects/boon-projects/`) — no coupling to any of them.
`rw_descbuilder.js` is the whole loader: own bootstrap, own install flag, own DOM subtree
(`#rw-db-*` ids throughout). It **ports** `boon-ocr`'s modal-injection machinery (its own
`#label-modal` `MutationObserver` + create/edit title gate) rather than depending on that repo —
matches this whole family's standing rule that no sibling loader is required to have run first or
last, in any combination.

There is no `package.json`, linter, or CI — matching every sibling repo. `node --check` plus the
synthetic harness `verify_desc.js` is the whole verification story.

## Build / verify commands

```bash
bash build_loader.sh          # rebuilds desc_loader.js (runs node --check on the result)
node --check rw_descbuilder.js
node verify_desc.js           # synthetic harness — 227 tests, all passing
```

To actually verify a change works, it has to be pasted into a real annotation-job page in Chrome
— see "Live verification" below.

## The template engine

`{name}` curly-brace placeholders, deliberately **not** `[name]` — the house description format
already uses literal square brackets (`height: [-12'-0"] - [-14'-0"]`), and `{}` never collides
with that. `RW._dbParseTemplate(text)` scans a template for every placeholder in first-appearance
order, deduplicated; `RW._dbRender(template, values)` substitutes them, never throwing. Two
derived names are excluded from the auto-generated field list and can never be typed as a new
custom variable name either: `span` (the computed top/bot difference, wired in by the UI layer)
and `a` (the a/an article).

- **Modifiers**: `{name:lower}` / `{name:upper}` / `{name:title}` / `{name:brk}`; an unrecognized
  modifier passes the value through unchanged, matching this codebase's house discipline for
  string transforms (`boon-label-management`'s `RW._lblBuildFindMatcher` never throws either).
  `:brk` (round 4) is the one modifier that's **losslessly invertible** — see "Bracketing
  elevations" below and `RW._dbModifierInvertible` — which is exactly why the reverse parser can
  still trust a `{top:brk}` site the same as an unmodified one, while `:lower`/`:upper`/`:title`
  destroy the original casing and can't be trusted back.
- **`{a}`** resolves to "a"/"an" from whatever word ends up immediately after it — a genuine
  two-pass render, since that word isn't known until every other substitution around it has
  already happened. A leading digit run resolves by its *spoken* first word: 8/eight, 11/eleven,
  18/eighteen, and anything starting with those digits (80, 180, 800, ...) all read as vowel-sound
  → "an"; everything else → "a". Exceptions (`hour`, `unit`, ...) live in the console-overridable
  `RW._dbArticleOverrides`.
- **A blank value never drops its line.** `thickness: {thickness}` with an empty `thickness`
  renders `thickness: ` — present, just empty. This was an explicit decision (see the plan this
  repo was built from): the annotator's one-click **NS** button writes a literal `NS` into a field
  precisely because lines are never silently removed.
- **`{{`/`}}`** escape to a literal single brace.

## Feet-inches and the `{span}` fallback

`RW._dbParseFtIn` accepts `12'-0"`, `12'-6"`, `12' 6"`, `12'`, `6"`, `12'-6 1/2"`, `1/2"`, with an
optional leading `-`/`+`; it returns `null` for a bare number (ambiguous) and for anything else —
that `null` is the exact signal `RW._dbSpan` uses to fall back to a datum-name join instead of
arithmetic, since `top`/`bot` are genuinely free text: sometimes elevations (`-12'-0"`), sometimes
datum names with no unit marks at all (`T/WALL`, `T/FOOTING`). `RW._dbSpan(top, bot, override)`'s
decision table, in order: an explicit **Override** always wins; both sides parse → real
subtraction via `RW._dbFormatFtIn`; both present but not parseable → `"top to bot"`; only one side
present → that side alone; neither → blank. No metric arithmetic — `Override` is the deliberate
metric escape hatch (type `600mm` directly), not a unit converter.

## Bracketing elevations (`:brk`, round 4)

The measurement line is `{word}: {top:brk} - {bot:brk}`, not literal `[` `]` — `RW._dbBracketIfNegative`
(the function `:brk` calls through `RW._dbApplyModifier`) brackets a value **only** when it parses
as feet-inches (`RW._dbParseFtIn`) **and is negative**: `-12'-0"` → `[-12'-0"]`, but `12'-0"` → bare
`12'-0"`, and a datum name (`T/WALL`) or `NS` — neither of which parses as feet-inches at all —
also render bare. The brackets exist for exactly one reason: to keep a leading minus sign from
being misread as the `" - "` separator between top and bot (`-12'-0" - -14'-0"` is unreadable;
`[-12'-0"] - [-14'-0"]` isn't) — a positive elevation needs no such protection. `:brk` is
idempotent (strips one existing bracket layer before deciding, so re-rendering an already-bracketed
value never accumulates `[[...]]`), which matters because the reverse parser below always recovers
`top`/`bot` unbracketed and Fill re-brackets on every write.

Before round 4 the brackets were literal template text and appeared on *every* value regardless of
sign — a real, if minor, bug (a positive elevation rendered `[12'-0"]` for no reason). Fixed
alongside the reverse parser below because the parser has to understand both forms either way; a
description written under the old always-bracketed template still parses correctly (`RW._dbBuildLineMatcher`'s
`:brk` capture accepts a bracketed *or* bare token).

## Reverse parser: prefilling an existing description on "Edit Label" (round 4)

Opening "Edit Label" now reverse-parses whatever description is already in the textarea back into
the builder's fields, via `RW._dbParseDescription(templateText, descText)` — a genuine feature
reversal from round 1's original choice (see "Injection" below, and `RW._dbReadPrefill`). This is
**not a general inverse of `RW._dbRender`** — see "What genuinely cannot be recovered" below — but
a best-effort reverse parse that recovers what it safely can, reports what it couldn't, and never
pretends otherwise.

**The load-bearing observation**: every field value comes from a single-line `<input>`
(`buildFieldRow`), so a value can never contain a newline. Therefore **one template line always
renders to exactly one description line, in order**, and matching happens per line, never across
`\n` — this bounds every regex to one short line (the real backtracking defense) and means a
hand-edited word on one line never costs recovery of the others, unlike a single whole-template
regex, which is all-or-nothing.

**The pipeline**, in order:
1. `RW._dbTokenizeTemplate(text)` — one array of `{literal}`/`{var}` tokens per template line.
   Unlike `RW._dbParseTemplate`, this **keeps** the derived names `span` and `a` as var tokens —
   they never become fields, but a line mentioning one still has to match against it.
2. `RW._dbSlotScore(leftLit, rightLit, modifier)` — scores how trustworthy one occurrence of a
   name is: a line-edge or real neighboring text scores highest; a boundary that abuts only
   another placeholder (nothing but whitespace between them) scores 0 — that's the ambiguous-run
   shape (`{a} {thickness} {desc:lower} {keyword:lower} with the`) this whole design routes
   around. A name whose only occurrence is a whole line by itself (`{source}` alone on line 2)
   scores just **1**, not "two strong edges" — its regex matches literally *any* line, so alone
   it's evidence of nothing. `:lower`/`:upper`/`:title` disqualify a site from the +10 unmodified
   bonus; `:brk` doesn't (see above).
3. `RW._dbBuildLineMatcher(tokens, known, loose)` — compiles one line into an anchored regex. A
   name already in `known` (resolved by an earlier pass) compiles to a **literal** — run through
   the same `RW._dbApplyModifier` the renderer uses, so it's byte-identical to what render
   produced — instead of another capture group. This is the mechanism, not scoring alone, that
   resolves the ambiguous explanation line once its neighbours are pinned down elsewhere.
4. `RW._dbParseDescription` runs this **three times**: pass 1 with no outside knowledge (recovers
   every well-anchored line, e.g. lines 1-4 of the default template); arbitrate the winners into
   `known`; pass 2 re-tries with `known` substituted as literals (this is what finally lets the
   explanation line match, once `thickness`/`desc`/`keyword`/`word`/`source` are all pinned down,
   leaving only `span` and `where` as real captures); pass 3 is a **loose** fallback (every
   remaining capture lazy, capped at 4 lazy slots) for whatever a degraded/custom template still
   leaves recoverable, tagged `weak`. If the description's line count doesn't match the
   template's, a monotonic forward alignment scan runs first so a hand-inserted extra line
   doesn't shift every later line out of step.
5. **The false-positive guard**: if **no** non-wildcard template line ever matched at all, every
   candidate sourced only from a whole-line-wildcard placeholder is discarded. This is what makes
   an unrelated hand-written description (`verify_desc.js` test 12's own fixture) recover
   *nothing*, rather than reading its first line as `source`.

`RW._dbReadPrefill(modal, templateText)` is the DOM-facing entry point: reads `#label-description`
(same selector `RW._dbRunFill` uses), parses it, and applies whenever **anything** was genuinely
recovered (`RW._dbPrefillMinConfidence` defaults to `0`, console-overridable, in the style of
`RW._dbArticleOverrides` — see "A confidence gate that was too strict" below for why it isn't
higher by default). `applyPrefill` (private to the reset-fields section) is the **one** place a
prefill becomes visible state — shared by the fresh-open path and the **Re-read** button, so the
two can never drift apart, the same discipline that keeps the preview and Fill on a single
`RW._dbComputeOutput`. The inline status row (`#rw-db-prefill-wrap`, visible in Simple mode too)
reports what was read, what's blank, what to double-check, and — via `RW._dbComputeOutput()`
compared byte-for-byte against the original — whether Fill will reproduce the description exactly
or reword it, so an annotator whose hand-added sentence is about to be dropped is told so before
they click.

**A recovered manual span Override is inferred, not read from a dedicated field**: `{span}` stays
derived, so `RW._dbParseDescription` still captures whatever text stood where it rendered, and if
that text differs from what `RW._dbSpan` would recompute from the recovered `top`/`bot`, it's
treated as an Override and `RW._dbSpanOverridden`/`RW._dbSpanOverrideValue` are set — **after**
`applyPrefill`'s own clearing of those same flags, not before (the ordering that matters — see the
spot-check below). A known false positive: an equivalent but differently-formatted measurement
(`24"` vs `2'-0"`) also reads as an "override"; conservative in the safe direction, and the ✕
button on the span row reverts it in one click.

### What genuinely cannot be recovered

- **Original casing under `:lower`/`:upper`/`:title`.** The default template gives every name an
  unmodified site, so this doesn't bite today; a custom template where `{desc}` appears *only* as
  `{desc:lower}` recovers `concrete`, not `Concrete` — tested (`16h`), not papered over. No
  title-case "repair" heuristic — it would corrupt `CMU`, `T/WALL`, `NS`.
- **`{a}`** — derived, no loss: recomputed identically from the recovered following word.
- **`{span}`** — recoverable only as an inferred override string (above).
- **Text the template can't represent.** A hand-added sentence isn't in the model, so Fill would
  silently drop it — defended structurally, not through the parser: `#rw-db-prefill-status` says
  "Fill will reword this description" whenever the byte-for-byte check fails.
- **A value containing its own surrounding literal** (a `desc` containing ` - `) — the lazy
  capture mis-splits; not defended. The `:brk` change *reduces* this class for `top`/`bot`
  specifically, since a bracketed capture no longer needs to guess where the value ends.
- **Which of several disagreeing sites is "right"** when they conflict — the best-anchored one
  wins, the name is listed in `result.conflicts` (report-only; not currently surfaced in the UI).

### A confidence gate that was too strict (caught before shipping)

The first draft gated `RW._dbReadPrefill`'s `applied` decision on `result.confidence >=
RW._dbPrefillMinConfidence` with a default of `0.4` (roughly: at least 2 of the default template's
4 well-anchored lines had to match). This rejected the very case the user asked for — a
2-line-only fragment (`desc`/`keyword`/`source` recoverable, everything else genuinely absent)
scores `0.25` confidence and was silently declined entirely, fields staying blank with no
indication why. Caught by this round's own spot-check discipline (a seam test's own precondition
failed) before it ever reached a live page. Root cause: `confidence` and the false-positive guard
in step 5 above were doing the *same* job — for any template where every line carries some literal
text (every line of the default template does), a name can only ever be recovered from a
non-wildcard line, and any non-wildcard match already flips the false-positive guard's condition —
so gating on confidence *on top of* that guard didn't add safety, it just made partial recoveries
too easy to reject. **Fixed** by defaulting `RW._dbPrefillMinConfidence` to `0` — apply whenever
anything is genuinely recovered — while leaving the knob itself in place, console-overridable, for
an annotator who'd rather see nothing than a lightly-anchored partial guess.

## Simple / Advanced

**Simple is the default**: generated fields (in template order), the `span` row, the live preview,
and **Fill Description** — nothing else, so the everyday case is a handful of inputs and a button.
**Advanced** additionally reveals the template textarea and an add-variable row (name + value +
**Insert**, which splices `{name}` into the template at the caret and seeds the new field with the
typed value in one action — refusing a malformed name, a derived name, or a duplicate, reported
inline rather than silently ignored). The mode is in-memory only, matching this whole family's
no-persistence-across-reloads convention, but does survive a modal reopen within the same session.

## Injection (ported from `boon-ocr`)

Read `boon-ocr/rw_ocr.js` (`isModalCreate`/`modalTitleText`/`modalVisible`, `injectField`,
`RW._ocrMaybeInject` + its two-observer setup) before touching this section — the pattern here is
a direct port, not a reinvention:

- **Install flag on its own global**: `window.__RWdescInstalled`, not a property of `__RW`.
  `boon-tagger-mask`'s `rw_install.js` replaces `window.__RW` wholesale, which would wipe a
  `vdesc` marker on the shared namespace and let a re-paste register a second set of observers.
- **Gate**: `#label-modal` whose `#label-modal-title` reads **either** `"Create New Label"` or
  `"Edit Label"` — unlike `boon-ocr`'s create-only rule for its own fields. `modalIsEdit(modal)`
  distinguishes the two titles for one purpose only: "Edit Label" also reverse-parses whatever
  description is already there (`RW._dbReadPrefill`, see "Reverse parser" above) — round 1's
  original blank-on-edit choice was reversed in round 4, since it made correcting one field of an
  existing label mean retyping every field by eye off the rendered text.
- **Two observers**, exactly `boon-ocr`'s pattern: a `MutationObserver` on `#label-modal` itself
  for `class`/`hidden`/`style` when it exists at install; otherwise one on `document.body`
  (`childList` + `subtree`) for the modal built lazily on first use.
- **Reset on every hidden→visible transition** — not just at install. A stale value from the
  label that was just closed must never bleed into the next one, whether that next modal is a
  fresh "Create New Label" or a same-session "Edit Label" on a different entry. This is
  `RW._dbResetFields(modal, prefill)`, which calls `applyPrefill(prefill)` → `RW._dbRebuildFields(false,
  seed)` — the `false` matters: the same rebuild function is also what a template edit calls (with
  no `preserve` argument, defaulting to `true`) to *preserve* values whose names survive the edit,
  and reusing the preserving path for a fresh modal open was a real bug caught in round 1's own
  spot-check (below). `seed` (round 4) is how a prefill's recovered values reach the inputs without
  a second rebuild function to keep in sync with `preserve` — same precedent, same reason.
- **Mount point**: `descInp.insertAdjacentElement('beforebegin', root)` — directly above
  Description, never touching `boon-ocr`'s own controls (which mount `afterend`, on the far side).
- **Style**: one injected `<style id="rw-db-style">` setting both `color` and `background`
  explicitly on every field — the lesson of `boon-label-management`'s own round 2 (Tailwind
  preflight's `color:inherit` produced invisible white-on-white fields there); the host modal here
  is light, so this repo's values are dark-on-white, but never inheriting either half is the rule
  that actually matters.

## Design invariants

- **Never write `annotationState.labels[i].description` directly, and never click
  `#label-submit-btn`.** This add-on only ever sets the DOM field inside the host's own
  already-open modal; the host's own `handleLabelCreate` does all the real bookkeeping
  (`hasPendingChanges`, `modifiedLabels`, `editHistory`, canvas/sidebar refresh) when the human
  submits. Strictly safer than `boon-label-management`'s own drive-the-form batch-commit path
  (see that repo's CLAUDE.md round 8) — this repo needs no `window.session` bridge at all, since
  it never mutates the catalog itself.
- **Own DOM only** — every id is `rw-db-…` prefixed. Must coexist with `boon-ocr`'s controls
  already injected next to the same `#label-description`, in any paste order (verified — see
  below).
- **No `fetch`/XHR to any backend endpoint. Page-scoped, console-injection only.**
- **What the preview shows is exactly what Fill writes.** The preview and the write-back share one
  function, `RW._dbComputeOutput`, so there's no way for them to drift apart.
- **A non-empty textarea needs a second click.** `RW._dbRunFill`'s two-click overwrite guard
  protects a hand-written description from being clobbered by one stray click on Fill. Deliberately
  **left unchanged in round 4**: on "Edit Label" the textarea is always non-empty, so Fill always
  needs two clicks there, prefill or not — the guard's intent (protect text this add-on didn't
  author) still holds even after an exact prefill, since the parse may have silently dropped
  something. `RW._dbPrefillBaseline` (set only when the preview reproduces the original
  byte-for-byte) would let a future round relax this to "confirm only when the textarea holds text
  the builder can't account for" without weakening the guard's intent — not done here, by choice.

## Round 1 (this round) — build + live-verification status

Built from scratch per the approved plan (`~/.claude/plans/take-alook-at-...md` at authoring
time) — no prior rounds exist yet.

**A real bug caught by this round's own spot-check discipline, before shipping**: the first draft
of `RW._dbResetFields` called the plain `RW._dbRebuildFields()` (preserve-values-by-name, the
correct behavior for a template edit) — which meant a fresh modal open silently inherited the
*previous* label's `top`/`bot`/etc. values by name, since nothing distinguished "the same field
names still exist after an edit" from "a brand-new modal opened." Fixed by giving
`RW._dbRebuildFields` a `preserve` parameter (default `true` for the template-edit path;
`RW._dbResetFields` passes `false` explicitly) rather than writing a second rebuild function to
keep in sync. Caught by `verify_desc.js` test `9k` (hidden→visible clears the field) before this
round ever reached a live page — see "spot-checked" below.

**A second bug, in the test harness itself, not the module**: the hand-rolled DOM stub's
`removeChild` only unregistered the removed node's *own* id from the id registry, not its
children's — so `document.getElementById('rw-db-field-keyword')` kept finding a field input whose
row had already been detached and thrown away. Real `getElementById` only ever finds a node
connected to the document; the stub's `removeChild` now walks and unregisters the whole detached
subtree to match. Caught by test `10b` (a removed name's row is gone).

**Spot-checked, per this repo's own convention**: reverted the `RW._dbResetFields` fix (called
`RW._dbRebuildFields()` with no argument again) and confirmed *exactly* test `9k` failed, nothing
else; restored. Separately reverted the harness's recursive-unregister fix and confirmed *exactly*
test `10b` failed, nothing else; restored. `node --check` passes on both `rw_descbuilder.js` and
`verify_desc.js`; `desc_loader.js` rebuilt clean (see `build_loader.sh`'s own byte-count echo).

**`verify_desc.js` — 100 tests, all passing.** Sections: (1) `RW._dbParseFtIn` every accepted
form/sign and every rejected form; (2) `RW._dbFormatFtIn` whole/exact/fractional/zero; (3)
`RW._dbSpan`'s full decision table; (4) `RW._dbParseTemplate` order/dedup/derived-exclusion/`{{`
escaping; (5) `RW._dbRender` every modifier, unknown-modifier passthrough, unknown-variable →
empty, brace escaping, and the load-bearing "blank value keeps its line" case; (6) `{a}` resolution
across vowels/consonants/digit table/overrides/`:title`; (7) the **headline test** — the default
template plus the sample values from the plan render the target description **byte-for-byte**; (8)
the datum-name variant plus a `height`→`depth` word swap touching every mention at once; (9)
injection idempotency, both Create and Edit gating, a hidden/non-matching modal being skipped, the
lazy `document.body` fallback, and the hidden→visible reset (this round's own regression guard);
(10) field-rebuild preserving surviving values on a template edit and dropping removed ones,
(10b) the Simple/Advanced toggle including surviving a modal reopen, (10c) add-variable insertion
at the caret and over a selection, plus every refusal case (bad name, derived name, duplicate); (11)
Fill's exact write-back, its `input`+`change` dispatch, and the load-bearing "never clicks
`#label-submit-btn`, never touches `annotationState`" guard; (12) the overwrite-confirm two-click
gate; (13) the style tag's idempotency and that it names both a background and a color; (14)
cross-tool independence — a fake `boon-ocr` button already sitting next to `#label-description` is
left completely untouched and no id collides.

**Not yet live-verified**: the panel actually appearing correctly positioned and legible inside the
real `#label-modal` on a real annotation page; that `descInp.insertAdjacentElement('beforebegin',
...)` lands exactly where intended in the real, Tailwind-styled modal DOM (rather than the stub's
simplified sibling-list model); real mouse/keyboard interaction with the datalist suggestions,
which the stub only exercises via a plain `setAttribute('list', ...)` call, never a real
`<datalist>` render; whether `hasPendingAnnotationChanges()` flips `true` after a real Save
following a Fill (expected, since this add-on drives the exact same textarea + dispatched events
the host's own typing does — but not yet directly observed); and cross-tool coexistence with
`boon-ocr`'s and `boon-label-management`'s *real* shipped loaders pasted in every order (section 14
above proves it against a synthetic stand-in for `boon-ocr`'s button, not the genuine artifact).
The live-check steps in `README.md` are the template for closing this gap on the real job the plan
names (`387f32c5-2cfd-4388-b6e5-e2b17bc4ac7a` / `e1ef6f3f-befd-4271-a8ac-5b68d4054b21`).

## Round 2 — a real bug on the very first live paste: raw control bytes in the shipped source

Reported live, first attempt at the job named above: pasting `desc_loader.js` produced no visible
error banner beyond an unrelated Chrome DevTools console-history storage-quota warning, and the
builder never appeared once a label was opened. Diagnostic commands run in the console (checking
`window.__RWdescInstalled`, `window.__RW.vdesc`, and calling `RW._dbMaybeInject()` directly)
showed the module had never installed at all — `window.__RW` had no `_dbMaybeInject` to call.
Asking for a fresh paste in the same tab surfaced the real error: `Uncaught SyntaxError: Invalid
or unexpected token (at VM…:167:62)`.

**Root cause, confirmed by reading the exact byte at that reported line/column**: `rw_descbuilder.js`
shipped with five string literals containing **literal raw control bytes** instead of the plain
printable text they were meant to hold — `OPEN_SENTINEL`/`CLOSE_SENTINEL`/`ARTICLE_SENTINEL`/
`ARTICLE_END` each carried a stray `0x01` byte alongside (or instead of) their intended text
(`'RWDB-OPEN'` etc.), and `RW._dbParseTemplate`'s own `{{`/`}}`-neutralizing line used a raw `0x00`
(NUL) where a plain space `' '` was intended. Column 62 of the reported error line landed exactly
on that NUL byte. This is an authoring defect from when the file was first written, not something
introduced by the copy/paste itself.

**Why nothing caught this before a live paste**: `node --check` passed and `verify_desc.js` ran
100/100 green against the very same corrupted bytes — V8's own parser (both Node's and, evidently,
whatever generated that particular error) tolerates a raw `0x01`/`0x00` inside a string literal;
it's valid, if highly unusual, JS. The failure mode is specific to **pasting into a live browser
console**: a raw NUL byte mid-string is exactly the kind of thing a clipboard/paste pipeline can
silently truncate or mangle, which is the most likely reason the *exact same source* parsed fine
under `node --check` but produced a syntax error once it went through copy/paste into Chrome's
DevTools. Neither existing verification step (`node --check`, the synthetic harness) can catch a
defect that only manifests in the clipboard/paste path — a gap worth remembering for any future
change to these sentinel constants specifically.

**Fixed**: all five literals rewritten to pure printable ASCII (`'RWDB-OPEN'`, `'RWDB-CLOSE'`,
`'RWDB-ARTICLE:'`, an actually-empty `''`, and a plain `' '` in the neutralizing line) via a
byte-level rewrite (not a text-editor pass, since the corrupted bytes were invisible in normal
tooling output) — confirmed byte-for-byte clean afterward with a full-file scan for any remaining
non-printable byte outside normal whitespace. `node --check` still passes, `verify_desc.js` still
reports 100/100 (the fix is behaviorally a no-op — same sentinel semantics, different underlying
bytes), and `desc_loader.js` was rebuilt from the cleaned source.

**Live-verified**: the cleaned `desc_loader.js` pastes and installs correctly, and the builder
does appear above `#label-description` inside the real `#label-modal` on the real job page.

## Round 3 — a real bug on the same live paste: no height cap, no way to shrink the panel

Reported immediately after round 2's fix confirmed the panel now appears: "it too high, i cant
close it" — the injected panel, with no cap of its own on how tall it could grow, pushed the
host's own Cancel/Save row far enough down that it was no longer reachable, and there was no way
to shrink the panel back down short of removing it from the DOM by hand.

**Root cause**: `#rw-db-root` had no `max-height`/`overflow` of its own at all — its total height
was whatever the sum of its children happened to be (header, fields, span row, preview `<pre>`,
Fill button), with nothing bounding that against the viewport, and there was no collapse
affordance the user could reach for once it was already in the way.

**Fixed** with two changes, both ported conventions this family already established elsewhere
rather than invented fresh:
- `#rw-db-root` now carries `max-height:40vh;overflow-y:auto` directly — it can never grow past
  40% of the viewport height regardless of how many fields a custom Advanced template ends up
  needing; the header is `position:sticky;top:0` inside it (mirroring
  `boon-label-management`'s own `#rw-lbl-header` sticky-header convention) so the collapse caret
  stays reachable even if the panel is scrolled.
- A collapse caret (`#rw-db-collapse`, ▼/▶) in the header shrinks everything but the header itself
  (`#rw-db-body`) down to nothing with one click — the same collapse idiom
  `boon-label-management`'s own floating panel uses (`RW._lblSetPanelExpanded`/
  `RW._lblPanelExpanded`), adapted here to an inline-injected panel rather than a floating one.
  `RW._dbPanelExpanded` defaults to expanded and, like `RW._dbAdvanced`, survives a modal reopen
  within the session — the root is never rebuilt on reopen, only field values are reset (see
  `RW._dbResetFields`), so a state variable on the shared `RW` object naturally persists across
  that without any extra plumbing.

**Immediate unblock given to the user before the code fix landed**: `document.getElementById(
'rw-db-root').remove()` in the console, to strip the panel out of that one already-open dialog
without needing a re-paste.

Verification: `verify_desc.js` grew from 100 to 109 tests — section **13d** covers the root
actually carrying both `max-height` and `overflow-y` in its style, the caret's default expanded
state and its glyph, a click collapsing the body and flipping the glyph, a second click
re-expanding, and the collapsed state surviving a hidden→visible modal reopen (mirroring how
section 10b already covers the Advanced toggle surviving reopen). Spot-checked per this repo's
own convention: reverted the height-cap style addition and confirmed exactly test `13d-a` failed;
restored. Separately gutted `RW._dbApplyPanelExpanded` to a no-op and confirmed exactly the four
tests that depend on it (`13d-d`, `13d-e`, `13d-h`, `13d-i`) failed, with `13d-g` (re-expand)
passing vacuously since nothing had actually collapsed — exactly the expected pattern; restored.
`node --check` passes; `desc_loader.js` rebuilt clean (34322 bytes) and reconfirmed free of any
control byte.

**Not yet live-verified**: whether 40vh is actually the right cap on a real, possibly small
laptop viewport (a number chosen conservatively, not measured against the real modal); whether
the sticky header actually stays reachable while the panel is scrolled on the real page; and
whether the collapsed state surviving a modal reopen (proven synthetically in 13d-h/13d-i) holds
against the real host's own modal show/hide mechanism, not just the stub's simulated one.

## Round 4 — reverse-parse an existing description on "Edit Label", and fix unconditional brackets

Requested directly: "when editing existing label, it should already prefill the values in the
[builder]." Reverses round 1's own explicit blank-on-edit choice (see "Injection" above) — the
consequence in practice was that correcting one field of an existing label meant retyping every
field by eye off the rendered text. A second, independent bug surfaced while planning this: the
measurement line hardcoded `[{top}] - [{bot}]`, bracketing every elevation regardless of sign, when
the brackets only ever exist to keep a leading minus from being misread as the `" - "` separator —
a positive elevation never needed them. Fixed together because the reverse parser has to
understand both bracketed and bare forms either way. See "Reverse parser" and "Bracketing
elevations" above for the design; not restated here.

**A real bug caught by this round's own spot-check discipline, before shipping**: the first draft
gated the prefill on `result.confidence >= 0.4` (roughly, at least half the default template's
well-anchored lines had to match) — which silently declined a legitimate 2-line-only partial
description (confidence `0.25`) entirely, leaving every field blank with no indication why. Caught
when a seam test's own precondition failed. Root cause: the confidence gate and the parser's own
false-positive guard (drop anything sourced only from a whole-line wildcard when no non-wildcard
line matched at all) were doing the same job — for any template where every line carries real
literal text, a name can only ever be recovered from a non-wildcard line, so the false-positive
guard already implies non-zero confidence; gating on confidence *again* just rejected honest
partial recoveries. Fixed by defaulting `RW._dbPrefillMinConfidence` to `0` (see above for detail).

**Spot-checked, per this repo's own convention**: reverted the `seed` line in `RW._dbRebuildFields`
and confirmed exactly the prefill-dependent tests failed (`17a`, `17b`, `17g`, `17k-3`, `17n`, and
the reopen precondition) while `9k` (the round-1 reset-to-blank regression guard) stayed green —
restored. Moved the span-override flag assignment in `applyPrefill` to *before* the clearing
instead of after and confirmed *exactly* `17j` (and only `17j`) failed — restored; this is the
ordering this round considered the single most likely place to introduce a silent bug. Reverted
`RW._dbBracketIfNegative` to a bare passthrough and confirmed exactly the new `:brk` cases in
section 5 plus `16s` (and `7a`, the pre-existing headline test, since its sample elevations are
negative) failed — restored. Removed the parser's whole-line-wildcard-drop filter and confirmed
*exactly* `16i` (the unrelated-hand-written-description case) failed — restored. `node --check`
passes on both files; `desc_loader.js` rebuilt clean (60672 bytes, up from 34322 — the new parser
is the majority of that growth) and reconfirmed free of any control byte (the round-2 lesson —
this round's new code is mostly regex-source string literals, exactly the kind of literal that bit
round 2).

**`verify_desc.js` — grew from 109 to 227 tests.** New section 15 covers the tokenizer/regex layer
in isolation (`RW._dbEscapeRegex`, `RW._dbTokenizeTemplate` keeping `span`/`a` unlike
`RW._dbParseTemplate`, `RW._dbSlotScore`'s ordering rules, `RW._dbBuildLineMatcher`'s slot/group
alignment and `maxSlots` cap). New section 16 covers `RW._dbParseDescription` directly: a
byte-for-byte round trip on the headline sample and its inverse property (re-rendering the
recovered values reproduces the original exactly); the same round trip through a genuinely
ambiguous multi-word `desc` (`"Reinforced Concrete"`, the case a single whole-template regex
cannot solve — proof the multi-pass literal-substitution mechanism, not just per-line matching, is
what makes this work); the datum-name variant and a `height`→`depth` swap; a recovered blank
counted as recovered-not-missing; the documented casing loss under a modifier-only site; the
negative cases (unrelated hand-written text, blank/missing description or template, all
non-throwing); a partial 2-line description's exact confidence fraction; a hand-added extra line
recovering the real lines but breaking the exact-round-trip signal; span-override recovery; brace
escaping; a backtracking-time bound on an adversarial line plus the length-cap skip; purity
(deterministic, arguments unmutated, the module-shared `VAR_RE.lastIndex` not left dirty); and the
old-always-bracketed-template compatibility case. New section 17 covers the DOM seam end to end:
an Edit modal prefilling from a real rendered description with an exact preview match; a Create
modal with the identical text sitting in the textarea *not* prefilling; an unparseable description
leaving fields blank with an explaining status and no Clear button; Clear blanking everything
without touching the host's own textarea; a modal reopen onto a *different* Edit description
re-prefilling correctly (not the stale values) and a reopen onto Create staying blank with no
leftover status text; `RW._dbRememberValues` filling in exactly the names the prefill missed with
the status disclosing the split; the span-override ordering guard; the two-click Fill guard
holding even after an exact prefill; **Re-read** parsing against the template as it is *now*
(unlike the fresh-open path, which always parses against the default) rather than the stale
template; and `RW._dbPrefillStatusText`'s wordings in isolation.

**Not yet live-verified**: the prefill status row's actual legibility and layout inside the real,
Tailwind-styled modal (proven only against the synthetic stub); whether real annotation
descriptions in the wild — which may have accumulated small hand-edits, house-style drift, or
predate this round's template entirely — recover as cleanly as the synthetic fixtures here, or
mostly fall back to the "does not match" / partial cases; and whether 40 recovered fields and a new
status row still fit comfortably under the existing 40vh height cap on a real, possibly small
laptop viewport.

## Constraints (do not violate)

- Console injection only — no build step, no config file, no install step on the annotator's end.
- The user base is annotators, not programmers — inline status text over silent failure (see the
  add-variable refusal messages), plain tooltips.
- Page-scoped: reads/writes only the DOM inside the host's own already-open `#label-modal`; no
  `fetch`/XHR to any backend endpoint, ever.
- Fully standalone: must not require any other RW-family loader to have run first, and must not
  assume none of them have.
