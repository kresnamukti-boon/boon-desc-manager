# Boon Description Builder — variable-input templates for label descriptions

Client-side workflow enhancer for the Constructions Tagger annotation platform
(`constructions-tagger-web.onrender.com`). Pasted into the DevTools console of the live
annotation page — no server, no build step, nothing persists until you click the app's own
**Save**. Everything lives in the page until reload/navigation, then must be re-injected.

A label's description follows a repeating house structure —

```
Concrete - Wall
schedule
height: [-12'-0"] - [-14'-0"]
thickness: 18"
explanation: The detail shows an 18" concrete wall with the height of 2'-0". the thickness can be found in schedule table within the same page while the height can be found in the plan and notes
```

— where only the material, keyword, source, two elevations, and the thickness actually change
label to label; the rest is boilerplate you'd otherwise retype (and re-word slightly differently)
every time. This add-on turns that structure into a small form: fill in the fields, watch a live
preview, click **Fill Description** to write it into the app's own Description field. You still
review the text and click the app's own **Save** — nothing here ever submits on its own.

## Files

| File | Purpose |
|---|---|
| `rw_descbuilder.js` | the whole add-on — self-contained: own bootstrap, template engine, form, injection |
| `build_loader.sh` | wraps `rw_descbuilder.js` in the app-ready wait, producing `desc_loader.js` |
| `desc_loader.js` | generated output — paste this |
| `verify_desc.js` | synthetic Node harness (no browser, no network) |

**To rebuild** after editing `rw_descbuilder.js`:
```bash
bash build_loader.sh
```

## Injection

1. Navigate to a Constructions Tagger annotation page.
2. Press **F12** → **Console** tab.
3. Paste the entire contents of `desc_loader.js`, press **Enter**.
4. Open a label — either **+ New Label** or click an existing pin and choose to edit it. The
   builder appears as a small panel directly above the **Description** field, inside the app's
   own dialog.

Paste again after each page navigation — nothing here persists across a reload, including
whatever you'd typed into the builder's own fields (the app's own **Save**, on the description
field it writes into, is unaffected by this, same as always) — **except your saved templates**,
which come back on their own, both the templates themselves and which one you last had selected;
see "Advanced mode" below.

## Using the builder

- **Simple mode** (the default) shows just the fields the current template needs, a computed
  **span** row, a live preview of the exact text that will be written, and **Fill Description**.
  A fresh **Create New Label** always starts every field blank; opening an **existing** label
  instead prefills the fields from its current description — see "Editing an existing label"
  below. Nothing is remembered from a label you filled a moment ago unless you turn that on
  yourself (see "Remembering values" below).
- A **template** picker appears once you have more than one saved template (see "Advanced mode" —
  different drawing sources often use different house formats). Picking one re-generates the
  fields from it; if a label is already open, it also re-reads that label's description against
  the newly-picked template in one action.
- The **▼** caret at the left of the panel's own header collapses it down to just that one thin
  strip — click the **▶** it becomes to expand again. The whole panel also caps its own height and
  scrolls internally, so however many fields a template needs, it can never grow tall enough to
  push the app's own Cancel/Save row out of view.
- Each field has a one-click **NS** button that fills it with the literal text `NS` — a description
  line is never silently dropped just because a value is blank, so leaving it empty and clicking
  Fill would otherwise write a plain empty line; NS makes that visible instead. Marking
  **thickness** or an **elevation** (top/bot) NS also rewords the explanation sentence
  automatically — "No thickness information found", "No information on TOW" (top) / "TOF" (bot),
  or both combined — instead of splicing a literal "NS" into the middle of a sentence.
- Suggested values pop up as you type (`Wall`, `Footing`, `schedule`, ...) — pure suggestions, you
  can always type anything else.
- **top** / **bot** can be real elevations (`-12'-0"`, `-14'-0"`) or datum names with no numbers at
  all (`T/WALL`, `T/FOOTING`). The **span** row computes the difference automatically when both
  are elevations (`2'-0"`); when they aren't, it falls back to `"T/WALL to T/FOOTING"` so the
  explanation sentence still reads naturally. Either way, an **Override** button lets you type
  whatever you actually want there instead — including a metric value (`600mm`) — this add-on does
  no unit conversion, Override is the deliberate escape hatch for that.
- **bot** also understands a slab in between: type it as `2" - 0'-5"` (the slab's thickness, then
  the real TOF elevation) and the span/explanation account for it automatically
  (`TOW − slab thickness − TOF`) — the measurement line still shows `bot` exactly as typed. This is
  a *separate* number from **thickness** (which always describes the wall itself) — the two never
  affect each other, so you can enter a wall thickness and a slab thickness at the same time and
  each shows up in its own place. Type the bare word `SLAB` (no number) when there's a slab but you
  don't know its elevation — the explanation says so ("no information on TOF") without touching
  your wall thickness at all.
- **Fill Description** writes the preview text into the Description field below it. If that field
  already has text in it, the first click only asks — the button relabels to **Overwrite?** for a
  few seconds — and a second click actually commits, so a stray click can't clobber something
  you'd already typed by hand.
- The app's own **Save**/**Cancel** buttons are completely unaffected — this add-on only ever
  touches the Description textarea's own value, the same as if you'd typed into it yourself.

### Editing an existing label

Click an existing pin and choose to edit it, and the builder reads the description that's already
there and fills the fields from it — you're correcting a label, not retyping it from scratch. If
you have more than one saved template, it also checks the description against every one of them
first and switches the picker to whichever it actually matches, so a label from a different
drawing source parses against its own template rather than whatever was active before you opened
it. A small status line above the fields says what happened:

