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
      const computed = RW._dbSpan(values.top || '', values.bot || '', '').value;
      span = { text: bestSpan.value, computed: computed, overridden: bestSpan.value !== computed };
    }

    const matchedLines = isStrongLine.reduce((n, strong, i) => n + (strong && matchedStrong.has(i) ? 1 : 0), 0);

    return {
      values: values, recovered: recovered, missing: missing, weak: weak, conflicts: conflicts,
      span: span, matchedLines: matchedLines, strongLines: strongLines,
      confidence: strongLines ? matchedLines / strongLines : 0,
    };
  };

  /* ---------- default template + suggestion lists (console-overridable) ---------- */

  RW._dbDefaultTemplate = RW._dbDefaultTemplate || [
    '{desc} - {keyword}',
    '{source}',
    '{word}: {top:brk} - {bot:brk}',
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
    RW._dbShowPrefill();
  }

  RW._dbResetFields = function(modal, prefill){
    const templateEl = modal.querySelector('#rw-db-template');
    if (templateEl) templateEl.value = RW._dbDefaultTemplate;
    RW._dbFillArmed = false;
    const fillBtn = modal.querySelector('#rw-db-fill');
    if (fillBtn) fillBtn.innerText = 'Fill Description';
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
    RW._dbLastPrefill = { applied: applied, result: result, baseline: baseline };
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

    body.appendChild(mkEl('pre', { id: 'rw-db-preview' },
      'white-space:pre-wrap;font-size:11px;background:#fff;border:1px solid #ccc;padding:4px;margin:4px 0;max-height:100px;overflow-y:auto;'));

    body.appendChild(mkBtn('rw-db-fill', 'Fill Description', "Write the rendered text into the Description field below", () => RW._dbRunFill(modal)));

    root.appendChild(body);
    descInp.insertAdjacentElement('beforebegin', root);

    RW._dbApplyAdvancedVisibility();
    RW._dbApplyPanelExpanded();
    RW._dbRebuildFields();
  };

  // Composes the inline prefill-status wording — pure, so it's unit-testable without a DOM.
  // `rememberedCount` is how many of the still-missing names RW._dbRememberValues filled in from
  // the previous label instead — the hybrid case where some fields carry a DIFFERENT label's text,
  // which must never be silently invisible.
  RW._dbPrefillStatusText = function(result, applied, rememberedCount){
    if (!applied) return 'this description does not match the template — fields left blank';
    const total = result.recovered.length + result.missing.length;
    let text = (result.missing.length === 0 ? 'read all ' + total : 'read ' + result.recovered.length + ' of ' + total)
      + ' fields from the existing description';
    if (result.missing.length) text += ' — blank: ' + result.missing.join(', ');
    if (result.weak.length) text += ' — double-check: ' + result.weak.join(', ');
    if (rememberedCount) text += ' (' + rememberedCount + ' from the previous label)';
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
    let text = RW._dbPrefillStatusText(info.result, info.applied, rememberedCount);
    if (info.applied){
      const exact = RW._dbComputeOutput() === info.baseline;
      if (exact) RW._dbPrefillBaseline = info.baseline;
      text += exact ? ' — the preview matches it exactly' : ' — Fill will reword this description';
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
  function onLabelModalMutation(){
    const modal = document.getElementById('label-modal');
    if (!modal) return;
    const nowVisible = modalVisible(modal);
    if (nowVisible && !dbWasVisible){
      RW._dbMaybeInject(modal);
      if (isModalEligible(modal)){
        let prefill = null;
        if (modalIsEdit(modal)){
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
