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
field it writes into, is unaffected by this, same as always) — **except your Advanced template**,
which is saved automatically and comes back on its own; see "Advanced mode" below.

## Using the builder

- **Simple mode** (the default) shows just the fields the current template needs, a computed
  **span** row, a live preview of the exact text that will be written, and **Fill Description**.
  A fresh **Create New Label** always starts every field blank; opening an **existing** label
  instead prefills the fields from its current description — see "Editing an existing label"
  below. Nothing is remembered from a label you filled a moment ago unless you turn that on
  yourself (see "Remembering values" below).
- The **▼** caret at the left of the panel's own header collapses it down to just that one thin
  strip — click the **▶** it becomes to expand again. The whole panel also caps its own height and
  scrolls internally, so however many fields a template needs, it can never grow tall enough to
  push the app's own Cancel/Save row out of view.
- Each field has a one-click **NS** button that fills it with the literal text `NS` — a description
  line is never silently dropped just because a value is blank, so leaving it empty and clicking
  Fill would otherwise write a plain empty line; NS makes that visible instead.
- Suggested values pop up as you type (`Wall`, `Footing`, `schedule`, ...) — pure suggestions, you
  can always type anything else.
- **top** / **bot** can be real elevations (`-12'-0"`, `-14'-0"`) or datum names with no numbers at
  all (`T/WALL`, `T/FOOTING`). The **span** row computes the difference automatically when both
  are elevations (`2'-0"`); when they aren't, it falls back to `"T/WALL to T/FOOTING"` so the
  explanation sentence still reads naturally. Either way, an **Override** button lets you type
  whatever you actually want there instead — including a metric value (`600mm`) — this add-on does
  no unit conversion, Override is the deliberate escape hatch for that.
- **Fill Description** writes the preview text into the Description field below it. If that field
  already has text in it, the first click only asks — the button relabels to **Overwrite?** for a
  few seconds — and a second click actually commits, so a stray click can't clobber something
  you'd already typed by hand.
- The app's own **Save**/**Cancel** buttons are completely unaffected — this add-on only ever
  touches the Description textarea's own value, the same as if you'd typed into it yourself.

### Editing an existing label

Click an existing pin and choose to edit it, and the builder reads the description that's already
there and fills the fields from it — you're correcting a label, not retyping it from scratch. A
small status line above the fields says what happened:

- **`read all 8 fields from the existing description — the preview matches it exactly`** — the
  common case: change what you need, the rest is already right.
- **`read 6 of 8 fields ... — blank: thickness, where`** — a partial match; whatever couldn't be
  confidently recovered is left blank rather than guessed, same as it would be on a fresh label.
- **`... — double-check: desc, keyword`** — recovered, but from a less certain spot in the
  description (e.g. a value that also appears elsewhere modified to lowercase) — worth a glance.
- **`this description does not match the template — fields left blank`** — a hand-written
  description, or one from a very different template; nothing here is guessed, you start fresh.
- **`... — Fill will reword this description`** instead of "the preview matches it exactly" means
  there's something in the existing text this add-on's fields can't represent (a hand-added
  sentence, most often) — clicking Fill would drop it, so double-check the preview before you do.

Two buttons sit next to that status line: **Clear** blanks every field back out (without touching
the Description field itself) if the prefill guessed badly and you'd rather start over, and
**Re-read** parses the Description field again — useful after you've switched to **Advanced** and
changed the template, since the fresh-open prefill always reads against the default template.

An **Override**d span (see below) is recovered too, if the description's height/depth line doesn't
match what recomputing from the recovered top/bot would give.

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
- **Your edited template is saved automatically** and carries over to your *next* session too —
  re-paste the loader after a page reload and it's still there, no retyping. (Everything else in
  this add-on — Simple/Advanced, Remember Values, the collapsed/expanded panel — stays session-only,
  same as always.) Click **Reset to default** next to the template box to throw away your saved
  template and go back to the built-in one.

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