- **`read all 8 fields from the existing description — the preview matches it exactly`** — the
  common case: change what you need, the rest is already right.
- **`read 6 of 8 fields ... — blank: thickness, where`** — a partial match; whatever couldn't be
  confidently recovered is left blank rather than guessed, same as it would be on a fresh label.
- **`... — double-check: desc, keyword`** — recovered, but from a less certain spot in the
  description (e.g. a value that also appears elsewhere modified to lowercase) — worth a glance.
- **`this description does not match the template — fields left blank`** — none of your saved
  templates matched, most often a hand-written description. Rather than leave you with a preview
  of empty-field boilerplate about to overwrite real text, the builder switches to **Override**
  automatically (see below) with that original description ready to hand-edit — the status line
  says so (`... — override on, keeping it as-is`).
- **`... — Fill will reword this description`** instead of "the preview matches it exactly" means
  there's something in the existing text this add-on's fields can't represent (a hand-added
  sentence, most often) — clicking Fill would drop it, so double-check the preview before you do.
- **`(template: SourceB)`** appended to any of the above (once you have more than one saved
  template) names which one it actually matched against.

Two buttons sit next to that status line: **Clear** blanks every field back out (without touching
the Description field itself) if the prefill guessed badly and you'd rather start over, and
**Re-read** parses the Description field again — useful after you've switched to **Advanced** and
changed the template, since the fresh-open prefill always reads against the default template.

An **Override**d span (see below) is recovered too, if the description's height/depth line doesn't
match what recomputing from the recovered top/bot would give.

### Overriding the whole description

Sometimes no template fits — a one-off note, a hand-written description from before you started
using this add-on, anything the fields genuinely can't express. Click **Override** next to the
preview and it becomes a plain text box, seeded with whatever the preview showed a moment ago,
that you can edit directly; **Fill Description** then writes exactly what's in that box, ignoring
the fields entirely. Click **✕** to go back to the generated preview at any time — your field
values are untouched either way. This is exactly what happens automatically the moment a
non-matching description is detected (see above): rather than let Fill silently replace real text
with an empty-field rendering, the override engages on your behalf, seeded with that original
description, ready to hand-edit.

### Advanced mode

Click **Advanced** in the panel's own header to reveal:

- **The template itself**, editable — `{name}` becomes a field automatically the moment it appears
  anywhere in the template text; remove it and the field (and its value) disappears. `[` and `]`
  are always literal text if you type them directly, not part of the placeholder syntax — but the
  default height line writes `{top:brk}` / `{bot:brk}` rather than literal brackets: the `:brk`
  modifier brackets a value only when it's a *negative* elevation (`-12'-0"` → `[-12'-0"]`),
  leaving a positive one (`12'-0"`) or a datum name (`T/WALL`) bare, since brackets only ever
  existed to stop a leading minus sign from being misread as the " - " separator.
- **Add variable** — type a name and a value, click **Insert**, and `{name}` is spliced into the
  template at wherever your cursor last was (or over whatever you had selected), already carrying
  the value you typed. Use this for anything the default template doesn't cover — rebar callouts,
  a second dimension, a project-specific note — without hand-editing the braces yourself. A bad
  name, a name already in the template, or one of the two reserved names (`span`, `a`) is refused
  with an inline message rather than silently doing nothing.
- Switching back to **Simple** just hides these two — nothing you added is lost, and reopening
  Advanced later shows it again for the rest of the session.
- **Multiple named templates** — one drawing source's house format is often genuinely different
  from another's, so you're not limited to editing the one template in place. Type a name next to
  the template box and click **Save as new** to save the current text as a brand-new named
  template (the picker switches to it); **Rename** renames whichever one is currently selected
  without touching its text; **Delete** removes it (refused if it's the only one left — there must
  always be something selected). Every one of these actions, and any edit you type directly into
  the template box, is saved automatically and carries over to your *next* session too — re-paste
  the loader after a page reload and every saved template, and which one you last had selected,
  is still there, no retyping. (Everything else in this add-on — Simple/Advanced, Remember Values,
  the collapsed/expanded panel — stays session-only, same as always.) Click **Reset to default**
  to throw away whatever's saved for the *current* template and restore its built-in text — it
  never touches any other saved template.

### Remembering values

By default every field starts blank on a fresh label, by design. If you're filling in a long run
of very similar labels on one sheet and want the previous label's values to carry over as a
starting point, open the console and set:

```js
__RW._dbRememberValues = true
```

for the rest of the session. Set it back to `false` (or just re-paste the loader) to go back to
starting blank every time.

On an **existing** label, whatever the prefill above recovers from that label's own description
always wins over a remembered value — a remembered value only fills in a field the prefill
genuinely couldn't recover (the status line names which is which). On a **Create New Label**,
remembering works exactly as it always has, unaffected by any of this.

## Boundaries

- Nothing auto-submits. This add-on writes into the app's own Description textarea with a real
  input event, exactly as if you'd typed it — the app's own Save button is still the only thing
  that ever reaches the backend.
- Never touches `annotationState` directly, and never clicks the app's own label-form submit
  button on your behalf.
- Page-scoped: only ever reads/writes the DOM inside the app's own already-open label dialog. No
  `fetch`/XHR to any backend endpoint, ever.
- No metric unit conversion — the Override button on the span row is the intended way to put a
  metric (or any other non-feet-inches) value into the explanation sentence.
