/* Boon Description Builder add-on — variable-input templates for label descriptions.
 * Usage: F12 -> Console -> paste this entire block -> Enter. Fully standalone: paste alongside
 * or without any other RW-family loader, in any order. Injects a small form above the host app's
 * own Description field, inside its real Create/Edit Label dialog. Nothing persists server-side
 * until you click the app's own Save. Paste again after each page navigation. */
(async function(){
  function ready(){
    // Soft requirement only: the label modal may be created lazily on first box draw, so this
    // never hard-blocks on it — the install-time body observer (see rw_descbuilder.js) handles
    // a modal that doesn't exist yet.
    return typeof annotationState !== 'undefined'
        && document.getElementById('annotation-canvas');
  }
  // wait for app (up to 30s) — safe to paste immediately on page load
  for (let i=0; i<60 && !ready(); i++) await new Promise(r=>setTimeout(r,500));
  if (!ready()){ console.warn('[RW] app not ready after 30s — try pasting again once the page renders'); return; }
  await new Promise(r=>setTimeout(r,600)); // let the canvas settle; also gives the modal time to appear

// ===== rw_descbuilder.js =====
/* Boon Description Builder — variable-input templates for the label description field.
 * Usage: F12 -> Console -> paste this entire block -> Enter. Fully standalone — no other
 * RW-family loader needs to run first or after. Injects a small form above the host app's own
 * #label-description textarea, inside its real Create/Edit Label dialog (#label-modal): fill in
 * a few fields (material, keyword, source, top/bot elevations, thickness, ...), watch the preview
 * render, click "Fill Description" to write it into the textarea. The human still reviews the
 * text and clicks the app's own Save — nothing here ever submits the form or touches
 * annotationState directly.
 *
 * The template itself is editable ({name} placeholders auto-generate a field each) and a small
 * feet-inches parser derives a span (e.g. "2'-0\"") from two elevations, or falls back to
 * "top to bot" when they're datum names instead (e.g. "T/WALL" / "T/FOOTING") rather than
 * elevations — an explicit Override always wins over either. Advanced mode additionally exposes
 * the template box and a way to add a brand-new custom variable and splice it into the template.
 *
 * Standalone add-on, sibling to boon-tagger-mask / boon-command-line / boon-ocr /
 * boon-label-management (all under ~/Projects/boon-projects/). Ports boon-ocr's modal-injection
 * machinery (its own #label-modal MutationObserver + create/edit gate) rather than depending on
 * it — no coupling to any sibling repo, in any load order. Full design history: CLAUDE.md. */
(function(){
  // Install flag lives on its own global, not on a property of __RW: a base workbench loader
  // (boon-tagger-mask's rw_install.js) replaces window.__RW wholesale, which would wipe a vdesc
  // marker and let a re-paste register a second set of observers. Mirrors boon-ocr's rw_ocr.js,
  // which uses the identical pattern for the identical reason.
  if (window.__RWdescInstalled) return 'description builder already installed';
  window.__RWdescInstalled = true;
  const RW = window.__RW = window.__RW || {};
  RW.vdesc = true;   // kept for diagnostics only

  /* ================= pure helpers — no DOM, independently testable ================= */

  /* ---------- feet-inches parsing/formatting ---------- */

  // Reduces num/den to lowest terms via Euclid's algorithm.
  function gcd(a, b){ return b === 0 ? a : gcd(b, a % b); }

  // Parses an inches token that may carry a fraction: "6", "6 1/2", or "1/2" -> a plain number.
  function parseInchToken(tok){
    const parts = tok.trim().split(/\s+/);
    if (parts.length === 2){
      const whole = parseFloat(parts[0]);
      const [n, d] = parts[1].split('/').map(Number);
      return whole + n / d;
    }
    if (parts[0].indexOf('/') !== -1){
      const [n, d] = parts[0].split('/').map(Number);
      return n / d;
    }
    return parseFloat(parts[0]);
  }

  // Parses a feet-inches string into total inches, or null if the string isn't one. Accepts an
  // optional leading sign, feet-only ("12'"), inches-only (`6"`), the combined form with a
  // hyphen or space separator ("12'-0\"", "12' 6\""), and a fractional inches remainder
  // ("12'-6 1/2\"", `1/2"`). A bare number (no ' or ") is deliberately rejected as ambiguous —
  // that ambiguity is exactly the signal RW._dbSpan uses to fall back to a datum-name join
  // instead of arithmetic (e.g. "T/WALL" / "T/FOOTING" have no unit marks at all).
  RW._dbParseFtIn = function(raw){
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    let sign = 1;
    if (s[0] === '-'){ sign = -1; s = s.slice(1).trim(); }
    else if (s[0] === '+'){ s = s.slice(1).trim(); }
    if (!s) return null;

    let feet = 0, inches = 0, matchedFeet = false, matchedInches = false;

    const feetMatch = /^(\d+(?:\.\d+)?)\s*'/.exec(s);
    if (feetMatch){
      feet = parseFloat(feetMatch[1]);
      matchedFeet = true;
      s = s.slice(feetMatch[0].length).trim();
      if (s[0] === '-') s = s.slice(1).trim(); // separating hyphen between feet and inches
    }

    if (s){
      const inchMatch = /^(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*"$/.exec(s);
      if (!inchMatch) return null; // leftover text that isn't a valid inches token
      matchedInches = true;
      inches = parseInchToken(inchMatch[1]);
    }

    if (!matchedFeet && !matchedInches) return null;
    return sign * (feet * 12 + inches);
  };

  // Formats total inches back to "F'-I[ frac]\"", reducing a fractional remainder to sixteenths
  // (common construction precision) only when one is actually present.
  RW._dbFormatFtIn = function(totalInches){
    const neg = totalInches < 0;
    const n = Math.abs(totalInches);
    let feet = Math.floor(n / 12);
    const rem = n - feet * 12;
    let wholeIn = Math.floor(rem);
    const frac = rem - wholeIn;
    let fracStr = '';
    if (frac > 1e-9){
      const denom = 16;
      let num = Math.round(frac * denom);
      if (num === denom){ wholeIn += 1; num = 0; }
      if (num > 0){
        const g = gcd(num, denom);
        fracStr = ' ' + (num / g) + '/' + (denom / g);
      }
    }
    if (wholeIn === 12){ feet += 1; wholeIn = 0; } // carry, in case rounding pushed inches to 12
    return (neg ? '-' : '') + feet + "'-" + wholeIn + fracStr + '"';
  };

  // The {span} decision table, in order: an explicit override always wins; both sides parsing as
  // feet-inches means real arithmetic (|top - bot|); both present but not parseable means a
  // datum-name join ("T/WALL to T/FOOTING"); only one side present means that one alone; neither
  // present means blank. `source` lets the UI show how the value was derived.
  RW._dbSpan = function(top, bot, override){
    top = (top == null ? '' : String(top)).trim();
    bot = (bot == null ? '' : String(bot)).trim();
    override = (override == null ? '' : String(override)).trim();
    if (override) return { value: override, source: 'override' };
    const topIn = RW._dbParseFtIn(top);
    const botIn = RW._dbParseFtIn(bot);
    if (topIn != null && botIn != null){
      return { value: RW._dbFormatFtIn(Math.abs(topIn - botIn)), source: 'computed' };
    }
    if (top && bot) return { value: top + ' to ' + bot, source: 'datum' };
    if (top || bot) return { value: top || bot, source: 'partial' };
    return { value: '', source: '' };
  };

  /* ---------- template engine ---------- */

  // Names the template engine computes itself and which must never become an auto-generated
  // field: `span` (RW._dbSpan's result, wired in by the UI layer) and `a` (the a/an article,
  // resolved from whatever word ends up right after it).
  const DERIVED_NAMES = { span: true, a: true };
  RW._dbDerivedNames = DERIVED_NAMES;

  const VAR_RE = /\{([A-Za-z][A-Za-z0-9_]*)(?::([A-Za-z]+))?\}/g;
  const OPEN_SENTINEL = 'RWDB-OPEN';
  const CLOSE_SENTINEL = 'RWDB-CLOSE';
  const ARTICLE_SENTINEL = 'RWDB-ARTICLE:';
  const ARTICLE_END = '';

  // Scans a template for every {name}/{name:modifier} placeholder, in first-appearance order,
  // deduplicated, excluding the derived names above (they never get a field of their own).
  // `{{`/`}}` (the literal-brace escape) are neutralized first so they're never misread as the
  // start/end of a placeholder.
  RW._dbParseTemplate = function(text){
    text = String(text == null ? '' : text).split('{{').join(' ').split('}}').join(' ');
    const seen = new Set();
    const names = [];
    let m;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(text))){
      const name = m[1];
      if (DERIVED_NAMES[name]) continue;
      if (!seen.has(name)){ seen.add(name); names.push(name); }
    }
    return names;
  };

  // Applies a render-time text modifier. An unrecognized modifier (including none) passes the
  // string through unchanged — never throws, matches this codebase's own house discipline for
  // string transforms (see boon-label-management's RW._lblBuildFindMatcher).
  RW._dbApplyModifier = function(str, modifier){
    if (modifier === 'lower') return str.toLowerCase();
    if (modifier === 'upper') return str.toUpperCase();
    if (modifier === 'title') return str.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
    return str;
  };

  // Console-overridable exceptions to the vowel/digit heuristic below — e.g. a word that starts
  // with a silent consonant ("hour" -> "an hour") or a vowel that reads as a consonant sound
  // ("unit" -> "a unit"). Keyed lowercase, punctuation-stripped.
  RW._dbArticleOverrides = RW._dbArticleOverrides || {
    hour: 'an', honest: 'an', honor: 'an', heir: 'an',
    unit: 'a', unique: 'a', one: 'a', european: 'a', university: 'a', use: 'a',
  };

  // a/an for the word that follows: an override always wins; a leading digit run resolves by its
  // SPOKEN first word (8/eight, 11/eleven, 18/eighteen, and any number starting with those digits
  // — "80", "180", "1800" — all start with a vowel sound); a leading letter resolves by whether
  // it's a vowel; anything else defaults to "a".
  RW._dbArticleFor = function(word){
    const clean = String(word || '').replace(/["'.]/g, '');
    const key = clean.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(RW._dbArticleOverrides, key)) return RW._dbArticleOverrides[key];
    const digitMatch = /^[0-9]+/.exec(clean);
    if (digitMatch){
      const digits = digitMatch[0];
      return (/^8/.test(digits) || /^11/.test(digits) || /^18/.test(digits)) ? 'an' : 'a';
    }
    const letterMatch = /^[A-Za-z]/.exec(clean);
    if (letterMatch) return /[aeiouAEIOU]/.test(letterMatch[0]) ? 'an' : 'a';
    return 'a';
  };

  // Reads the "next word" starting at position `pos` in `str` — whitespace-skipped, stops at the
  // next run of whitespace. Used only to resolve a deferred {a} against whatever substitution
  // ended up immediately after it.
  function nextWordAfter(str, pos){
    const m = /^\s*([^\s]+)/.exec(str.slice(pos));
    return m ? m[1] : '';
  }

  // Renders a template against a flat {name: value} map. Grammar: {name} / {name:modifier}, name
  // matching [A-Za-z][A-Za-z0-9_]*; modifiers lower/upper/title; {{ }} escape to a literal single
  // brace; an unknown variable renders as empty text (its surrounding line is left in place, never
  // dropped — a blank field is a blank word, not a missing line); {a}/{a:modifier} is a special
  // two-pass case, resolved against the word immediately following it AFTER every other
  // substitution has happened, since that's the only order in which "the next word" is known.
  // Never throws.
  RW._dbRender = function(template, values){
    values = values || {};
    let text = String(template == null ? '' : template)
      .split('{{').join(OPEN_SENTINEL)
      .split('}}').join(CLOSE_SENTINEL);

    text = text.replace(VAR_RE, (_m, name, modifier) => {
      if (name === 'a') return ARTICLE_SENTINEL + (modifier || '') + ARTICLE_END;
      if (!Object.prototype.hasOwnProperty.call(values, name)) return '';
      const raw = values[name];
      return RW._dbApplyModifier(String(raw == null ? '' : raw), modifier);
    });

    const articleRe = new RegExp(ARTICLE_SENTINEL + '([A-Za-z]*)' + ARTICLE_END, 'g');
    text = text.replace(articleRe, (m, modifier, offset, whole) => {
      const word = nextWordAfter(whole, offset + m.length);
      return RW._dbApplyModifier(RW._dbArticleFor(word), modifier);
    });

    return text.split(OPEN_SENTINEL).join('{').split(CLOSE_SENTINEL).join('}');
  };

  // True iff the template mentions {span}/{span:modifier} at all — the span row and its
  // computation are only built/shown when the template actually uses it (a custom template with
  // no height/depth line at all needs neither).
  RW._dbTemplateUsesSpan = function(text){
    return /\{span(?::[A-Za-z]+)?\}/.test(String(text == null ? '' : text));
  };

  /* ---------- default template + suggestion lists (console-overridable) ---------- */

  RW._dbDefaultTemplate = RW._dbDefaultTemplate || [
    '{desc} - {keyword}',
    '{source}',
    '{word}: [{top}] - [{bot}]',
    'thickness: {thickness}',
    'explanation: The detail shows {a} {thickness} {desc:lower} {keyword:lower} with the {word} of {span}. the thickness can be found in {source} table within the same page while the {word} can be found in {where}',
  ].join('\n');

  RW._dbSuggestions = RW._dbSuggestions || {
    word: ['height', 'depth'],
    source: ['schedule', 'plan and notes', 'detail'],
    desc: ['Concrete', 'CMU', 'Steel'],
    keyword: ['Wall', 'Footing', 'Slab', 'Beam', 'Column'],
  };

  /* ================= DOM helpers (small, local — no coupling to any sibling repo) ================= */

  function mkEl(tag, attrs, cssText){
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) el[k] = attrs[k];
    if (cssText) el.style.cssText = cssText;
    return el;
  }

  function mkBtn(id, text, title, onClick){
    const b = mkEl('button', { id, type: 'button', innerText: text, title }, 'font-size:11px;padding:1px 6px;margin:0;');
    b.addEventListener('click', onClick);
    return b;
  }

  function clearChildren(el){
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function setListAttr(input, listId){
    if (typeof input.setAttribute === 'function') input.setAttribute('list', listId);
    else input.list = listId; // best-effort fallback for a DOM stub without setAttribute
  }

  function ensureStyle(){
    if (document.getElementById('rw-db-style')) return;
    const style = mkEl('style', { id: 'rw-db-style' });
    style.textContent = [
      '#rw-db-root input, #rw-db-root textarea, #rw-db-root select {',
      '  background:#fff; color:#111; border:1px solid #999; border-radius:3px; padding:1px 3px;',
      '}',
      '#rw-db-root input::placeholder, #rw-db-root textarea::placeholder { color:#888; }',
      '#rw-db-root button { cursor:pointer; }',
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  /* ================= state ================= */

  RW._dbAdvanced = !!RW._dbAdvanced;              // in-memory only — no persistence across reloads
  RW._dbRememberValues = !!RW._dbRememberValues;  // opt-in; default false so fields start blank
  RW._dbLastValues = RW._dbLastValues || null;
  RW._dbSpanOverridden = false;
  RW._dbSpanOverrideValue = '';
  RW._dbFillArmed = false;
  // Expanded by default; the collapse caret shrinks the whole panel down to its header strip —
  // the one-click way to get it fully out of the way of the host's own Cancel/Save row without
  // removing it. Survives a modal reopen within the session (the root itself is never rebuilt,
  // only its field VALUES are reset — see RW._dbResetFields), same as RW._dbAdvanced.
  RW._dbPanelExpanded = RW._dbPanelExpanded != null ? RW._dbPanelExpanded : true;

  /* ================= field rows ================= */

  function buildFieldRow(name, value){
    const row = mkEl('div', { id: 'rw-db-row-' + name },
      'font-size:11px;margin:2px 0;display:flex;align-items:center;gap:4px;');
    row.appendChild(mkEl('span', { innerText: name }, 'min-width:66px;opacity:0.75;'));

    const input = mkEl('input', { type: 'text', id: 'rw-db-field-' + name, value: value || '' },
      'flex:1;font-size:11px;');
    const suggestions = RW._dbSuggestions[name];
    let dl = null;
    if (suggestions && suggestions.length){
      const dlId = 'rw-db-dl-' + name;
      dl = mkEl('datalist', { id: dlId });
      for (const opt of suggestions) dl.appendChild(mkEl('option', { value: opt }));
      setListAttr(input, dlId);
    }
    input.addEventListener('input', onFieldChanged);

    const nsBtn = mkBtn('rw-db-ns-' + name, 'NS', 'Fill with "NS" (not shown / not specified)', () => {
      input.value = 'NS';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    row.appendChild(input);
    row.appendChild(nsBtn);
    if (dl) row.appendChild(dl);
    return row;
  }

  function onFieldChanged(){
    RW._dbRenderSpanDisplay();
    RW._dbRunPreview();
  }

  // Reads the current template text + every auto-generated field's current value straight off
  // the DOM (ids are unique page-wide, so a bare getElementById is safe, matching how the sibling
  // repos read their own panel fields) — no shadow JS state to drift out of sync with what's on
  // screen.
  RW._dbCollectValues = function(){
    const templateEl = document.getElementById('rw-db-template');
    const templateText = templateEl ? templateEl.value : RW._dbDefaultTemplate;
    const names = RW._dbParseTemplate(templateText);
    const values = {};
    for (const name of names){
      const el = document.getElementById('rw-db-field-' + name);
      values[name] = el ? el.value : '';
    }
    return { templateText, names, values };
  };

  RW._dbComputeOutput = function(){
    const { templateText, values } = RW._dbCollectValues();
    if (RW._dbTemplateUsesSpan(templateText)){
      const overrideVal = RW._dbSpanOverridden ? (RW._dbSpanOverrideValue || '') : '';
      values.span = RW._dbSpan(values.top || '', values.bot || '', overrideVal).value;
    }
    return RW._dbRender(templateText, values);
  };

  RW._dbRunPreview = function(){
    const pre = document.getElementById('rw-db-preview');
    if (pre) pre.innerText = RW._dbComputeOutput();
  };

  // Rebuilds #rw-db-fields from the current template text: a row per placeholder, in
  // first-appearance order. When `preserve` is true (the default — every template-edit listener
  // calls this with no argument), the value of any name that survives the edit is kept and rows
  // for names that no longer appear are dropped. RW._dbResetFields passes `false` explicitly: a
  // fresh modal open must start genuinely blank, never inherit values by name from whatever
  // label was open before — the two callers need opposite behavior from the same rebuild, not a
  // second rebuild function to keep in sync.
  RW._dbRebuildFields = function(preserve){
    if (preserve == null) preserve = true;
    const container = document.getElementById('rw-db-fields');
    if (!container) return;
    const templateEl = document.getElementById('rw-db-template');
    const templateText = templateEl ? templateEl.value : RW._dbDefaultTemplate;
    const names = RW._dbParseTemplate(templateText);

    const prevValues = {};
    if (preserve){
      for (const name of names){
        const el = document.getElementById('rw-db-field-' + name);
        if (el) prevValues[name] = el.value;
      }
    }
    clearChildren(container);
    for (const name of names){
      let value = prevValues[name];
      if (value == null && RW._dbRememberValues && RW._dbLastValues && RW._dbLastValues[name] != null){
        value = RW._dbLastValues[name];
      }
      container.appendChild(buildFieldRow(name, value || ''));
    }
    RW._dbSyncSpanRow(templateText);
    RW._dbRunPreview();
  };

  /* ---------- span row ---------- */

  function buildSpanRowSkeleton(){
    return mkEl('div', { id: 'rw-db-span-row' }, 'font-size:11px;margin:2px 0;display:none;align-items:center;gap:4px;');
  }

  RW._dbSyncSpanRow = function(templateText){
    const wrap = document.getElementById('rw-db-span-row');
    if (!wrap) return;
    const uses = RW._dbTemplateUsesSpan(templateText);
    wrap.style.display = uses ? 'flex' : 'none';
    if (uses) RW._dbRenderSpanDisplay();
  };

  const SPAN_TITLES = {
    computed: 'computed from top − bot',
    datum: 'from datums (top to bot) — not both feet-inches',
    partial: 'only one of top/bot given',
    '': 'nothing to compute yet',
  };

  RW._dbSetSpanOverridden = function(on){
    RW._dbSpanOverridden = !!on;
    RW._dbRenderSpanDisplay();
    RW._dbRunPreview();
  };

  RW._dbRenderSpanDisplay = function(){
    const row = document.getElementById('rw-db-span-row');
    if (!row) return;
    clearChildren(row);
    row.appendChild(mkEl('span', { innerText: 'span' }, 'min-width:66px;opacity:0.75;'));

    if (RW._dbSpanOverridden){
      const input = mkEl('input', { type: 'text', id: 'rw-db-span-override-input', value: RW._dbSpanOverrideValue || '' },
        'flex:1;font-size:11px;');
      input.addEventListener('input', () => { RW._dbSpanOverrideValue = input.value; RW._dbRunPreview(); });
      row.appendChild(input);
      row.appendChild(mkBtn('rw-db-span-revert-btn', '✕', 'Revert to the computed span', () => {
        RW._dbSpanOverrideValue = '';
        RW._dbSetSpanOverridden(false);
      }));
      return;
    }

    const { values } = RW._dbCollectValues();
    const span = RW._dbSpan(values.top || '', values.bot || '', '');
    const display = mkEl('span', { id: 'rw-db-span-display', innerText: span.value || '(blank)', title: SPAN_TITLES[span.source] || '' },
      'flex:1;');
    row.appendChild(display);
    row.appendChild(mkBtn('rw-db-span-override-btn', 'Override', 'Type a value instead of the computed span', () => RW._dbSetSpanOverridden(true)));
  };

  /* ---------- collapse: shrink the whole panel down to its header strip ---------- */

  RW._dbSetPanelExpanded = function(on){
    RW._dbPanelExpanded = !!on;
    RW._dbApplyPanelExpanded();
  };

  RW._dbApplyPanelExpanded = function(){
    const body = document.getElementById('rw-db-body');
    const caret = document.getElementById('rw-db-collapse');
    if (body) body.style.display = RW._dbPanelExpanded ? '' : 'none';
    if (caret){
      caret.innerHTML = RW._dbPanelExpanded ? '&#9660;' : '&#9654;';
      caret.title = RW._dbPanelExpanded ? 'Collapse Description Builder' : 'Expand Description Builder';
    }
  };

  /* ---------- advanced mode: template box + add-variable ---------- */

  RW._dbSetAdvanced = function(on){
    RW._dbAdvanced = !!on;
    RW._dbApplyAdvancedVisibility();
  };

  RW._dbApplyAdvancedVisibility = function(){
    const templateWrap = document.getElementById('rw-db-template-wrap');
    const addVarWrap = document.getElementById('rw-db-addvar-wrap');
    const toggle = document.getElementById('rw-db-adv-toggle');
    if (templateWrap) templateWrap.style.display = RW._dbAdvanced ? '' : 'none';
    if (addVarWrap) addVarWrap.style.display = RW._dbAdvanced ? '' : 'none';
    if (toggle) toggle.innerText = RW._dbAdvanced ? 'Simple' : 'Advanced';
  };

  // Splices {name} into the template at its current caret (or over its selection), seeded with
  // the typed value once the field appears. Refuses a malformed name, a derived name ('span'/'a'),
  // or a duplicate of a name already in the template — reported inline, never silently dropped
  // (the user base is annotators, not programmers).
  RW._dbInsertVariable = function(){
    const nameEl = document.getElementById('rw-db-addvar-name');
    const valueEl = document.getElementById('rw-db-addvar-value');
    const statusEl = document.getElementById('rw-db-addvar-status');
    const templateEl = document.getElementById('rw-db-template');
    if (!nameEl || !valueEl || !templateEl) return;

    const name = (nameEl.value || '').trim();
    function fail(msg){ if (statusEl) statusEl.innerText = msg; }

    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)){
      fail('a variable name must start with a letter and contain only letters, numbers, or _');
      return;
    }
    if (DERIVED_NAMES[name]){
      fail('"' + name + '" is reserved — pick a different name');
      return;
    }
    const existing = RW._dbParseTemplate(templateEl.value);
    if (existing.indexOf(name) !== -1){
      fail('"' + name + '" is already in the template');
      return;
    }

    const insertText = '{' + name + '}';
    const start = templateEl.selectionStart != null ? templateEl.selectionStart : templateEl.value.length;
    const end = templateEl.selectionEnd != null ? templateEl.selectionEnd : start;
    templateEl.value = templateEl.value.slice(0, start) + insertText + templateEl.value.slice(end);
    const caret = start + insertText.length;
    if (typeof templateEl.setSelectionRange === 'function') templateEl.setSelectionRange(caret, caret);
    else { templateEl.selectionStart = caret; templateEl.selectionEnd = caret; }
    templateEl.dispatchEvent(new Event('input', { bubbles: true }));

    const fieldEl = document.getElementById('rw-db-field-' + name);
    if (fieldEl){
      fieldEl.value = valueEl.value || '';
      fieldEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (statusEl) statusEl.innerText = '';
    nameEl.value = '';
    valueEl.value = '';
  };

  /* ---------- fill: write the rendered text into #label-description, never auto-submit ---------- */

  // Writes the rendered text into the host's own textarea with a real dispatched input+change —
  // never clicks the host's submit button, never touches annotationState. Against a non-empty
  // textarea the first click only re-labels the button to "Overwrite?" for ~3s; a second click
  // within that window commits. Protects a hand-written description from a stray click.
  RW._dbRunFill = function(modal){
    const descInp = modal.querySelector('#label-description');
    const btn = modal.querySelector('#rw-db-fill');
    if (!descInp) return;

    if (descInp.value && descInp.value.trim() && !RW._dbFillArmed){
      RW._dbFillArmed = true;
      if (btn) btn.innerText = 'Overwrite?';
      setTimeout(() => {
        RW._dbFillArmed = false;
        if (btn) btn.innerText = 'Fill Description';
      }, 3000);
      return;
    }

    RW._dbFillArmed = false;
    if (btn) btn.innerText = 'Fill Description';
    const text = RW._dbComputeOutput();
    if (RW._dbRememberValues){
      const { values } = RW._dbCollectValues();
      RW._dbLastValues = Object.assign({}, values);
    }
    descInp.value = text;
    descInp.dispatchEvent(new Event('input', { bubbles: true }));
    descInp.dispatchEvent(new Event('change', { bubbles: true }));
  };

  /* ---------- reset fields on a fresh modal open ---------- */

  RW._dbResetFields = function(modal){
    const templateEl = modal.querySelector('#rw-db-template');
    if (templateEl) templateEl.value = RW._dbDefaultTemplate;
    RW._dbSpanOverridden = false;
    RW._dbSpanOverrideValue = '';
    RW._dbFillArmed = false;
    const fillBtn = modal.querySelector('#rw-db-fill');
    if (fillBtn) fillBtn.innerText = 'Fill Description';
    RW._dbRebuildFields(false);
  };

  /* ================= panel build + host-modal injection ================= */

  RW._dbBuildPanel = function(modal){
    const descInp = modal.querySelector('#label-description');
    if (!descInp) return;
    if (modal.querySelector('#rw-db-root')) return; // idempotent — already injected

    ensureStyle();

    // The root caps its OWN height and scrolls internally — a real live bug (a tall template
    // pushed the host's own Cancel/Save row below the visible area, with no way to reach it) is
    // exactly what this guards against: no matter how many fields a custom Advanced template
    // ends up needing, this panel can never grow past a fraction of the viewport.
    const root = mkEl('div', { id: 'rw-db-root' },
      'border:1px solid #999;border-radius:4px;padding:6px;margin-bottom:6px;background:#f7f7f7;'
      + 'color:#111;max-height:40vh;overflow-y:auto;');

    const header = mkEl('div', { id: 'rw-db-header' },
      'display:flex;align-items:center;justify-content:space-between;font-weight:bold;font-size:12px;'
      + 'margin-bottom:4px;position:sticky;top:0;background:#f7f7f7;');
    const titleWrap = mkEl('span', {}, 'display:flex;align-items:center;gap:4px;');
    const collapseCaret = mkEl('span', { id: 'rw-db-collapse', innerHTML: '&#9660;', title: 'Collapse Description Builder' },
      'font-size:11px;cursor:pointer;');
    collapseCaret.addEventListener('click', () => RW._dbSetPanelExpanded(!RW._dbPanelExpanded));
    titleWrap.appendChild(collapseCaret);
    titleWrap.appendChild(mkEl('span', { innerText: 'Description Builder' }));
    header.appendChild(titleWrap);
    header.appendChild(mkBtn('rw-db-adv-toggle', RW._dbAdvanced ? 'Simple' : 'Advanced',
      'Toggle between Simple (fields only) and Advanced (template + custom variables)',
      () => RW._dbSetAdvanced(!RW._dbAdvanced)));
    root.appendChild(header);

    // Everything but the header collapses together — the one-click way to get this panel
    // entirely out of the way (down to a single thin strip) without removing it.
    const body = mkEl('div', { id: 'rw-db-body' });

    const templateWrap = mkEl('div', { id: 'rw-db-template-wrap' }, 'margin-bottom:4px;');
    templateWrap.appendChild(mkEl('div', { innerText: 'Template (edit freely — {name} becomes a field):' },
      'font-size:10px;opacity:0.7;'));
    const templateEl = mkEl('textarea', { id: 'rw-db-template', rows: 6, value: RW._dbDefaultTemplate },
      'width:98%;font-size:11px;font-family:monospace;');
    templateEl.addEventListener('input', () => RW._dbRebuildFields());
    templateWrap.appendChild(templateEl);
    body.appendChild(templateWrap);

    const addVarWrap = mkEl('div', { id: 'rw-db-addvar-wrap' },
      'margin-bottom:4px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;');
    addVarWrap.appendChild(mkEl('input', { type: 'text', id: 'rw-db-addvar-name', placeholder: 'name' }, 'width:70px;font-size:11px;'));
    addVarWrap.appendChild(mkEl('input', { type: 'text', id: 'rw-db-addvar-value', placeholder: 'value' }, 'width:100px;font-size:11px;'));
    addVarWrap.appendChild(mkBtn('rw-db-addvar-insert', 'Insert', "Add {name} to the template at the caret, seeded with this value", () => RW._dbInsertVariable()));
    addVarWrap.appendChild(mkEl('span', { id: 'rw-db-addvar-status' }, 'font-size:10px;opacity:0.8;'));
    body.appendChild(addVarWrap);

    body.appendChild(mkEl('div', { id: 'rw-db-fields' }));
    body.appendChild(buildSpanRowSkeleton());

    body.appendChild(mkEl('pre', { id: 'rw-db-preview' },
      'white-space:pre-wrap;font-size:11px;background:#fff;border:1px solid #ccc;padding:4px;margin:4px 0;max-height:100px;overflow-y:auto;'));

    body.appendChild(mkBtn('rw-db-fill', 'Fill Description', "Write the rendered text into the Description field below", () => RW._dbRunFill(modal)));

    root.appendChild(body);
    descInp.insertAdjacentElement('beforebegin', root);

    RW._dbApplyAdvancedVisibility();
    RW._dbApplyPanelExpanded();
    RW._dbRebuildFields();
  };

  function modalTitleText(modal){
    const t = modal.querySelector('#label-modal-title');
    return t ? (t.innerText || t.textContent || '').trim() : '';
  }

  function modalVisible(modal){
    if (!modal) return false;
    if (modal.hidden) return false;
    if (modal.classList && modal.classList.contains('hidden')) return false;
    const cs = window.getComputedStyle ? window.getComputedStyle(modal) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    return true;
  }

  // Unlike boon-ocr's create-only gate, this add-on injects for BOTH "Create New Label" and
  // "Edit Label" — the user chose blank-on-edit (no reverse-parsing of an existing description)
  // rather than create-only, so the builder is just as usable when correcting an existing label.
  function isModalEligible(modal){
    if (!modal || modal.id !== 'label-modal') return false;
    const title = modalTitleText(modal);
    return title === 'Create New Label' || title === 'Edit Label';
  }

  RW._dbMaybeInject = function(modal){
    if (!modal) modal = document.getElementById('label-modal');
    if (!modal) return;
    if (!modalVisible(modal)) return;
    if (!isModalEligible(modal)) return;
    RW._dbBuildPanel(modal);
  };

  // Tracks the modal's own visible/hidden transitions so a fresh open (whether Create or Edit)
  // always starts the builder blank — a stale value from the label just closed must never bleed
  // into the next one.
  let dbWasVisible = false;
  function onLabelModalMutation(){
    const modal = document.getElementById('label-modal');
    if (!modal) return;
    const nowVisible = modalVisible(modal);
    if (nowVisible && !dbWasVisible){
      RW._dbMaybeInject(modal);
      if (isModalEligible(modal)) RW._dbResetFields(modal);
    }
    dbWasVisible = nowVisible;
  }

  const labelModalEl = document.getElementById('label-modal');
  if (window.MutationObserver){
    if (labelModalEl){
      const mo = new MutationObserver(() => onLabelModalMutation());
      mo.observe(labelModalEl, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
      onLabelModalMutation(); // in case it's already open at install
    } else {
      // The label modal may not exist yet (built lazily on first open, like the sibling repos'
      // reference-prompt modal) — watch for it being added.
      new MutationObserver(() => onLabelModalMutation())
        .observe(document.body, { childList: true, subtree: true });
    }
  }

  return 'description builder installed';
})();


  console.log('[RW] Description Builder ready. Open a label\'s Create/Edit dialog to see it above Description.');
})()
