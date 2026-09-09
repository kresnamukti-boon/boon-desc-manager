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

  /* ---------- round 9: a slab thickness embedded in `bot` itself ----------
     In some conditions the true height/depth isn't a plain TOW - TOF (top - bot) — there's a slab
     of a given thickness sitting in between, so the real figure is TOW - slab thickness - TOF.
     Rather than a separate field or a keyword-based toggle, this is auto-detected from `bot`'s own
     raw text: `2" - 0'-5"` means "a 2\" slab, with the true TOF at 0'-5\""; the bare word `SLAB`
     (no number at all) means "there's a slab here, but its thickness isn't known" — both pieces
     unknown. This is a SEPARATE quantity from {thickness} (the wall's own thickness, used in the
     "thickness: {thickness}" line and the explanation's "{a} {thickness} {desc:lower} ..." — a
     completely different physical value describing the wall itself, not whatever slab sits
     between it and the footing). The detected slab thickness feeds ONLY the span/height-depth
     arithmetic below — it never reads from or writes to {thickness}, which stays exactly what the
     annotator types, independent of this. */

  // Detects bot's two special shapes; returns null for everything else (a plain elevation, datum
  // name, NS, blank) — completely unaffected, matching today's behavior exactly. The compound
  // split looks for a literal " - " (space-hyphen-space); a bare negative sign like -14'-0" has no
  // such pattern, so this never collides with a normal negative elevation. Both halves must parse
  // via RW._dbParseFtIn, or this returns null (not compound — the safe fallback for anything
  // malformed or ambiguous). Values are returned exactly as typed, never reformatted.
  RW._dbParseBotThickness = function(botRaw){
    const raw = String(botRaw == null ? '' : botRaw).trim();
    if (!raw) return null;
    if (raw.toUpperCase() === 'SLAB') return { slabThickness: 'NS', elevation: 'NS' };
    const sepIdx = raw.indexOf(' - ');
    if (sepIdx === -1) return null;
    const thicknessPart = raw.slice(0, sepIdx).trim();
    const elevationPart = raw.slice(sepIdx + 3).trim();
    if (RW._dbParseFtIn(thicknessPart) == null || RW._dbParseFtIn(elevationPart) == null) return null;
    return { slabThickness: thicknessPart, elevation: elevationPart };
  };

  // Wraps RW._dbSpan to additionally subtract a SLAB thickness detected inside `bot` (above) — not
  // {thickness}, which is the wall's own thickness and plays no part in this arithmetic. Returns
  // the same { value, source } shape RW._dbSpan does (a new 'computed-thickness' source when the
  // subtraction actually applied, for a more specific span-row tooltip). An explicit Override
  // still always wins (checked first, matching RW._dbSpan's own precedence). The subtraction only
  // applies when RW._dbSpan actually computed a real number (both `top` and the extracted
  // elevation parsed as feet-inches) — a datum-name/partial/blank result is left alone, since
  // there's nothing numeric to subtract from; and only when the detected slab thickness itself is
  // known (not the bare-SLAB "NS" case, where there's nothing to subtract either).
  RW._dbComputeSpanWithThickness = function(top, bot, override){
    const botInfo = RW._dbParseBotThickness(bot);
    const effectiveBot = botInfo ? botInfo.elevation : bot;
    const result = RW._dbSpan(top, effectiveBot, override);
    if (override || !botInfo || result.source !== 'computed' || RW._dbIsNS(botInfo.slabThickness)) return result;
    const spanIn = RW._dbParseFtIn(result.value);
    const thickIn = RW._dbParseFtIn(botInfo.slabThickness);
    if (spanIn == null || thickIn == null) return result;
    return { value: RW._dbFormatFtIn(Math.abs(spanIn - thickIn)), source: 'computed-thickness' };
  };

  /* ---------- template engine ---------- */

  // Names the template engine computes itself and which must never become an auto-generated
  // field: `span` (RW._dbSpan's result, wired in by the UI layer) and `a` (the a/an article,
  // resolved from whatever word ends up right after it). Kept separate from DERIVED_NAMES below
  // (round 12): this is the genuinely-reserved set — a user-defined formula field is ALSO excluded
  // from becoming a plain input field, but for a different reason, and telling an annotator their
  // formula name "is reserved" would be misleading (true only by an implementation accident).
  const BUILTIN_DERIVED_NAMES = { span: true, a: true };
  // The actual render/parse exclusion set RW._dbParseTemplate reads — built from
  // BUILTIN_DERIVED_NAMES plus every current formula name, kept in sync by the one idempotent
  // dbSyncFormulaDerivedNames() below rather than scattered add/delete mutations that could drift.
  const DERIVED_NAMES = Object.assign({}, BUILTIN_DERIVED_NAMES);
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

  // Brackets a value only when it's a NEGATIVE feet-inches elevation — the brackets exist purely
  // to stop a leading minus sign from being misread as the " - " separator between top and bot
  // (`-12'-0" - -14'-0"` is unreadable; `[-12'-0"] - [-14'-0"]` isn't). A positive elevation needs
  // no such protection, and a datum name (`T/WALL`) or `NS` never parses as feet-inches at all, so
  // both render bare. Idempotent — strips one existing bracket layer first — because the reverse
  // parser recovers top/bot unbracketed and this re-adds brackets on every Fill; a value must
  // never accumulate `[[...]]` across an edit round-trip.
  RW._dbBracketIfNegative = function(str){
    let s = String(str == null ? '' : str).trim();
    if (!s) return ''; // blank stays blank — never drops its line
    const inner = /^\[([\s\S]*)\]$/.exec(s);
    if (inner) s = inner[1].trim();
    const n = RW._dbParseFtIn(s);
    return (n != null && n < 0) ? '[' + s + ']' : s;
  };

  // Applies a render-time text modifier. An unrecognized modifier (including none) passes the
  // string through unchanged — never throws, matches this codebase's own house discipline for
  // string transforms (see boon-label-management's RW._lblBuildFindMatcher).
  RW._dbApplyModifier = function(str, modifier){
    if (modifier === 'lower') return str.toLowerCase();
    if (modifier === 'upper') return str.toUpperCase();
    if (modifier === 'title') return str.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
    if (modifier === 'brk') return RW._dbBracketIfNegative(str);
    return str;
  };

  // Modifiers the reverse parser (below) can trust a placeholder site through: `lower`/`upper`/
  // `title` destroy the original casing, but `brk` only adds/removes bracket punctuation around a
  // value that never itself contains brackets, so it can be un-applied losslessly.
  RW._dbModifierInvertible = { brk: true };

  // The inverse of the `brk` case above: strips one optional surrounding [ ] layer and trims.
  // Every other modifier (including none) passes through unchanged — this is only ever called on
  // a site RW._dbModifierInvertible already approved. Never throws.
  RW._dbUnapplyModifier = function(str, modifier){
    if (modifier === 'brk'){
      const s = String(str == null ? '' : str).trim();
      const inner = /^\[([\s\S]*)\]$/.exec(s);
      return (inner ? inner[1] : s).trim();
    }
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

  /* ---------- round 12: user-definable formula fields ----------
     A general way to define a NEW computed field via a simple expression — e.g. typing
     "{total} = {a} + {b}" in Advanced mode makes {total} render a computed value like {span}
     already does, usable in ANY saved template (global, not tied to one — the same as {span}/{a}
     aren't). Deliberately narrow scope, confirmed with the user: a strict left-to-right +/- chain
     over {name} tokens only — no parentheses, no precedence, no * or /, no literal numbers (a real
     field is the workaround for a constant). A formula's operands must be plain fields (or {span}/
     {a}) — never another formula, so there is no dependency ordering or cycle handling to build;
     see RW._dbAddFormula below for the two-direction chaining refusal this still requires. */

  // "{a} + {b} - {c}" -> {names, ops} | null. Requires >= 2 operands (a single {name} would be a
  // pure, always-blank alias — refused rather than silently useless); no modifier on any operand
  // ({a:lower} is a render-time concern, never a value to compute with); no operators besides the
  // bare + and -. Tolerant of missing/extra whitespace around every token.
  RW._dbParseFormulaExpr = function(expr){
    let rest = String(expr == null ? '' : expr).trim();
    if (!rest) return null;
    const names = [], ops = [];
    for (;;){
      const m = /^\{([A-Za-z][A-Za-z0-9_]*)\}/.exec(rest);
      if (!m) return null;
      names.push(m[1]);
      rest = rest.slice(m[0].length).replace(/^\s+/, '');
      if (!rest) break;
      if (rest[0] !== '+' && rest[0] !== '-') return null; // no * / ( ) / literals — round 12 scope
      ops.push(rest[0]);
      rest = rest.slice(1).replace(/^\s+/, '');
      if (!rest) return null; // dangling operator
    }
    return names.length >= 2 ? { names: names, ops: ops } : null;
  };

  // "{total} = {a} + {b}" -> {name, expr, names, ops} | null. The left-hand side must be exactly
  // one bare {name} — no modifier (a formula's OWN name is never rendered with one; a modifier
  // only ever applies where {total} is later USED, same as any other field).
  RW._dbParseFormulaDefinition = function(raw){
    const m = /^\{([A-Za-z][A-Za-z0-9_]*)\}\s*=\s*([^\n]+)$/.exec(String(raw == null ? '' : raw).trim());
    if (!m) return null;
    const expr = m[2].trim();
    const parsed = RW._dbParseFormulaExpr(expr);
    if (!parsed) return null;
    return { name: m[1], expr: expr, names: parsed.names, ops: parsed.ops };
  };

  // Sums/subtracts left-to-right via the EXISTING RW._dbParseFtIn/RW._dbFormatFtIn (a negative
  // total already formats with a leading "-"). Returns '' the instant ANY operand is missing or
  // doesn't parse as feet-inches — no elaborate fallback table like RW._dbSpan's own
  // datum/partial handling; a general formula has no comparable domain-specific fallback to reach
  // for. Never throws.
  RW._dbEvaluateFormula = function(formula, values){
    if (!formula || !formula.names || !formula.names.length) return '';
    values = values || {};
    let total = 0;
    for (let i = 0; i < formula.names.length; i++){
      const key = formula.names[i];
      const raw = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '';
      const n = RW._dbParseFtIn(raw);
      if (n == null) return '';
      total += (i === 0 || formula.ops[i - 1] === '+') ? n : -n;
    }
    return RW._dbFormatFtIn(total);
  };

  // Evaluates every formula against a FROZEN pre-injection snapshot of `values`, never against its
  // own partially-built output — what makes the compute path order-independent regardless of what
  // RW._dbFormulas happens to contain (reachable from the console or hand-edited localStorage), so
  // an illegal chain that somehow got saved degrades to blank instead of order-dependent garbage,
  // rather than depending on validation being airtight everywhere it's reachable from.
  RW._dbApplyFormulas = function(values){
    values = values || {};
    const list = RW._dbFormulas || [];
    if (!list.length) return values; // zero-formula path is the SAME object — a provable no-op
    const out = Object.assign({}, values);
    for (const f of list) out[f.name] = RW._dbEvaluateFormula(f, values);
    return out;
  };

  // A formula reading {span} needs it computed even in a template that never mentions {span}
  // itself — used in place of RW._dbTemplateUsesSpan at both of that check's own call sites (the
  // span gate in RW._dbComputeOutput and the span row's own visibility), so the Override button
  // stays reachable too. With no formulas defined this is identical to RW._dbTemplateUsesSpan.
  RW._dbNeedsSpan = function(templateText){
    if (RW._dbTemplateUsesSpan(templateText)) return true;
    return (RW._dbFormulas || []).some((f) => f.names.indexOf('span') !== -1);
  };

  /* ---------- smart NS wording in the explanation (round 8) ----------
     If thickness (or the elevation — top=TOW, bot=TOF) is marked NS, the literal string "NS"
     spliced into the explanation sentence reads badly ("with the height of NS") and, worse, an
     NS top/bot makes RW._dbSpan produce a nonsense join like "NS to -14'-0\"". This substitutes
     natural wording instead — but as a POST-RENDER text substitution inside RW._dbComputeOutput,
     never by changing the template text itself. A tempting alternative — a new derived
     {explanation} placeholder computed like {span} already is — was rejected: it would silently
     break the reverse parser's ability to recover {where} (which has no other occurrence in the
     template) on EVERY future re-edit, not just the NS ones, since RW._dbParseDescription matches
     the TEMPLATE's structure, not rendered text. Leaving the template untouched means the common
     (no-NS) case is a full no-op — byte-identical to today — and only a description that WAS
     produced under an NS condition fails to re-match this one line on a later reopen, no worse
     than any hand-edited sentence already does. */

  // Case-insensitive, trimmed — matches what the NS button writes but tolerates a hand-typed
  // "ns". A blank field (never touched) is NOT NS and never triggers this.
  RW._dbIsNS = function(v){
    return String(v == null ? '' : v).trim().toUpperCase() === 'NS';
  };

  // Finds the template line (by index) whose tokens mention thickness, span, source, AND where
  // together — the built-in explanation line's structural signature. Purely STRUCTURAL (which
  // names appear on one line), never literal wording, so it still finds the line after the
  // annotator rewords the surrounding sentence, and simply doesn't fire (-1) on a custom template
  // that doesn't have this shape — a safe no-op, not a forced behavior on every template.
  RW._dbFindNsExplanationLine = function(templateText){
    let lines;
    try { lines = RW._dbTokenizeTemplate(templateText); }
    catch (e){ return -1; }
    const required = ['thickness', 'span', 'source', 'where'];
    for (let i = 0; i < lines.length; i++){
      const names = new Set(lines[i].filter((t) => t.type === 'var').map((t) => t.name));
      if (required.every((n) => names.has(n))) return i;
    }
    return -1;
  };

  // The decision table: unchanged when neither is NS (returns null — caller keeps the normal
  // render); each NS combination gets its own fixed wording, confirmed with the user against the
  // sample values byte-for-byte. {a} is resolved (RW._dbArticleFor) against whatever word it now
  // precedes in each variant, exactly as the template's own {a} would.
  RW._dbNsExplanationText = function(values){
    values = values || {};
    const thickness = values.thickness == null ? '' : String(values.thickness);
    const desc = values.desc == null ? '' : String(values.desc);
    const keyword = values.keyword == null ? '' : String(values.keyword);
    const word = values.word == null ? '' : String(values.word);
    const span = values.span == null ? '' : String(values.span);
    const source = values.source == null ? '' : String(values.source);
    const where = values.where == null ? '' : String(values.where);

    const thicknessNS = RW._dbIsNS(thickness);
    const topNS = RW._dbIsNS(values.top);
    const botNS = RW._dbIsNS(values.bot);
    const elevationNS = topNS || botNS;
    if (!thicknessNS && !elevationNS) return null;

    const descLower = RW._dbApplyModifier(desc, 'lower');
    const keywordLower = RW._dbApplyModifier(keyword, 'lower');
    const datum = (topNS && botNS) ? 'TOW and TOF' : (topNS ? 'TOW' : 'TOF');

    if (thicknessNS && elevationNS){
      return 'No thickness information found and no information on ' + datum + '.';
    }
    if (thicknessNS){
      const a = RW._dbArticleFor(descLower);
      return 'The detail shows ' + a + ' ' + descLower + ' ' + keywordLower + ' with the ' + word
        + ' of ' + span + '. No thickness information found. the ' + word + ' can be found in ' + where;
    }
    // elevationNS only
    const a = RW._dbArticleFor(thickness);
    return 'The detail shows ' + a + ' ' + thickness + ' ' + descLower + ' ' + keywordLower
      + '. No information on ' + datum + '; the thickness can be found in ' + source + ' table within the same page.';
  };

  // Splices RW._dbNsExplanationText's override into the ALREADY-RENDERED text at the line
  // RW._dbFindNsExplanationLine identifies, preserving that line's own leading "label: " prefix —
  // extracted from its first literal token via /^([^:]*:\s*)/, so a renamed label ("note: " etc.)
  // still works without hardcoding "explanation: ". A no-op (returns renderedText unchanged) when
  // no matching line is found, or when neither NS condition applies.
  RW._dbApplyNsExplanation = function(renderedText, templateText, values){
    const idx = RW._dbFindNsExplanationLine(templateText);
    if (idx < 0) return renderedText;
    const override = RW._dbNsExplanationText(values);
    if (override == null) return renderedText;

    let tLines;
    try { tLines = RW._dbTokenizeTemplate(templateText); }
    catch (e){ return renderedText; }
    const first = (tLines[idx] || [])[0];
    const labelMatch = (first && first.type === 'literal') ? /^([^:]*:\s*)/.exec(first.text) : null;
    const prefix = labelMatch ? labelMatch[1] : '';

    const lines = renderedText.split('\n');
    if (idx >= lines.length) return renderedText;
    lines[idx] = prefix + override;
    return lines.join('\n');
  };

  // Round 12: the ONE place "inject computed values -> render -> apply the NS substitution" is
  // spelled out, shared by RW._dbComputeOutput (the DOM path) and RW._dbDetectTemplate (round 6's
  // template auto-detect, which independently reconstructs `values` for its own exact-match check)
  // — the only two call sites that reach RW._dbRender in the whole file. Round 9 already showed
  // what happens when this pipeline is duplicated instead of shared: RW._dbDetectTemplate was
  // found missing the NS-substitution step entirely, mid-round. `values` must already carry
  // `span` before this is called — the two callers legitimately derive it differently (a live
  // span override + the span row vs. whatever the reverse parser recovered), so that stays at
  // each call site; everything after it is single-sited here.
  RW._dbRenderFinal = function(templateText, values){
    const withFormulas = RW._dbApplyFormulas(values);
    const rendered = RW._dbRender(templateText, withFormulas);
    const botInfo = RW._dbParseBotThickness(withFormulas.bot);
    const nsValues = botInfo ? Object.assign({}, withFormulas, { bot: botInfo.elevation }) : withFormulas;
    return RW._dbApplyNsExplanation(rendered, templateText, nsValues);
  };

  /* ---------- reverse parser: recovers field values from an already-rendered description ---------- */
  //
  // Not a general inverse of RW._dbRender — see CLAUDE.md for the honest list of what's lost
  // (:lower/:upper/:title casing, {a}, an ambiguous run of placeholders separated only by single
  // spaces). What IS exploited: every field value comes from a single-line <input>, so browsers
  // never let it contain a newline — meaning one template line always renders to exactly one
  // description line, in order. Matching therefore happens PER LINE, never across \n: it bounds
  // every regex to one short line (most of the backtracking answer by itself), and it means a
  // hand-edited word on one line can never cost recovery of every other line.

  // Escapes regex metacharacters in a literal template fragment. Deliberately does NOT escape
  // '-' — it has no special meaning outside a character class, and nothing here builds one.
  RW._dbEscapeRegex = function(str){
    return String(str == null ? '' : str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Tokenizes one template line into an ordered list of literal runs and {name}/{name:modifier}
  // placeholders. Unlike RW._dbParseTemplate this KEEPS the derived names 'a' and 'span' as var
  // tokens — they never become fields, but a line mentioning one still has to match against it to
  // match at all. {{ }} are neutralized with the same sentinels RW._dbRender uses, then restored
  // to real single braces INSIDE each literal token before that token is ever regex-escaped — a
  // literal brace behaves identically on the render and the parse side, from one shared mechanism.
  RW._dbTokenizeTemplate = function(text){
    const src = String(text == null ? '' : text)
      .split('{{').join(OPEN_SENTINEL)
      .split('}}').join(CLOSE_SENTINEL);
    const out = [];
    for (const line of src.split('\n')){
      const tokens = [];
      let last = 0;
      let m;
      VAR_RE.lastIndex = 0; // module-shared /g regex — same discipline as RW._dbParseTemplate
      while ((m = VAR_RE.exec(line))){
        if (m.index > last) tokens.push(literalToken(line.slice(last, m.index)));
        tokens.push({ type: 'var', name: m[1], modifier: m[2] || null });
        last = m.index + m[0].length;
      }
      if (last < line.length) tokens.push(literalToken(line.slice(last)));
      out.push(tokens);
    }
    return out;

    function literalToken(raw){
      return { type: 'literal', text: raw.split(OPEN_SENTINEL).join('{').split(CLOSE_SENTINEL).join('}') };
    }
  };

  // Scores how trustworthy one occurrence of a placeholder is, for arbitrating between several
  // occurrences of the same name. `leftLit`/`rightLit` are the literal text bordering the
  // placeholder on each side (null at a line edge). A site bordered by nothing but whitespace
  // abutting another placeholder is the weakest kind — it can capture anything a neighbour didn't,
  // which is exactly the ambiguous-run shape this whole design routes around. A whole line that is
  // just one bare placeholder (both sides are line edges) is a special case: its regex matches
  // literally any line, so alone it is evidence of nothing, not "two strong edges" — this is the
  // rule that keeps a hand-written description from being read as e.g. `source = <the whole
  // line>`. `:lower`/`:upper`/`:title` destroy the original casing, so a modified site can never
  // be trusted UNLESS its modifier is in RW._dbModifierInvertible (currently just `:brk`, which
  // only adds/removes bracket punctuation and loses nothing).
  RW._dbSlotScore = function(leftLit, rightLit, modifier){
    function side(lit){
      if (lit == null) return 4; // line edge — the strongest anchor
      const nonSpace = lit.replace(/\s+/g, '');
      if (nonSpace.length >= 2) return 3;
      if (nonSpace.length === 1) return 2;
      return 0; // whitespace-only / empty — abuts another placeholder directly
    }
    const invertible = !modifier || !!RW._dbModifierInvertible[modifier];
    if (leftLit == null && rightLit == null) return invertible ? 1 : 0;
    let score = side(leftLit) + side(rightLit);
    if (invertible) score += 10;
    return score;
  };

  // Compiles one tokenized template line into an anchored, whole-line regex for the reverse
  // parser. `known` is an already-resolved {name: value} map from an earlier pass: a name found in
  // it compiles to a LITERAL (via RW._dbApplyModifier, so it's byte-identical to what RW._dbRender
  // would have produced for that modifier) instead of another capture group — this is the
  // mechanism that resolves an otherwise-ambiguous run once its neighbours are pinned down
  // elsewhere (see RW._dbParseDescription). `loose` widens every remaining capture to lazy `.*?`;
  // it is only ever tried after the tight pass has already failed on this line. Returns null when
  // the line would need more capture groups than `opts.maxSlots` allows, or on any regex-
  // construction failure — contributing no candidates is always safe, a bad line never throws.
  RW._dbBuildLineMatcher = function(tokens, known, loose, opts){
    opts = opts || {};
    const maxSlots = opts.maxSlots != null ? opts.maxSlots : 8;
    known = known || {};

    // What text this token contributes to a rendered line — used only to judge a neighbouring
    // capture's anchor strength and whether a boundary abuts a placeholder with nothing between.
    function neighbourText(tok){
      if (!tok) return null;
      if (tok.type === 'literal') return tok.text;
      if (tok.name === 'a') return 'a'; // always renders to real (non-whitespace) text
      if (tok.name !== 'span' && known[tok.name] != null){
        return RW._dbApplyModifier(String(known[tok.name]), tok.modifier);
      }
      return ''; // an unresolved placeholder contributes nothing to lean on
    }

    const varIdxs = [];
    tokens.forEach((t, i) => { if (t.type === 'var') varIdxs.push(i); });
    const lastVarIdx = varIdxs.length ? varIdxs[varIdxs.length - 1] : -1;
    // The whitespace immediately before the LINE'S LAST capture is relaxed to \s* rather than
    // \s+ — this is what lets "thickness: {thickness}" with a blank thickness still match a
    // right-trimmed description line "thickness:".
    const relaxIdx = (lastVarIdx === tokens.length - 1) ? lastVarIdx - 1 : -1;

    const pieces = [];
    const slots = [];
    let capCount = 0;

    for (let i = 0; i < tokens.length; i++){
      const t = tokens[i];
      if (t.type === 'literal'){
        pieces.push(literalPattern(t.text, i === relaxIdx));
        continue;
      }
      if (t.name === 'a'){
        const an = RW._dbApplyModifier('an', t.modifier);
        const a = RW._dbApplyModifier('a', t.modifier);
        pieces.push('(?:' + RW._dbEscapeRegex(an) + '|' + RW._dbEscapeRegex(a) + ')');
        continue;
      }
      if (t.name !== 'span' && known[t.name] != null){
        pieces.push(literalPattern(RW._dbApplyModifier(String(known[t.name]), t.modifier), false));
        continue;
      }
      const leftLit = neighbourText(tokens[i - 1]);
      const rightLit = neighbourText(tokens[i + 1]);
      const abuts = (leftLit != null && leftLit.trim() === '') || (rightLit != null && rightLit.trim() === '');
      const isLast = (i === lastVarIdx);
      let body;
      if (loose) body = isLast ? '(.*)' : '(.*?)';
      else if (abuts) body = '(\\S*)';
      else if (isLast) body = '(.*)';
      else body = '(.*?)';
      capCount++;
      pieces.push(body);
      slots.push({
        name: t.name, modifier: t.modifier, group: capCount, loose: !!loose,
        score: RW._dbSlotScore(leftLit, rightLit, t.modifier),
      });
    }

    if (capCount > maxSlots) return null;

    let re;
    try { re = new RegExp('^\\s*' + pieces.join('') + '\\s*$'); }
    catch (e){ return null; }
    const wildcard = tokens.length === 1 && tokens[0].type === 'var';
    return { re: re, slots: slots, wildcard: wildcard, varCount: varIdxs.length };

    function literalPattern(text, relaxTrailing){
      if (text === '') return '';
      const parts = text.split(/\s+/).map((p) => RW._dbEscapeRegex(p));
      let joined = parts.join('\\s+');
      if (relaxTrailing && /\s$/.test(text)) joined = joined.replace(/\\s\+$/, '\\s*');
      return joined;
    }
  };

  // Reverse-parses a description (presumably produced by RW._dbRender) against `templateText` back
  // into field values, for prefilling the builder on "Edit Label". Pure, never throws, does not
  // mutate its arguments. `opts`: { maxSlots = 8, maxLineLength = 2000 }.
  //
  // Strategy, per line (see the section comment above for why per-line is sound): a first pass
  // with no outside knowledge recovers whatever it can from well-anchored sites; a second pass
  // compiles those recovered values back in as LITERAL text (through RW._dbApplyModifier, so
  // byte-identical to what render produced) — this is what resolves a line where several
  // placeholders sit only a single space apart, once its neighbours are pinned down elsewhere. A
  // final loose pass (every remaining capture lazy) catches whatever a custom/degraded template
  // still leaves recoverable, tagged weak. If the description's line count doesn't match the
  // template's, a monotonic forward alignment scan finds each template line's best candidate
  // description line first. If NO non-wildcard template line ever matched at all, every candidate
  // sourced only from a whole-line-wildcard placeholder (e.g. a bare {source} alone on its own
  // line) is discarded — that regex matches any text at all, so alone it proves nothing.
  RW._dbParseDescription = function(templateText, descText, opts){
    opts = opts || {};
    const maxLineLength = opts.maxLineLength != null ? opts.maxLineLength : 2000;
    const names = RW._dbParseTemplate(templateText);

    function emptyResult(){
      return {
        values: {}, recovered: [], missing: names.slice(), weak: [], conflicts: [],
        span: null, matchedLines: 0, strongLines: 0, confidence: 0,
      };
    }

    const desc = String(descText == null ? '' : descText);
    if (!names.length || !desc.trim()) return emptyResult();

    let tLines;
    try { tLines = RW._dbTokenizeTemplate(templateText); }
    catch (e){ return emptyResult(); }
    if (!tLines.length) return emptyResult();

    const dLines = desc.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));

    function isWildcardLine(tokens){ return tokens.length === 1 && tokens[0].type === 'var'; }
    function hasRealLiteral(tokens){ return tokens.some((t) => t.type === 'literal' && t.text.trim() !== ''); }
    const isStrongLine = tLines.map((tokens) => !isWildcardLine(tokens) && hasRealLiteral(tokens));
    const strongLines = isStrongLine.filter(Boolean).length;

    function safeBuild(tokens, known, loose){
      try { return RW._dbBuildLineMatcher(tokens, known, loose, opts); }
      catch (e){ return null; }
    }

    // Alignment: identity when the line counts already match (the ordinary case — the text came
    // out of Fill); otherwise a monotonic forward scan assigning each template line the first
    // not-yet-consumed description line its OWN tight (no-knowledge) matcher accepts, so a
    // hand-inserted extra line elsewhere doesn't shift every later template line out of step.
    let align;
    if (dLines.length === tLines.length){
      align = tLines.map((_, i) => i);
    } else {
      align = new Array(tLines.length).fill(-1);
      let cursor = 0;
      for (let i = 0; i < tLines.length; i++){
        const built = safeBuild(tLines[i], {}, false);
        if (!built) continue;
        for (let j = cursor; j < dLines.length; j++){
          if (dLines[j].length <= maxLineLength && built.re.test(dLines[j])){ align[i] = j; cursor = j + 1; break; }
        }
      }
    }

    const known = {};
    const cands = {};      // name -> [{ value, score, wildcard, loose }]
    const spanCands = [];
    const matchedStrong = new Set();
    const lineMatched = new Array(tLines.length).fill(false);

    function runPass(loose){
      for (let i = 0; i < tLines.length; i++){
        if (loose && lineMatched[i]) continue; // a tight match is never downgraded to a loose one
        const di = align[i];
        if (di == null || di < 0 || di >= dLines.length) continue;
        const dLine = dLines[di];
        if (dLine.length > maxLineLength) continue;

        const built = safeBuild(tLines[i], known, loose);
        if (!built) continue;
        if (loose && built.slots.filter((s) => s.loose).length > 4) continue; // degraded-template cap
        const m = built.re.exec(dLine);
        if (!m) continue;

        lineMatched[i] = true;
        if (isStrongLine[i]) matchedStrong.add(i);

        for (const slot of built.slots){
          const raw = m[slot.group] == null ? '' : m[slot.group];
          const value = RW._dbUnapplyModifier(raw, slot.modifier);
          const entry = { value: value, score: slot.score - (loose ? 6 : 0), wildcard: built.wildcard, loose: !!loose };
          if (slot.name === 'span'){ spanCands.push(entry); continue; }
          (cands[slot.name] = cands[slot.name] || []).push(entry);
        }
      }
    }

    function bestOf(list){
      if (!list || !list.length) return null;
      let best = list[0];
      for (const c of list) if (c.score > best.score) best = c;
      return best;
    }

    function arbitrate(){
      for (const name of names){
        const best = bestOf(cands[name]);
        if (best) known[name] = best.value;
      }
    }

    runPass(false); arbitrate(); // pass 1: no outside knowledge
    runPass(false); arbitrate(); // pass 2: assisted by whatever pass 1 recovered
    runPass(true);  arbitrate(); // pass 3: loose fallback, only for lines still unmatched

    if (matchedStrong.size === 0){
      for (const name of Object.keys(cands)) cands[name] = cands[name].filter((c) => !c.wildcard);
      for (let i = spanCands.length - 1; i >= 0; i--) if (spanCands[i].wildcard) spanCands.splice(i, 1);
    }

    const values = {}, recovered = [], missing = [], weak = [], conflicts = [];
    for (const name of names){
      const list = cands[name] || [];
      const best = bestOf(list);
      if (!best){ missing.push(name); continue; }
      values[name] = best.value;
      recovered.push(name);
      if (best.score <= 1 || best.wildcard || best.loose) weak.push(name);
      if (list.some((c) => c.value !== best.value)) conflicts.push(name);
    }

    let span = null;
    const bestSpan = bestOf(spanCands);
    if (bestSpan && bestSpan.value){
      // Round 9: RW._dbComputeSpanWithThickness here, not plain RW._dbSpan — otherwise a
      // description that legitimately used a bot-embedded slab thickness would recompute the
      // WRONG (un-subtracted) figure and get falsely flagged as a manual span override.
      const computed = RW._dbComputeSpanWithThickness(values.top || '', values.bot || '', '').value;
      span = { text: bestSpan.value, computed: computed, overridden: bestSpan.value !== computed };
    }

    const matchedLines = isStrongLine.reduce((n, strong, i) => n + (strong && matchedStrong.has(i) ? 1 : 0), 0);

    return {
      values: values, recovered: recovered, missing: missing, weak: weak, conflicts: conflicts,
      span: span, matchedLines: matchedLines, strongLines: strongLines,
      confidence: strongLines ? matchedLines / strongLines : 0,
    };
  };

  /* ---------- template persistence: a NAMED COLLECTION of templates, not one saved template
     (round 6 — a drawing source's house format genuinely differs from another's, so switching
     source now means picking from a dropdown rather than retyping the whole template). Still a
     deliberate deviation from this family's no-persistence convention (confirmed with the user —
     see CLAUDE.md), still never throws, still degrades silently to in-memory only on a private
     window / blocked site data, matching boon-tagger-darkmode's own storageGet/storageSet
     pattern. RW._dbTemplateStorageKey is round 5's ORIGINAL single-template key — nothing writes
     to it any more, it is read exactly once, at install, as a one-time migration path below. ---------- */

  RW._dbTemplateStorageKey = RW._dbTemplateStorageKey || 'rwDescTemplate'; // legacy — read-only now
  RW._dbTemplatesStorageKey = RW._dbTemplatesStorageKey || 'rwDescTemplates';
  RW._dbActiveTemplateStorageKey = RW._dbActiveTemplateStorageKey || 'rwDescActiveTemplate';

  function dbStorageGet(key){
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function dbStorageSet(key, val){
    try { window.localStorage.setItem(key, val); } catch (e) { /* no-op */ }
  }
  function dbStorageRemove(key){
    try { window.localStorage.removeItem(key); } catch (e) { /* no-op */ }
  }

  /* ---------- default template + suggestion lists (console-overridable) ---------- */

  // The fixed, built-in template — what RW._dbResetTemplateToDefault always restores, regardless
  // of whatever the annotator has since typed or had saved from a previous session.
  RW._dbBuiltinDefaultTemplate = RW._dbBuiltinDefaultTemplate || [
    '{desc} - {keyword}',
    '{source}',
    '{word}: {top:brk} - {bot:brk}',
    'thickness: {thickness}',
    'explanation: The detail shows {a} {thickness} {desc:lower} {keyword:lower} with the {word} of {span}. the thickness can be found in {source} table within the same page while the {word} can be found in {where}',
  ].join('\n');

  // Validates a parsed JSON blob as a template collection: a non-empty array of { name, text }
  // entries, name a non-blank string, text a string. Malformed entries and duplicate names
  // (case-insensitive — first occurrence wins) are dropped rather than rejecting the whole
  // collection outright; if NOTHING valid survives, returns null so the caller falls back to the
  // built-in collection — the same "treat it as nothing saved" discipline round 5 already applies
  // to a whitespace-only single template. Never throws.
  function dbValidateTemplates(list){
    if (!Array.isArray(list)) return null;
    const seen = new Set();
    const out = [];
    for (const entry of list){
      if (!entry || typeof entry.name !== 'string' || typeof entry.text !== 'string') continue;
      const name = entry.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: name, text: entry.text });
    }
    return out.length ? out : null;
  }

  // Loads the saved collection from storage, validated. Returns null when nothing valid was saved
  // (never saved, corrupt JSON, or a validation failure) — the caller falls back to the built-in
  // collection. The JSON.parse lives inside the same try as the storage read, so a throw from
  // either one yields exactly the same "nothing saved" outcome dbStorageGet's own catch does.
  function dbLoadTemplates(){
    const raw = dbStorageGet(RW._dbTemplatesStorageKey);
    if (!raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    return dbValidateTemplates(parsed);
  }

  function dbFindTemplate(name){
    for (const t of RW._dbTemplates) if (t.name === name) return t;
    return null;
  }

  // Never returns undefined — falls back to entry 0 when RW._dbActiveTemplateName names nothing
  // that currently exists (a stale/renamed/deleted selection).
  function dbActiveTemplate(){
    return dbFindTemplate(RW._dbActiveTemplateName) || RW._dbTemplates[0];
  }

  // The one writer for both template-persistence keys. A PRISTINE collection — exactly one entry,
  // named "Default", holding the built-in text — has nothing worth remembering, so it's forgotten
  // (both keys removed) rather than written. This single rule is what keeps
  // RW._dbResetTemplateToDefault's existing "forgotten, not merely overwritten" guarantee (round
  // 5) true in the original single-template case, with no special-casing inside Reset itself.
  function dbPersist(){
    const pristine = RW._dbTemplates.length === 1
      && RW._dbTemplates[0].name === 'Default'
      && RW._dbTemplates[0].text === RW._dbBuiltinDefaultTemplate;
    if (pristine){
      dbStorageRemove(RW._dbTemplatesStorageKey);
      dbStorageRemove(RW._dbActiveTemplateStorageKey);
      return;
    }
    try { dbStorageSet(RW._dbTemplatesStorageKey, JSON.stringify(RW._dbTemplates)); }
    catch (e) { /* a value that can't stringify is simply not saved — never throws */ }
    dbStorageSet(RW._dbActiveTemplateStorageKey, RW._dbActiveTemplateName);
  }

  // Console override precedence, captured BEFORE anything below ever touches
  // RW._dbDefaultTemplate — this is what preserves round 5's existing "a console override set
  // before this module ever ran wins" contract unchanged.
  const dbConsoleTemplateOverride = RW._dbDefaultTemplate;

  // The effective collection, in priority order: a console override (RW._dbTemplates set before
  // this module ran) → a collection saved in a previous session → a round-5-style single legacy
  // template migrated in as one "Default" entry (an existing user's saved template still loads
  // and is selected exactly as it did before this round) → the built-in default, alone.
  RW._dbTemplates = dbValidateTemplates(RW._dbTemplates)
    || dbLoadTemplates()
    || (function(){
      const legacy = dbStorageGet(RW._dbTemplateStorageKey);
      if (legacy && legacy.trim()) return [{ name: 'Default', text: legacy }];
      return [{ name: 'Default', text: RW._dbBuiltinDefaultTemplate }];
    })();

  // The active selection: a saved name that still names a surviving entry wins; otherwise entry 0.
  RW._dbActiveTemplateName = (function(){
    const stored = dbStorageGet(RW._dbActiveTemplateStorageKey);
    return (stored && dbFindTemplate(stored)) ? stored : RW._dbTemplates[0].name;
  })();

  // A console override wins over everything, including a saved/migrated collection — applied to
  // the ACTIVE entry's text in memory only (never persisted), so the mirror invariant just below
  // still holds for every existing consumer.
  if (dbConsoleTemplateOverride && String(dbConsoleTemplateOverride).trim()){
    dbActiveTemplate().text = dbConsoleTemplateOverride;
  }

  // The CURRENT effective default — kept as a MIRROR of the active entry's text, not a standalone
  // value, so every existing consumer (RW._dbCollectValues, RW._dbRebuildFields,
  // RW._dbResetFields, RW._dbReadPrefill, RW._dbRereadPrefill, the fresh-open path) needs no
  // changes at all for this round. Only RW._dbSetActiveTemplate and the template textarea's own
  // `input` listener ever write it.
  RW._dbDefaultTemplate = dbActiveTemplate().text;

  /* ---------- round 12: formula field persistence — its own collection, mirroring the template
     collection's own dbValidateTemplates/dbPersist shape, since formulas are GLOBAL (not tied to
     one template, matching how {span}/{a} aren't either) ---------- */

  RW._dbFormulasStorageKey = RW._dbFormulasStorageKey || 'rwDescFormulas';

  // Drops malformed entries individually — never rejects the whole blob — reusing
  // RW._dbParseFormulaDefinition as the single source of truth for what a valid formula looks
  // like, so validation here can never drift from what RW._dbAddFormula itself accepts.
  function dbValidateFormulas(list){
    if (!Array.isArray(list)) return null;
    const seen = new Set();
    const out = [];
    for (const entry of list){
      if (!entry || typeof entry.name !== 'string' || typeof entry.expr !== 'string') continue;
      const def = RW._dbParseFormulaDefinition('{' + entry.name.trim() + '} = ' + entry.expr);
      if (!def) continue;
      if (BUILTIN_DERIVED_NAMES[def.name]) continue;
      if (def.names.indexOf(def.name) !== -1) continue; // self-reference
      if (def.names.indexOf('a') !== -1) continue; // {a} the article can never be a value
      const key = def.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(def);
    }
    // Second, order-independent pass: drop any entry built from another SURVIVING formula — no
    // chaining, checked here the same way RW._dbAddFormula checks it at definition time, so a
    // hand-edited/console-set collection can't sneak a chain in that validation would refuse.
    const names = new Set(out.map((f) => f.name));
    const kept = out.filter((f) => !f.names.some((n) => names.has(n)));
    return kept.length ? kept : null;
  }

  function dbLoadFormulas(){
    const raw = dbStorageGet(RW._dbFormulasStorageKey);
    if (!raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    return dbValidateFormulas(parsed);
  }

  // Persists only {name, expr} — names/ops are re-derived from expr on every load, never
  // themselves stored, so a future parser change can't leave stale cached derivations behind.
  // Removes the key entirely when the collection is empty, the natural analog of the template
  // collection's own "a pristine collection has nothing worth remembering" rule (round 6) — there
  // is no meaningful "default" formula set the way there's a built-in default template.
  function dbPersistFormulas(){
    if (!RW._dbFormulas.length){ dbStorageRemove(RW._dbFormulasStorageKey); return; }
    try {
      dbStorageSet(RW._dbFormulasStorageKey, JSON.stringify(RW._dbFormulas.map((f) => ({ name: f.name, expr: f.expr }))));
    } catch (e) { /* an unstringifiable value is simply not saved — never throws */ }
  }

  // The ONE writer for DERIVED_NAMES' formula half — idempotent, so add, delete, load, and a
  // console override all go through the same three lines and can never leave a stale derived
  // name (from a formula that no longer exists) behind.
  function dbSyncFormulaDerivedNames(){
    for (const k of Object.keys(DERIVED_NAMES)) if (!BUILTIN_DERIVED_NAMES[k]) delete DERIVED_NAMES[k];
    for (const f of RW._dbFormulas) DERIVED_NAMES[f.name] = true;
  }

  // Console override (RW._dbFormulas set before this module ran) wins over storage, matching the
  // template collection's own precedent; otherwise a saved collection, otherwise none at all.
  RW._dbFormulas = dbValidateFormulas(RW._dbFormulas) || dbLoadFormulas() || [];
  dbSyncFormulaDerivedNames(); // before anything below ever calls RW._dbParseTemplate

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
  // A whole-description override (round 6): hand-edited text that replaces the generated output
  // entirely, for whatever a template genuinely can't express. Session-scoped, per-label content
  // — never persisted, and reset by applyPrefill on every fresh modal open, Clear, and Re-read.
  RW._dbOutputOverridden = false;
  RW._dbOutputOverrideValue = '';
  RW._dbFillArmed = false;
  // Expanded by default; the collapse caret shrinks the whole panel down to its header strip —
  // the one-click way to get it fully out of the way of the host's own Cancel/Save row without
  // removing it. Survives a modal reopen within the session (the root itself is never rebuilt,
  // only its field VALUES are reset — see RW._dbResetFields), same as RW._dbAdvanced.
  RW._dbPanelExpanded = RW._dbPanelExpanded != null ? RW._dbPanelExpanded : true;

  // Below what recovered fraction of the template's well-anchored lines a prefill is declined
  // altogether rather than shown half-guessed — 0 by default (any genuine recovery is applied,
  // per the user's own "prefill what matched" choice), since RW._dbParseDescription's own
  // wildcard-line-drop rule already refuses to recover anything from a description that matches
  // nothing but a bare {source}-style line — the real false-positive guard. Console-overridable,
  // in the style of RW._dbArticleOverrides / RW._dbSuggestions, for an annotator who'd rather see
  // nothing than a lightly-anchored partial guess.
  RW._dbPrefillMinConfidence = RW._dbPrefillMinConfidence != null ? RW._dbPrefillMinConfidence : 0;
  RW._dbLastPrefill = null;   // report-only: the last parse attempt, for the inline status line
  RW._dbPrefillBaseline = ''; // the exact description text this panel currently reproduces byte-for-byte

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

  // Round 6: when RW._dbOutputOverridden, this returns the hand-typed override text instead of
  // rendering — the ONE line the whole whole-description-override feature hangs off. Because the
  // preview, Fill, and the prefill row's byte-for-byte exactness check all already go through this
  // single function, none of them need to change: "what the preview shows is exactly what Fill
  // writes" holds for the override too, for free.
  RW._dbComputeOutput = function(){
    if (RW._dbOutputOverridden) return RW._dbOutputOverrideValue;
    const { templateText, values } = RW._dbCollectValues();
    if (RW._dbNeedsSpan(templateText)){ // round 12 — also true when a live formula reads {span}
      const overrideVal = RW._dbSpanOverridden ? (RW._dbSpanOverrideValue || '') : '';
      values.span = RW._dbComputeSpanWithThickness(values.top || '', values.bot || '', overrideVal).value; // round 9
    }
    return RW._dbRenderFinal(templateText, values); // round 12 — shared with RW._dbDetectTemplate
  };

  RW._dbRunPreview = function(){
    const pre = document.getElementById('rw-db-preview');
    if (pre) pre.innerText = RW._dbComputeOutput();
  };

  /* ---------- whole-description override (round 6): a template can't represent everything, so
     this is the escape hatch for the text a template genuinely can't express — a deliberate copy
     of the span row's own Override/✕ idiom, one level up. Everything hangs off the single line in
     RW._dbComputeOutput above: the preview, Fill, and the prefill exactness check all already
     share that one function, so none of them need to change for this feature. ---------- */

  // Toggles the override on/off. Engaging seeds the override text from `seedText` when given (the
  // auto-engage path below, seeding the untouched original description) or, when omitted, from
  // whatever the preview currently shows (the manual Override button) — computed BEFORE the flag
  // flips, since RW._dbComputeOutput itself consults it.
  RW._dbSetOutputOverridden = function(on, seedText){
    if (on){
      RW._dbOutputOverrideValue = seedText != null ? seedText : RW._dbComputeOutput();
      RW._dbOutputOverridden = true;
    } else {
      RW._dbOutputOverridden = false;
      RW._dbOutputOverrideValue = '';
    }
    RW._dbApplyOutputOverrideUI();
    RW._dbRunPreview();
  };

  // Swaps the read-only preview for an editable textarea (or back) and updates the standing
  // status note. The textarea's value is synced here — on every ENGAGE/DISENGAGE, not on every
  // keystroke — its own `input` listener (RW._dbBuildPanel) updates RW._dbOutputOverrideValue
  // directly instead, so typing never fights the caret.
  RW._dbApplyOutputOverrideUI = function(){
    const pre = document.getElementById('rw-db-preview');
    const ta = document.getElementById('rw-db-output-override');
    const status = document.getElementById('rw-db-output-status');
    const overrideBtn = document.getElementById('rw-db-output-override-btn');
    const revertBtn = document.getElementById('rw-db-output-revert-btn');
    if (pre) pre.style.display = RW._dbOutputOverridden ? 'none' : '';
    if (ta){
      ta.style.display = RW._dbOutputOverridden ? '' : 'none';
      if (RW._dbOutputOverridden) ta.value = RW._dbOutputOverrideValue;
    }
    if (overrideBtn) overrideBtn.style.display = RW._dbOutputOverridden ? 'none' : '';
    if (revertBtn) revertBtn.style.display = RW._dbOutputOverridden ? '' : 'none';
    if (status) status.innerText = RW._dbOutputOverridden
      ? 'manual override — the fields below are not used for this description'
      : '';
  };

  // Rebuilds #rw-db-fields from the current template text: a row per placeholder, in
  // first-appearance order. When `preserve` is true (the default — every template-edit listener
  // calls this with no argument), the value of any name that survives the edit is kept and rows
  // for names that no longer appear are dropped. `seed` (optional) is a {name: value} map applied
  // to a name with no surviving DOM value — this is how RW._dbResetFields' prefill reaches the
  // inputs. RW._dbResetFields passes `preserve: false`: a fresh modal open must start genuinely
  // blank (or exactly what the prefill recovered), never inherit a value by name from whatever
  // label was open before — the callers need different behavior from the same rebuild, not a
  // second rebuild function to keep in sync. Precedence for a given name: a surviving DOM value,
  // then the seed, then RW._dbRememberValues' remembered value from the previous label — the seed
  // outranks "remembered" because it's the text of the label being edited right now, and because
  // an explicitly-recovered BLANK (seed[name] === '', which is `!= null`) must still block a stale
  // remembered value from silently reappearing in its place.
  RW._dbRebuildFields = function(preserve, seed){
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
      if (value == null && seed && seed[name] != null){
        value = seed[name];
      }
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
    const uses = RW._dbNeedsSpan(templateText); // round 12 — also true when a live formula reads {span}
    wrap.style.display = uses ? 'flex' : 'none';
    if (uses) RW._dbRenderSpanDisplay();
  };

  const SPAN_TITLES = {
    computed: 'computed from top − bot',
    'computed-thickness': 'computed from top − thickness − bot (a slab thickness detected inside bot)',
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
    const span = RW._dbComputeSpanWithThickness(values.top || '', values.bot || '', '');
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
    const tplMgrWrap = document.getElementById('rw-db-tplmgr-wrap');
    const formulaWrap = document.getElementById('rw-db-formula-wrap');
    const toggle = document.getElementById('rw-db-adv-toggle');
    if (templateWrap) templateWrap.style.display = RW._dbAdvanced ? '' : 'none';
    if (addVarWrap) addVarWrap.style.display = RW._dbAdvanced ? '' : 'none';
    if (tplMgrWrap) tplMgrWrap.style.display = RW._dbAdvanced ? '' : 'none';
    if (formulaWrap) formulaWrap.style.display = RW._dbAdvanced ? '' : 'none';
    if (toggle) toggle.innerText = RW._dbAdvanced ? 'Simple' : 'Advanced';
    RW._dbApplyTemplateSelectVisibility();
  };

  /* ---------- template selection + management (round 6: a named collection, not one saved
     template) ---------- */

  // Round 7: unconditionally shown in Simple mode too, not just once there's a second template —
  // picking a source template (or noticing Save-as-new exists) is an everyday action even with
  // only "Default" saved. Superseded round 6's own length-gated version.
  RW._dbApplyTemplateSelectVisibility = function(){
    const wrap = document.getElementById('rw-db-tplsel-wrap');
    if (!wrap) return;
    wrap.style.display = '';
  };

  // Rebuilds #rw-db-template-select's <option>s from RW._dbTemplates and syncs its value to the
  // active name. Every mutating action below calls this, so the picker and the collection can
  // never drift apart; it also re-evaluates the picker's own visibility, since the collection's
  // size is exactly what decides that.
  RW._dbRenderTemplateSelect = function(){
    const sel = document.getElementById('rw-db-template-select');
    if (sel){
      clearChildren(sel);
      for (const t of RW._dbTemplates) sel.appendChild(mkEl('option', { value: t.name, innerText: t.name }));
      sel.value = RW._dbActiveTemplateName;
    }
    RW._dbApplyTemplateSelectVisibility();
  };

  // Switches the active template: mirrors its text into RW._dbDefaultTemplate (the invariant
  // every other consumer already relies on) and into the template textarea if present, persists
  // the selection, and re-renders the picker. Setting a textarea's `.value` programmatically does
  // NOT fire `input` (the same gap RW._dbInsertVariable already works around by dispatching one
  // itself), so this function does the rebuild itself rather than relying on that listener.
  // `skipRebuild` lets the Edit-modal auto-detect hook (RW._dbDetectTemplate, below) switch
  // templates just before RW._dbResetFields runs its own authoritative rebuild, without doing the
  // rebuild twice.
  RW._dbSetActiveTemplate = function(name, skipRebuild){
    const entry = dbFindTemplate(name);
    if (!entry) return;
    RW._dbCancelSaveAsArm(); // a switch away from the armed target cancels any pending overwrite confirm
    RW._dbActiveTemplateName = entry.name;
    RW._dbDefaultTemplate = entry.text;
    const templateEl = document.getElementById('rw-db-template');
    if (templateEl) templateEl.value = entry.text;
    dbPersist();
    RW._dbRenderTemplateSelect();
    if (!skipRebuild) RW._dbRebuildFields();
  };

  // Shared basic validation for Save-as-new and Rename: refuse a blank name or one over 40
  // characters — reported inline via `statusEl` rather than silently ignored, matching
  // RW._dbInsertVariable's own refusal discipline. Duplicate-name handling is NOT here — Save-as-new
  // and Rename now disagree on what a duplicate means (round 11), so each checks it separately.
  function dbValidTemplateNameBasic(name, statusEl){
    name = (name || '').trim();
    if (!name){ if (statusEl) statusEl.innerText = 'give the template a name first'; return null; }
    if (name.length > 40){ if (statusEl) statusEl.innerText = 'template name is too long (40 characters max)'; return null; }
    return name;
  }

  // Case-insensitive lookup for an existing entry named exactly `name`, ignoring `ignoreName` —
  // lets Rename validate against every OTHER entry without tripping over the active entry's own
  // (about-to-be-replaced) name; Save-as-new passes null (even the active entry's own name counts).
  function dbFindTemplateByNameCI(name, ignoreName){
    const key = name.toLowerCase();
    for (const t of RW._dbTemplates) if (t.name.toLowerCase() === key && t.name !== ignoreName) return t;
    return null;
  }

  // Round 11: a name that already belongs to another saved template no longer refuses outright —
  // it offers to OVERWRITE that template's text with what's in the box. A two-click confirm, the
  // same idiom RW._dbRunFill's own "Overwrite?" guard already uses on the Fill button: the first
  // click arms and relabels THIS button; a second click on the SAME target name commits; changing
  // the typed name, clicking elsewhere, or waiting the window out de-arms it.
  RW._dbSaveAsArmed = false;
  RW._dbSaveAsArmedName = '';

  // Resets the arm flags/timer/button label only — never touches #rw-db-tpl-status, so a caller
  // that's about to show its OWN status message right after (RW._dbSaveTemplateAs's own
  // invalid-name path, which already wrote one via dbValidTemplateNameBasic) never gets it wiped.
  function dbResetSaveAsButton(){
    RW._dbSaveAsArmed = false;
    RW._dbSaveAsArmedName = '';
    clearTimeout(RW._dbSaveAsArmTimer);
    const btn = document.getElementById('rw-db-tpl-saveas');
    if (btn) btn.innerText = 'Save as new';
  }

  // The public, "this whole thing no longer applies" cancel — resets the button AND clears the
  // status note. #rw-db-tpl-status is used only by the template-management row, so clearing it
  // here unconditionally is safe for every OTHER caller (switching templates, reopening the modal,
  // typing a new name) — none of them have their own status message to protect.
  RW._dbCancelSaveAsArm = function(){
    dbResetSaveAsButton();
    const statusEl = document.getElementById('rw-db-tpl-status');
    if (statusEl) statusEl.innerText = '';
  };

  // Saves the CURRENT template textarea's text as a named entry — a brand-new one, or (see above)
  // overwriting an existing one by name — the escape hatch for a source whose format doesn't match
  // anything saved yet, or whose saved version needs replacing outright.
  RW._dbSaveTemplateAs = function(rawName){
    const statusEl = document.getElementById('rw-db-tpl-status');
    const nameEl = document.getElementById('rw-db-tpl-name');
    const btn = document.getElementById('rw-db-tpl-saveas');
    const templateEl = document.getElementById('rw-db-template');
    const name = dbValidTemplateNameBasic(rawName, statusEl);
    if (!name){ dbResetSaveAsButton(); return; }
    const text = templateEl ? templateEl.value : RW._dbDefaultTemplate;

    const existing = dbFindTemplateByNameCI(name, null);
    if (!existing){
      RW._dbCancelSaveAsArm(); // also clears status — nothing more specific to say than "saved"
      RW._dbTemplates.push({ name: name, text: text });
      RW._dbSetActiveTemplate(name);
      if (nameEl) nameEl.value = '';
      return;
    }

    if (RW._dbSaveAsArmed && RW._dbSaveAsArmedName.toLowerCase() === name.toLowerCase()){
      RW._dbCancelSaveAsArm();
      existing.text = text;
      RW._dbSetActiveTemplate(existing.name);
      if (nameEl) nameEl.value = '';
      return;
    }

    RW._dbSaveAsArmed = true;
    RW._dbSaveAsArmedName = name;
    if (btn) btn.innerText = 'Overwrite?';
    if (statusEl) statusEl.innerText = '"' + existing.name + '" already exists — click Overwrite again to replace its saved text';
    clearTimeout(RW._dbSaveAsArmTimer);
    RW._dbSaveAsArmTimer = setTimeout(RW._dbCancelSaveAsArm, 3000);
  };

  // Renames the ACTIVE entry in place (its text is untouched) and keeps the selection on it —
  // still refuses a duplicate outright (unlike Save-as-new above): renaming to merge two entries
  // into one is a different, more involved operation than this button offers.
  RW._dbRenameTemplate = function(rawName){
    const statusEl = document.getElementById('rw-db-tpl-status');
    const nameEl = document.getElementById('rw-db-tpl-name');
    RW._dbCancelSaveAsArm();
    const entry = dbActiveTemplate();
    const name = dbValidTemplateNameBasic(rawName, statusEl);
    if (!name) return;
    if (dbFindTemplateByNameCI(name, entry.name)){
      if (statusEl) statusEl.innerText = '"' + name + '" already exists — pick a different name';
      return;
    }
    entry.name = name;
    RW._dbActiveTemplateName = name;
    dbPersist();
    RW._dbRenderTemplateSelect();
    if (statusEl) statusEl.innerText = '';
    if (nameEl) nameEl.value = '';
  };

  // Drops the active entry and selects entry 0 — refused when it's the only one left, since
  // there must always be something selected.
  RW._dbDeleteTemplate = function(){
    const statusEl = document.getElementById('rw-db-tpl-status');
    RW._dbCancelSaveAsArm();
    if (RW._dbTemplates.length <= 1){
      if (statusEl) statusEl.innerText = "can't delete the last remaining template";
      return;
    }
    const idx = RW._dbTemplates.indexOf(dbActiveTemplate());
    if (idx !== -1) RW._dbTemplates.splice(idx, 1);
    RW._dbSetActiveTemplate(RW._dbTemplates[0].name);
    if (statusEl) statusEl.innerText = '';
  };

  // Round 12: defines a new formula field from a raw "{total} = {a} + {b}" string. Validation
  // order is deliberate — cheap, pure checks first, the one check that scans every saved
  // template's text (the only non-O(1) one) last — reported inline via `statusEl` rather than
  // silently ignored, matching every other refusal this file already has (RW._dbInsertVariable,
  // RW._dbSaveTemplateAs). Two traps caught during design review, before any code existed: a
  // formula that references its OWN name validates against every OTHER check and then can only
  // ever be blank, forever (its own name is derived the instant it's added, so it can never get a
  // field); and the no-chaining rule needs checking in BOTH directions — an operand that's
  // already a formula, and a new name that's already used as an operand by an EXISTING formula
  // (defining {t}={a}+{b} first, then trying to define {b}={c}+{d}, is the same problem from the
  // other side).
  RW._dbAddFormula = function(rawName){
    const statusEl = document.getElementById('rw-db-formula-status');
    const inputEl = document.getElementById('rw-db-formula-input');
    function fail(msg){ if (statusEl) statusEl.innerText = msg; }

    const raw = String(rawName == null ? '' : rawName).trim();
    const def = RW._dbParseFormulaDefinition(raw);
    if (!def){
      // Distinguish "the whole shape is wrong" from "just the right-hand side is wrong" without a
      // second parser — if a bare {name} = ... shape is present at all, the expression is the
      // specific problem.
      const shapeOk = /^\{[A-Za-z][A-Za-z0-9_]*\}\s*=\s*.+$/.test(raw);
      fail(shapeOk
        ? 'the right-hand side must be two or more {field} names joined only by + or -'
        : 'a formula looks like {total} = {a} + {b}');
      return;
    }
    if (def.name.length > 40){ fail('the formula name is too long (40 characters max)'); return; }
    if (BUILTIN_DERIVED_NAMES[def.name]){ fail('"' + def.name + '" is reserved — pick a different name'); return; }
    const dup = RW._dbFormulas.find((f) => f.name.toLowerCase() === def.name.toLowerCase());
    if (dup){ fail('a formula named "' + dup.name + '" already exists — delete it first'); return; }
    if (def.names.indexOf(def.name) !== -1){
      fail("a formula can't use its own name — {" + def.name + '} is what it defines');
      return;
    }
    const chainedOperand = def.names.find((n) => RW._dbFormulas.some((f) => f.name === n));
    if (chainedOperand){
      fail('"' + chainedOperand + '" is itself a formula — a formula can\'t be built from another one');
      return;
    }
    const usedAsOperandBy = RW._dbFormulas.find((f) => f.names.indexOf(def.name) !== -1);
    if (usedAsOperandBy){
      fail('"' + def.name + '" is already used inside the formula for "' + usedAsOperandBy.name + '" — a formula can\'t be built from another one');
      return;
    }
    if (def.names.indexOf('a') !== -1){
      fail('"a" is the a/an article, not a value — it can\'t be used in a formula');
      return;
    }
    // Prevents a formula from silently breaking an EXISTING template that already uses this name
    // as a real, annotator-typed field — including the live unsaved textarea, which is already
    // covered here since its own `input` listener writes into the active entry on every keystroke.
    const collision = RW._dbTemplates.find((t) => RW._dbParseTemplate(t.text).indexOf(def.name) !== -1);
    if (collision){
      fail('"' + def.name + '" is already a field in the template "' + collision.name + '" — remove it there first, or pick a different name');
      return;
    }

    RW._dbFormulas.push(def);
    dbSyncFormulaDerivedNames();
    dbPersistFormulas();
    RW._dbRenderFormulaList();
    if (inputEl) inputEl.value = '';
    fail('');
    RW._dbRebuildFields(); // a newly-registered derived name can change which fields show
  };

  // Exact-name removal, no confirm — matches RW._dbDeleteTemplate's own no-confirm precedent.
  RW._dbDeleteFormula = function(name){
    const idx = RW._dbFormulas.findIndex((f) => f.name === name);
    if (idx === -1) return;
    RW._dbFormulas.splice(idx, 1);
    dbSyncFormulaDerivedNames();
    dbPersistFormulas();
    RW._dbRenderFormulaList();
    RW._dbRebuildFields();
  };

  // Rebuilds #rw-db-formula-list from scratch: one row per formula, "{name} = expr" plus its own
  // Delete button. Called once at panel build and again after every add/delete.
  RW._dbRenderFormulaList = function(){
    const list = document.getElementById('rw-db-formula-list');
    if (!list) return;
    clearChildren(list);
    for (const f of RW._dbFormulas){
      const row = mkEl('div', { id: 'rw-db-formula-row-' + f.name },
        'display:flex;align-items:center;gap:4px;font-size:11px;margin:2px 0;');
      row.appendChild(mkEl('span', { innerText: '{' + f.name + '} = ' + f.expr }, 'flex:1;'));
      row.appendChild(mkBtn('rw-db-formula-del-' + f.name, 'Delete', 'Delete this formula field',
        () => RW._dbDeleteFormula(f.name)));
      list.appendChild(row);
    }
  };

  // The escape hatch a saved/edited template needs: without this, a bad or unwanted custom
  // template would be permanently stuck, surviving even a re-paste of the loader, with no in-UI
  // way back to the built-in one. Round 6: rescoped to the ACTIVE entry only — a sibling template
  // is left untouched, and Delete (above) is the way out of a bad ADDED template instead.
  // dbPersist()'s own pristine rule (a lone "Default" entry holding the built-in text has nothing
  // worth remembering) is what keeps this "forgetting", not merely overwriting, in the original
  // single-template case, with no special-casing needed here.
  RW._dbResetTemplateToDefault = function(){
    const entry = dbActiveTemplate();
    entry.text = RW._dbBuiltinDefaultTemplate;
    RW._dbDefaultTemplate = entry.text;
    dbPersist();
    const templateEl = document.getElementById('rw-db-template');
    if (templateEl) templateEl.value = RW._dbDefaultTemplate;
    RW._dbRebuildFields();
  };

  // Reverse-parses `descText` against EVERY saved template and returns the best match — or null
  // when nothing anchored matched anything at all (RW._dbParseDescription's own matchedLines
  // stays 0 for every entry), in which case the caller keeps the active template and the existing
  // "does not match" status speaks for itself. Ranking, in order: an EXACT byte-for-byte re-render
  // (proof this description really came from this template, not just a heuristic — the same
  // honest test RW._dbShowPrefill already applies) outranks everything; then matchedLines
  // (absolute count of well-anchored template lines actually matched); then confidence,
  // recovered-field count, and fewer weak fields; ties go to the CURRENTLY ACTIVE template, then
  // to collection order — so detection never switches the annotator's template on a coin flip.
  RW._dbDetectTemplate = function(descText){
    const desc = String(descText == null ? '' : descText);
    if (!desc.trim()) return null;

    let best = null;
    for (const entry of RW._dbTemplates){
      let result;
      try { result = RW._dbParseDescription(entry.text, desc); }
      catch (e){ continue; }
      if (!result.matchedLines) continue;

      // Round 9: RW._dbComputeSpanWithThickness in the fallback (no span text recovered at all),
      // so a description using a bot-embedded slab thickness still reconstructs correctly.
      const span = result.span ? result.span.text : RW._dbComputeSpanWithThickness(result.values.top || '', result.values.bot || '', '').value;
      const values = Object.assign({}, result.values, { span: span });
      let rendered;
      // Round 12: RW._dbRenderFinal, not a separate render+NS call — the single function
      // RW._dbComputeOutput also uses, so a formula's value (and any future addition to that
      // pipeline) is reconstructed here too, without this call site needing its own copy of it.
      try { rendered = RW._dbRenderFinal(entry.text, values); }
      catch (e){ rendered = null; }

      const cand = { name: entry.name, result: result, exact: rendered === desc };
      if (!best || dbBetterDetection(cand, best, entry.name === RW._dbActiveTemplateName)) best = cand;
    }
    return best;
  };

  // True when candidate `a` should replace `b` as the current best detection. `aIsActive` breaks
  // an otherwise-total tie in `a`'s favor when `a` is the currently active template; leaving a
  // real tie unresolved here keeps `b` (i.e. collection order, earlier wins) — see
  // RW._dbDetectTemplate above for the full ranking this implements.
  function dbBetterDetection(a, b, aIsActive){
    if (a.exact !== b.exact) return a.exact;
    if (a.result.matchedLines !== b.result.matchedLines) return a.result.matchedLines > b.result.matchedLines;
    if (a.result.confidence !== b.result.confidence) return a.result.confidence > b.result.confidence;
    if (a.result.recovered.length !== b.result.recovered.length) return a.result.recovered.length > b.result.recovered.length;
    if (a.result.weak.length !== b.result.weak.length) return a.result.weak.length < b.result.weak.length;
    return aIsActive;
  }

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
    // Round 12: DERIVED_NAMES now also contains every formula name, so a plain "reserved" message
    // would be misleading once a formula exists — check that case first and say so specifically.
    const asFormula = RW._dbFormulas.find((f) => f.name === name);
    if (asFormula){
      fail('"' + name + '" is a formula — delete the formula first, or pick a different name');
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
    const btn = document.getElementById('rw-db-fill'); // round 10 — may float outside the modal
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

  /* ---------- reset fields on a fresh modal open, applying a prefill if there is one ---------- */

  // Applies a parsed prefill (or clears back to blank when there isn't one) — the ONE place a
  // prefill becomes visible state, shared by the fresh-open path and the Re-read button below, so
  // the two can never drift apart (the same discipline that keeps the preview and Fill on a
  // single RW._dbComputeOutput). `prefill` is either null (Create, an empty textarea, or the user
  // clicked Clear) or the object RW._dbReadPrefill returns.
  function applyPrefill(prefill){
    RW._dbSpanOverridden = false;
    RW._dbSpanOverrideValue = '';
    RW._dbPrefillBaseline = '';
    if (prefill && prefill.span){ // a recovered manual override — set AFTER the clear above
      RW._dbSpanOverridden = true;
      RW._dbSpanOverrideValue = prefill.span.text || '';
    }
    RW._dbRebuildFields(false, prefill ? prefill.values : null); // `false` still load-bearing (9k)

    // Auto-engage the whole-description override: an Edit modal whose description matched NO
    // saved template at all is precisely the case where the builder is currently at its worst —
    // fields blank, the preview showing the template rendered with empty values, Fill one
    // confirmation away from replacing a real description with that — so the real text is kept
    // verbatim instead, ready to hand-edit. Decided AFTER every clear above, never before (round 4
    // learned this ordering the hard way with RW._dbSpanOverridden — test 17j).
    const info = RW._dbLastPrefill;
    const shouldAutoOverride = !prefill && !!info && !info.applied && !!info.baseline && !!info.baseline.trim();
    RW._dbSetOutputOverridden(shouldAutoOverride, shouldAutoOverride ? info.baseline : undefined);

    RW._dbShowPrefill();
  }

  RW._dbResetFields = function(modal, prefill){
    // round 10 — document.getElementById, not modal.querySelector: the panel may now float
    // outside the modal's own DOM subtree, where a modal-scoped lookup would silently miss.
    const templateEl = document.getElementById('rw-db-template');
    if (templateEl) templateEl.value = RW._dbDefaultTemplate;
    RW._dbFillArmed = false;
    const fillBtn = document.getElementById('rw-db-fill');
    if (fillBtn) fillBtn.innerText = 'Fill Description';
    RW._dbCancelSaveAsArm(); // a fresh open never carries over a stale overwrite confirmation
    applyPrefill(prefill);
  };

  // Reads whatever description is already sitting in the host's own textarea and reverse-parses
  // it back into field values (RW._dbParseDescription). Read-only against the host — never writes
  // #label-description, never clicks anything. Records RW._dbLastPrefill even when it decides NOT
  // to prefill, so the inline status line can say why (this add-on's users are annotators, not
  // programmers — never fail silently). Returns null when there's nothing to apply: a blank
  // textarea, or too little of the template matched to trust (RW._dbPrefillMinConfidence).
  RW._dbReadPrefill = function(modal, templateText){
    RW._dbLastPrefill = null;
    if (!modal) return null;
    const descInp = modal.querySelector('#label-description'); // same selector RW._dbRunFill uses
    if (!descInp) return null;
    const baseline = String(descInp.value == null ? '' : descInp.value);
    if (!baseline.trim()) return null;
    const tpl = templateText != null ? templateText : RW._dbDefaultTemplate;
    let result;
    try { result = RW._dbParseDescription(tpl, baseline); }
    catch (e){ return null; } // a pathological description can never break the panel
    const applied = result.recovered.length > 0 && result.confidence >= RW._dbPrefillMinConfidence;
    RW._dbLastPrefill = { applied: applied, result: result, baseline: baseline, templateName: RW._dbActiveTemplateName };
    if (!applied) return null;
    return {
      values: result.values,
      span: (result.span && result.span.overridden) ? result.span : null,
    };
  };

  // Blanks every field and forgets the current prefill, without touching the host's own
  // Description textarea — the one-click escape hatch when a prefill guessed badly.
  RW._dbClearPrefill = function(){
    RW._dbLastPrefill = null;
    applyPrefill(null);
  };

  // Re-parses the textarea against the template AS IT IS RIGHT NOW — unlike the fresh-open path,
  // which always parses against RW._dbDefaultTemplate (see RW._dbResetFields' template reset just
  // above). The escape hatch for an annotator running a custom Advanced template all session.
  RW._dbRereadPrefill = function(modal){
    const templateEl = document.getElementById('rw-db-template');
    applyPrefill(RW._dbReadPrefill(modal, templateEl ? templateEl.value : RW._dbDefaultTemplate));
  };

  /* ================= panel build + host-modal injection ================= */

  RW._dbBuildPanel = function(modal){
    const descInp = modal.querySelector('#label-description');
    if (!descInp) return;
    // round 10 — document.getElementById, not modal.querySelector: once the panel has floated
    // outside the modal (RW._dbPositionPanel), a modal-scoped check would always miss and a
    // SECOND panel would get built on every later open.
    if (document.getElementById('rw-db-root')) return; // idempotent — already injected

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

    // Template picker — FIRST in body, before the template box itself. Unconditionally visible in
    // Simple mode too (see RW._dbApplyTemplateSelectVisibility), even with only one template saved.
    const tplSelWrap = mkEl('div', { id: 'rw-db-tplsel-wrap' }, 'margin-bottom:4px;display:flex;align-items:center;gap:4px;');
    tplSelWrap.appendChild(mkEl('span', { innerText: 'template' }, 'font-size:10px;opacity:0.75;min-width:50px;'));
    const tplSelect = mkEl('select', { id: 'rw-db-template-select' }, 'flex:1;font-size:11px;');
    tplSelect.addEventListener('change', () => {
      RW._dbSetActiveTemplate(tplSelect.value);
      // Picking the right source template for a label that's already open re-parses its
      // description under it in one action, rather than leaving the annotator to also hit Re-read.
      if (RW._dbLastPrefill) RW._dbRereadPrefill(modal);
    });
    tplSelWrap.appendChild(tplSelect);
    body.appendChild(tplSelWrap);

    const templateWrap = mkEl('div', { id: 'rw-db-template-wrap' }, 'margin-bottom:4px;');
    templateWrap.appendChild(mkEl('div', { innerText: 'Template (edit freely — {name} becomes a field; saved automatically):' },
      'font-size:10px;opacity:0.7;'));
    const templateEl = mkEl('textarea', { id: 'rw-db-template', rows: 6, value: RW._dbDefaultTemplate },
      'width:98%;font-size:11px;font-family:monospace;');
    // Every edit becomes the new effective default (RW._dbDefaultTemplate) AND lands in the
    // ACTIVE entry, saved as part of the whole collection — the one place a template edit flows
    // through, so this is also what makes an edited template survive a same-session modal
    // reopen, not just an actual page reload (see the persistence comments above).
    templateEl.addEventListener('input', () => {
      RW._dbDefaultTemplate = templateEl.value;
      dbActiveTemplate().text = templateEl.value; // the mirror, kept in both directions
      dbPersist();
      RW._dbRebuildFields();
    });
    templateWrap.appendChild(templateEl);
    body.appendChild(templateWrap);

    // Template management — Advanced only: name a template to Save as new or Rename the current
    // one, Delete it, or reset just the current one back to the built-in text.
    const tplMgrWrap = mkEl('div', { id: 'rw-db-tplmgr-wrap' },
      'margin-bottom:4px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;');
    const tplNameEl = mkEl('input', { type: 'text', id: 'rw-db-tpl-name', placeholder: 'template name' }, 'width:110px;font-size:11px;');
    // Typing after an "Overwrite?" arm cancels it — a changed name shouldn't silently confirm
    // overwriting whatever the PREVIOUS name pointed to.
    tplNameEl.addEventListener('input', () => RW._dbCancelSaveAsArm());
    tplMgrWrap.appendChild(tplNameEl);
    tplMgrWrap.appendChild(mkBtn('rw-db-tpl-saveas', 'Save as new',
      'Save the template text above under this name — a brand-new template, or (with confirmation) overwriting an existing one',
      () => RW._dbSaveTemplateAs(document.getElementById('rw-db-tpl-name').value)));
    tplMgrWrap.appendChild(mkBtn('rw-db-tpl-rename', 'Rename',
      'Rename the current template (its text is unchanged)',
      () => RW._dbRenameTemplate(document.getElementById('rw-db-tpl-name').value)));
    tplMgrWrap.appendChild(mkBtn('rw-db-tpl-delete', 'Delete', 'Delete the current template', () => RW._dbDeleteTemplate()));
    tplMgrWrap.appendChild(mkBtn('rw-db-template-reset', 'Reset to default',
      'Restore the built-in template text for the current entry and forget anything saved for it',
      () => RW._dbResetTemplateToDefault()));
    tplMgrWrap.appendChild(mkEl('span', { id: 'rw-db-tpl-status' }, 'font-size:10px;opacity:0.8;'));
    body.appendChild(tplMgrWrap);

    const addVarWrap = mkEl('div', { id: 'rw-db-addvar-wrap' },
      'margin-bottom:4px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;');
    addVarWrap.appendChild(mkEl('input', { type: 'text', id: 'rw-db-addvar-name', placeholder: 'name' }, 'width:70px;font-size:11px;'));
    addVarWrap.appendChild(mkEl('input', { type: 'text', id: 'rw-db-addvar-value', placeholder: 'value' }, 'width:100px;font-size:11px;'));
    addVarWrap.appendChild(mkBtn('rw-db-addvar-insert', 'Insert', "Add {name} to the template at the caret, seeded with this value", () => RW._dbInsertVariable()));
    addVarWrap.appendChild(mkEl('span', { id: 'rw-db-addvar-status' }, 'font-size:10px;opacity:0.8;'));
    body.appendChild(addVarWrap);

    // Round 12: formula fields — a computed field defined once, usable in ANY saved template,
    // like {span}/{a} already are. Never auto-spliced into the current template (unlike Insert
    // above) — the annotator types {name} into whichever template(s) want it, matching how {span}
    // itself is already used today.
    const formulaWrap = mkEl('div', { id: 'rw-db-formula-wrap' },
      'margin-bottom:4px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;');
    formulaWrap.appendChild(mkEl('input', { type: 'text', id: 'rw-db-formula-input', placeholder: '{total} = {a} + {b}' }, 'width:160px;font-size:11px;'));
    formulaWrap.appendChild(mkBtn('rw-db-formula-add', 'Add formula',
      'Define a computed field from other fields — usable in any saved template',
      () => RW._dbAddFormula(document.getElementById('rw-db-formula-input').value)));
    formulaWrap.appendChild(mkEl('span', { id: 'rw-db-formula-status' }, 'font-size:10px;opacity:0.8;'));
    formulaWrap.appendChild(mkEl('div', { id: 'rw-db-formula-list' }, 'width:100%;'));
    body.appendChild(formulaWrap);

    // Inline prefill report — lives OUTSIDE the Advanced-only wrappers on purpose: prefilling an
    // Edit label is an everyday Simple-mode event, and the annotator has to be told when these
    // fields didn't come from them. Hidden until there's something to report (RW._dbShowPrefill).
    const prefillWrap = mkEl('div', { id: 'rw-db-prefill-wrap' },
      'display:none;align-items:center;gap:4px;margin-bottom:4px;font-size:10px;');
    prefillWrap.appendChild(mkEl('span', { id: 'rw-db-prefill-status' }, 'flex:1;opacity:0.8;'));
    prefillWrap.appendChild(mkBtn('rw-db-prefill-reread', 'Re-read',
      'Read the Description field below again, against the template as it is now',
      () => RW._dbRereadPrefill(modal)));
    prefillWrap.appendChild(mkBtn('rw-db-prefill-clear', 'Clear',
      'Blank the fields — ignore the existing description', () => RW._dbClearPrefill()));
    body.appendChild(prefillWrap);

    body.appendChild(mkEl('div', { id: 'rw-db-fields' }));
    body.appendChild(buildSpanRowSkeleton());

    // Output area: a read-only preview by default, swapped for an editable override textarea by
    // the Override button (RW._dbApplyOutputOverrideUI) — the whole-description escape hatch for
    // text a template genuinely can't express.
    const outputHeader = mkEl('div', { id: 'rw-db-output-header' }, 'display:flex;align-items:center;gap:4px;font-size:10px;');
    outputHeader.appendChild(mkEl('span', { id: 'rw-db-output-status' }, 'flex:1;opacity:0.75;'));
    outputHeader.appendChild(mkBtn('rw-db-output-override-btn', 'Override',
      'Hand-edit the whole proposed description instead of generating it from the fields',
      () => RW._dbSetOutputOverridden(true)));
    outputHeader.appendChild(mkBtn('rw-db-output-revert-btn', '✕', 'Revert to the generated description',
      () => RW._dbSetOutputOverridden(false)));
    body.appendChild(outputHeader);

    body.appendChild(mkEl('pre', { id: 'rw-db-preview' },
      'white-space:pre-wrap;font-size:11px;background:#fff;border:1px solid #ccc;padding:4px;margin:4px 0;max-height:100px;overflow-y:auto;'));

    const outputOverrideEl = mkEl('textarea', { id: 'rw-db-output-override', rows: 4 },
      'width:98%;font-size:11px;font-family:monospace;display:none;margin:4px 0;');
    outputOverrideEl.addEventListener('input', () => {
      RW._dbOutputOverrideValue = outputOverrideEl.value;
      RW._dbRunPreview(); // keeps the (hidden) <pre> truthful — never fights the textarea's caret
    });
    body.appendChild(outputOverrideEl);

    body.appendChild(mkBtn('rw-db-fill', 'Fill Description', "Write the rendered text into the Description field below", () => RW._dbRunFill(modal)));

    root.appendChild(body);
    descInp.insertAdjacentElement('beforebegin', root);

    RW._dbApplyAdvancedVisibility();
    RW._dbApplyPanelExpanded();
    RW._dbApplyOutputOverrideUI();
    RW._dbRenderTemplateSelect();
    RW._dbRenderFormulaList();
    RW._dbRebuildFields();
  };

  /* ---------- round 10: float the panel beside the modal when there's room ----------
     Every row this panel adds pushes the host modal's own content down when mounted inline above
     Description. When there's enough room to the modal's right, dock it there instead —
     ATTACHED to the modal (appears/disappears with it, computed once per open) rather than a
     fully independent always-on floating panel; falls back to today's exact inline mount on a
     narrow viewport. Ported from boon-label-management's own floating panel (document.body mount,
     position:fixed, an explicit top/left so it can never fall back to its static position and
     land off-screen — a real bug that repo hit once), with one genuinely new piece that repo has
     no precedent for: visibility synced to a host modal's own show/hide (see
     RW._dbApplyPanelVisibility below) — being a DOM descendant used to give that for free. */

  RW._dbFloatWidth = RW._dbFloatWidth != null ? RW._dbFloatWidth : 320;
  RW._dbFloatGap = RW._dbFloatGap != null ? RW._dbFloatGap : 12;

  // Decides float-vs-inline and applies it. Called ONCE per fresh modal open (from
  // onLabelModalMutation's hidden→visible edge) — deliberately not tracked continuously (no
  // resize listener, no re-check while the modal stays open), matching the user's own choice.
  // Both branches unconditionally re-parent — appendChild/insertAdjacentElement are safe no-ops
  // when the root is already in place, so there's no need to check current parentage first.
  RW._dbPositionPanel = function(modal){
    const root = document.getElementById('rw-db-root');
    const descInp = modal.querySelector('#label-description');
    if (!root || !descInp) return;

    const modalRect = modal.getBoundingClientRect();
    const available = window.innerWidth - modalRect.right;

    if (available >= RW._dbFloatWidth + RW._dbFloatGap){
      document.body.appendChild(root);
      root.style.position = 'fixed';
      root.style.top = Math.max(0, modalRect.top) + 'px';
      root.style.left = (modalRect.right + RW._dbFloatGap) + 'px';
      root.style.width = RW._dbFloatWidth + 'px';
      root.style.maxHeight = Math.min(modalRect.height, window.innerHeight * 0.8) + 'px';
      root.style.marginBottom = '0';
      root.style.zIndex = '2147483646'; // one below the 32-bit max — same constant this family's
                                          // own floating panel (boon-label-management) already uses
    } else {
      root.style.position = '';
      root.style.top = '';
      root.style.left = '';
      root.style.width = '';
      root.style.maxHeight = '40vh';
      root.style.marginBottom = '6px';
      root.style.zIndex = '';
      descInp.insertAdjacentElement('beforebegin', root);
    }
  };

  // Keeps the root's OWN display in sync with the modal's — free when inline (a hidden ancestor
  // already hides its descendants; this is a harmless no-op there), load-bearing when floating
  // (a document.body sibling gets no visibility inheritance from the modal at all). Called on
  // EVERY mutation, not just the fresh-open edge, and deliberately NOT gated by the
  // RW._ocrBoxDrawing skip-reset latch — that latch protects FIELD VALUES from a transient
  // OCR-Box-induced hide, which has nothing to do with the panel's own show/hide, and the host's
  // own modal genuinely does blink hidden during that gesture, so the panel blinking with it is
  // the visually consistent behavior, not something to guard against.
  RW._dbApplyPanelVisibility = function(modal){
    const root = document.getElementById('rw-db-root');
    if (!root) return;
    root.style.display = modalVisible(modal) ? '' : 'none';
  };

  // Composes the inline prefill-status wording — pure, so it's unit-testable without a DOM.
  // `rememberedCount` is how many of the still-missing names RW._dbRememberValues filled in from
  // the previous label instead — the hybrid case where some fields carry a DIFFERENT label's text,
  // which must never be silently invisible.
  RW._dbPrefillStatusText = function(result, applied, rememberedCount, templateName){
    if (!applied) return 'this description does not match the template — fields left blank';
    const total = result.recovered.length + result.missing.length;
    let text = (result.missing.length === 0 ? 'read all ' + total : 'read ' + result.recovered.length + ' of ' + total)
      + ' fields from the existing description';
    if (result.missing.length) text += ' — blank: ' + result.missing.join(', ');
    if (result.weak.length) text += ' — double-check: ' + result.weak.join(', ');
    if (rememberedCount) text += ' (' + rememberedCount + ' from the previous label)';
    if (templateName) text += ' (template: ' + templateName + ')';
    return text;
  };

  // Renders the inline prefill-status row from RW._dbLastPrefill (set by RW._dbReadPrefill).
  // Appends one more clause found only here, not in RW._dbPrefillStatusText: it re-renders through
  // the SAME RW._dbComputeOutput the preview and Fill both use and compares byte-for-byte against
  // the original description — the only honest test of a lossy inverse, and what tells the
  // annotator that hand-added prose is about to be dropped if they click Fill.
  RW._dbShowPrefill = function(){
    const wrap = document.getElementById('rw-db-prefill-wrap');
    const status = document.getElementById('rw-db-prefill-status');
    const clearBtn = document.getElementById('rw-db-prefill-clear');
    if (!wrap || !status) return;
    const info = RW._dbLastPrefill;
    if (!info){ wrap.style.display = 'none'; status.innerText = ''; return; }

    const rememberedCount = (RW._dbRememberValues && RW._dbLastValues)
      ? info.result.missing.filter((n) => RW._dbLastValues[n] != null).length : 0;
    // The template-name clause is noise with only one saved template — only worth naming once
    // there's more than one, since that's the only case where auto-detect could have switched it.
    const templateName = RW._dbTemplates.length > 1 ? info.templateName : null;
    let text = RW._dbPrefillStatusText(info.result, info.applied, rememberedCount, templateName);
    if (info.applied){
      const exact = RW._dbComputeOutput() === info.baseline;
      if (exact) RW._dbPrefillBaseline = info.baseline;
      text += exact ? ' — the preview matches it exactly' : ' — Fill will reword this description';
    } else if (RW._dbOutputOverridden){
      // The auto-engage note (see applyPrefill) — decided and applied BEFORE this function runs,
      // so RW._dbOutputOverridden already reflects it here.
      text += ' — override on, keeping it as-is';
    }
    status.innerText = text;
    wrap.style.display = 'flex';
    if (clearBtn) clearBtn.style.display = info.applied ? '' : 'none';
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
  // "Edit Label" — and, on Edit, also reverse-parses whatever description is already there back
  // into the fields (RW._dbReadPrefill), rather than starting blank the way Create always does.
  function isModalEligible(modal){
    if (!modal || modal.id !== 'label-modal') return false;
    const title = modalTitleText(modal);
    return title === 'Create New Label' || title === 'Edit Label';
  }

  // "Edit Label" is the only title that arrives with a description already in the textarea worth
  // reading back; "Create New Label" always starts blank, exactly as before this round.
  function modalIsEdit(modal){
    return modalTitleText(modal) === 'Edit Label';
  }

  RW._dbMaybeInject = function(modal){
    if (!modal) modal = document.getElementById('label-modal');
    if (!modal) return;
    if (!modalVisible(modal)) return;
    if (!isModalEligible(modal)) return;
    RW._dbBuildPanel(modal);
  };

  // Tracks the modal's own visible/hidden transitions so a fresh open always starts the builder
  // either blank (Create) or prefilled from what's actually there (Edit) — a stale value from the
  // label just closed must never bleed into the next one either way.
  let dbWasVisible = false;
  // Latched true if RW._ocrBoxDrawing — boon-ocr's shared flag, marking its "OCR Box" crop-region
  // gesture — was observed true at any point while the modal was hidden. boon-ocr's OCR Box hides
  // this same #label-modal (a plain inline style.display:none) while the annotator clicks corner
  // points on the canvas, then restores it; this add-on's own MutationObserver (watching
  // class/hidden/style, same as boon-ocr's) can't tell that apart from the host genuinely closing
  // and reopening the dialog, and used to wipe the builder's fields every time. Reading
  // RW._ocrBoxDrawing is a soft, optional, read-only cross-repo coordination — a no-op (always
  // false) when boon-ocr isn't pasted at all, matching this family's existing precedent for such
  // reads (boon-ocr itself defensively reads a workbench flag the same way).
  //
  // Checked here, NOT at the moment visibility is restored: a MutationObserver callback is
  // delivered as a microtask after the whole synchronous handler that caused the mutation
  // finishes, and boon-ocr's finishOcrBoxDraw sets RW._ocrBoxDrawing = false BEFORE restoring the
  // display — by the time this callback runs for that restore, the flag has already flipped back
  // to false. Latching it while genuinely hidden (any callback that fires during that window,
  // including the hide transition itself, still sees it true) and consuming the latch exactly
  // once on the next visible transition sidesteps that timing gap entirely.
  let dbHiddenWhileBoxDrawing = false;
  function onLabelModalMutation(){
    const modal = document.getElementById('label-modal');
    if (!modal) return;
    const nowVisible = modalVisible(modal);
    if (!nowVisible && RW._ocrBoxDrawing) dbHiddenWhileBoxDrawing = true;
    if (nowVisible && !dbWasVisible){
      RW._dbMaybeInject(modal);
      RW._dbPositionPanel(modal); // round 10 — float vs inline, computed once per fresh open
      const skipReset = dbHiddenWhileBoxDrawing;
      dbHiddenWhileBoxDrawing = false;
      if (isModalEligible(modal) && !skipReset){
        let prefill = null;
        if (modalIsEdit(modal)){
          // Round 6: auto-detect which SAVED TEMPLATE this description was written under, and
          // switch the active selection to it before ever reading the prefill — so a label from a
          // different drawing source parses against ITS template, not whatever was active before
          // this modal opened. skipRebuild=true since RW._dbResetFields, just below, runs its own
          // authoritative rebuild immediately after — doing it twice would be wasted work, not a
          // correctness issue.
          const descInp = modal.querySelector('#label-description');
          const hit = RW._dbDetectTemplate(descInp ? descInp.value : '');
          if (hit && hit.name !== RW._dbActiveTemplateName) RW._dbSetActiveTemplate(hit.name, true);
          // Always parsed against the DEFAULT template, not #rw-db-template's current value —
          // RW._dbResetFields is about to stomp the template box back to default too (same as
          // before this round), and the generated field rows will match it. RW._dbRereadPrefill
          // is the escape hatch for parsing against a custom Advanced template instead.
          prefill = RW._dbReadPrefill(modal, RW._dbDefaultTemplate);
        } else {
          RW._dbLastPrefill = null; // Create: nothing to report — clear any stale info from a prior Edit
        }
        RW._dbResetFields(modal, prefill);
      }
    }
    RW._dbApplyPanelVisibility(modal); // round 10 — keep the (possibly floating) panel in sync
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
