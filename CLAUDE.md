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
node verify_desc.js           # synthetic harness — 100 tests, all passing
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

- **Modifiers**: `{name:lower}` / `{name:upper}` / `{name:title}`; an unrecognized modifier passes
  the value through unchanged, matching this codebase's house discipline for string transforms
  (`boon-label-management`'s `RW._lblBuildFindMatcher` never throws either).
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
  `"Edit Label"` — unlike `boon-ocr`'s create-only rule for its own fields. The user chose
  blank-on-edit (no reverse-parsing of an existing description into the fields) over create-only,
  so the builder is just as usable correcting an existing label as authoring a new one.
- **Two observers**, exactly `boon-ocr`'s pattern: a `MutationObserver` on `#label-modal` itself
  for `class`/`hidden`/`style` when it exists at install; otherwise one on `document.body`
  (`childList` + `subtree`) for the modal built lazily on first use.
- **Reset on every hidden→visible transition** — not just at install. A stale value from the
  label that was just closed must never bleed into the next one, whether that next modal is a
  fresh "Create New Label" or a same-session "Edit Label" on a different entry. This is
  `RW._dbResetFields`, which calls `RW._dbRebuildFields(false)` — the `false` matters: the same
  rebuild function is also what a template edit calls (with no argument, defaulting to `true`) to
  *preserve* values whose names survive the edit, and reusing the preserving path for a fresh
  modal open was a real bug caught in this round's own spot-check (below).
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
  protects a hand-written description from being clobbered by one stray click on Fill.

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

## Constraints (do not violate)

- Console injection only — no build step, no config file, no install step on the annotator's end.
- The user base is annotators, not programmers — inline status text over silent failure (see the
  add-variable refusal messages), plain tooltips.
- Page-scoped: reads/writes only the DOM inside the host's own already-open `#label-modal`; no
  `fetch`/XHR to any backend endpoint, ever.
- Fully standalone: must not require any other RW-family loader to have run first, and must not
  assume none of them have.
