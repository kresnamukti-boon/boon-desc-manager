// Synthetic Node harness for rw_descbuilder.js — no browser, no network. Loads the real shipped
// module source off disk (never a reimplementation) against a hand-rolled DOM stub, and drives
// real registered listeners via dispatched events wherever that class of bug could otherwise go
// untested (boon-tagger-mask's round-7 elbow bug — a click-handler bug that survived five rounds
// because every test called the detection function directly — is the cautionary precedent this
// whole family's harnesses follow). Stub ported from boon-label-management/verify_labels.js and
// boon-ocr/verify_ocr.js, extended with setAttribute/insertAdjacentElement/classList/
// getComputedStyle for this repo's own needs (a real modal-injection gate and a <datalist>).
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, name){
  if (cond) pass++;
  else { fail++; console.error('FAIL: ' + name); }
}

/* ---------- minimal DOM stub ---------- */

// A real DOMRect (what getBoundingClientRect() actually returns) auto-computes right/bottom from
// left/top/width/height — a plain {left,top,width,height} literal does not. Round 10's
// RW._dbPositionPanel reads .right, so every getBoundingClientRect() stub/override needs it too.
function rect(left, top, width, height){
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function makeStubWindow(){
  const registry = new Map();
  function registerId(el){ if (el && el.id) registry.set(el.id, el); }
  function unregisterId(el){ if (el && el.id && registry.get(el.id) === el) registry.delete(el.id); }
  // A real DOM node has exactly one parent at a time — appendChild/insertBefore/
  // insertAdjacentElement on an already-placed node MOVES it, never duplicates it. Removes `node`
  // from its current parent's _children (if any) without touching the id registry — the node
  // stays registered throughout, since it's about to be re-attached, not detached for good.
  function detachFromParent(node){
    const parent = node && node._parent;
    if (!parent) return;
    const i = parent._children.indexOf(node);
    if (i !== -1) parent._children.splice(i, 1);
  }

  function createElement(tag){
    let _id = '';
    const attrs = {};
    const el = {
      tagName: String(tag).toUpperCase(),
      nodeType: 1,
      _children: [],
      _parent: null,
      _listeners: {},
      style: { cssText: '', display: '' },
      value: '',
      checked: false,
      type: '',
      title: '',
      hidden: false,
      innerText: '',
      innerHTML: '',
      textContent: '',
      selectionStart: null,
      selectionEnd: null,
      classList: {
        _set: new Set(),
        contains(c){ return this._set.has(c); },
        add(c){ this._set.add(c); },
        remove(c){ this._set.delete(c); },
      },
      get id(){ return _id; },
      set id(v){ unregisterId(this); _id = v; registerId(this); },
      get firstChild(){ return this._children.length ? this._children[0] : null; },
      get parentElement(){ return this._parent || null; },
      get parentNode(){ return this._parent || null; },
      // Minimal <select>/<option> support (round 6's template picker) — a real <select> derives
      // `options`/`selectedIndex` from its child <option>s, so approximate that rather than
      // leaving them undefined, even though this repo's own module only ever writes/reads
      // `.value` and listens for `change` (a deliberately narrow contract — see CLAUDE.md).
      get options(){ return this._children.filter((c) => c.tagName === 'OPTION'); },
      get selectedIndex(){
        const opts = this.options;
        for (let i = 0; i < opts.length; i++) if (opts[i].value === this.value) return i;
        return -1;
      },
      setPointerCapture(){}, releasePointerCapture(){},
      setAttribute(name, val){ attrs[name] = String(val); if (name === 'list') this.list = val; },
      getAttribute(name){ return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
      // A real DOM node has exactly one parent at a time — appendChild/insertBefore/
      // insertAdjacentElement on an ALREADY-PLACED node silently MOVES it, never duplicates it.
      // detachFromParent is what gives the stub that semantic (round 10 exposed the gap: nothing
      // previously re-inserted an already-placed element, since RW._dbPositionPanel is the first
      // code to unconditionally re-parent the same node on every open).
      appendChild(child){
        detachFromParent(child);
        this._children.push(child); child._parent = this; registerId(child); return child;
      },
      insertBefore(child, ref){
        detachFromParent(child);
        const idx = this._children.indexOf(ref);
        if (idx === -1) this._children.push(child); else this._children.splice(idx, 0, child);
        child._parent = this; registerId(child); return child;
      },
      removeChild(child){
        const i = this._children.indexOf(child);
        if (i !== -1) this._children.splice(i, 1);
        // Real getElementById only ever finds a node connected to the document — matching that
        // means unregistering the whole detached subtree's ids, not just the removed node's own
        // (a field row detached wholesale must also take its nested input's id out of reach).
        (function unregisterSubtree(node){
          unregisterId(node);
          (node._children || []).forEach(unregisterSubtree);
        })(child);
        return child;
      },
      // Inserts `child` as this element's own next sibling — the one position this repo's
      // injection actually uses (descInp.insertAdjacentElement('beforebegin', root)), i.e.
      // 'beforebegin' inserts immediately BEFORE this element in its parent's child list.
      insertAdjacentElement(pos, child){
        const parent = this._parent;
        if (!parent){ return child; }
        detachFromParent(child); // BEFORE computing idx — child may already sit in this same parent
        const idx = parent._children.indexOf(this);
        const at = pos === 'afterend' ? idx + 1 : idx; // 'beforebegin' (this repo's only use)
        parent._children.splice(at, 0, child);
        child._parent = parent;
        registerId(child);
        return child;
      },
      querySelector(sel){
        if (sel[0] !== '#') return null;
        const wantId = sel.slice(1);
        const stack = this._children.slice();
        while (stack.length){
          const c = stack.shift();
          if (c.id === wantId) return c;
          if (c._children) stack.push(...c._children);
        }
        return null;
      },
      addEventListener(type, fn){ (this._listeners[type] = this._listeners[type] || []).push(fn); },
      removeEventListener(type, fn){
        const arr = this._listeners[type];
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i !== -1) arr.splice(i, 1);
      },
      dispatchEvent(evt){
        try { if (evt.target == null) evt.target = this; } catch (e) { /* real Event: target read-only, fine */ }
        const arr = (this._listeners[evt.type] || []).slice();
        for (const fn of arr) fn(evt);
        return true;
      },
      _fire(type, props){
        const evt = Object.assign({ type, bubbles: true, target: this }, props || {});
        this.dispatchEvent(evt);
        return evt;
      },
      click(){ this._fire('click', {}); },
      focus(){},
      setSelectionRange(s, e){ this.selectionStart = s; this.selectionEnd = e; },
      // width:1200 matches the stub's own innerWidth (below) — right = 1200, leaving NO room to
      // the right by default (round 10's RW._dbPositionPanel), so every existing test keeps
      // mounting inline unchanged; round-10 tests override this per-test to simulate room to float.
      getBoundingClientRect(){ return rect(0, 0, 1200, 100); },
    };
    return el;
  }

  const body = createElement('body');
  const head = createElement('head');
  const docListeners = {};
  const documentStub = {
    body,
    head,
    documentElement: body,
    createElement,
    createTextNode(text){ return { tagName: null, textContent: text, nodeValue: text }; },
    getElementById(id){ return registry.get(id) || null; },
    addEventListener(type, fn){ (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener(type, fn){
      const arr = docListeners[type]; if (!arr) return;
      const i = arr.indexOf(fn); if (i !== -1) arr.splice(i, 1);
    },
    _fire(type, props){
      const evt = Object.assign({ type, target: documentStub }, props || {});
      (docListeners[type] || []).slice().forEach((fn) => fn(evt));
      return evt;
    },
  };

  // Ported verbatim from boon-tagger-darkmode/verify_dark.js — the one sibling with its own
  // localStorage-backed feature already tested this way. `opts.throwing` simulates a private
  // window / blocked site data (both getItem and setItem throw); removeItem never throws, since
  // nothing in either repo relies on a throwing removeItem to test a real failure path.
  function makeStorage(opts){
    opts = opts || {};
    const data = {};
    return {
      getItem(k){ if (opts.throwing) throw new Error('blocked'); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem(k, v){ if (opts.throwing) throw new Error('blocked'); data[k] = String(v); },
      removeItem(k){ delete data[k]; },
      _data: data,
    };
  }

  const winListeners = {};
  const win = {
    document: documentStub,
    innerWidth: 1200,
    innerHeight: 800,
    localStorage: makeStorage(),
    getComputedStyle(el){
      return { display: (el && el.style && el.style.display) || '', visibility: 'visible' };
    },
    addEventListener(type, fn){ (winListeners[type] = winListeners[type] || []).push(fn); },
    removeEventListener(type, fn){
      const arr = winListeners[type]; if (!arr) return;
      const i = arr.indexOf(fn); if (i !== -1) arr.splice(i, 1);
    },
    _fire(type, props){
      const evt = Object.assign({ type }, props || {});
      (winListeners[type] || []).slice().forEach((fn) => fn(evt));
      return evt;
    },
  };

  return { win, doc: documentStub, byId: (id) => registry.get(id) || null, makeStorage };
}

/* ---------- stub MutationObserver (installed lazily, per test, when needed) ---------- */

function makeMutationObserverStub(){
  const instances = [];
  class MO {
    constructor(cb){ this.cb = cb; this.observed = []; instances.push(this); }
    observe(target, opts){ this.observed.push({ target, opts }); }
    disconnect(){}
    trigger(){ this.cb([], this); }
  }
  MO._instances = instances;
  return MO;
}

function loadModule(win, extraGlobals){
  const src = fs.readFileSync(path.join(__dirname, 'rw_descbuilder.js'), 'utf8');
  const sandbox = Object.assign({
    window: win,
    document: win.document,
    annotationState: win.annotationState,
    Event: global.Event || function(type, opts){ this.type = type; this.bubbles = !!(opts && opts.bubbles); },
    MutationObserver: win.MutationObserver,
    setTimeout,
  }, extraGlobals || {});
  const fn = new Function(...Object.keys(sandbox), src + '\n//# sourceURL=rw_descbuilder.js');
  fn(...Object.values(sandbox));
  return win.__RW;
}

function seedWin(win){
  win.window = win;
  win.document.defaultView = win;
  global.window = win;
  return win;
}

// Builds a fake #label-modal: title/code/description/submit-btn, matching the real host's shape
// closely enough for the injection gate and the fill write-back — this add-on never calls
// editLabelCode or clicks the submit button, so unlike boon-label-management's harness there is
// no need to simulate handleLabelCreate's mutation of a catalog at all.
function makeFakeLabelModal(win, opts){
  opts = opts || {};
  const modal = win.document.createElement('div');
  modal.id = 'label-modal';
  win.document.body.appendChild(modal);

  if (!opts.omitTitle){
    const title = win.document.createElement('div');
    title.id = 'label-modal-title';
    title.textContent = opts.title != null ? opts.title : 'Create New Label';
    modal.appendChild(title);
  }
  if (!opts.omitFields){
    const codeInp = win.document.createElement('input'); codeInp.id = 'label-code';
    modal.appendChild(codeInp);
    const descInp = win.document.createElement('textarea'); descInp.id = 'label-description';
    if (opts.description != null) descInp.value = opts.description;
    modal.appendChild(descInp);
    const submitBtn = win.document.createElement('button'); submitBtn.id = 'label-submit-btn';
    submitBtn.addEventListener('click', () => { win._submitClicked = (win._submitClicked || 0) + 1; });
    modal.appendChild(submitBtn);
  }
  return modal;
}

/* ---------- async test runner ---------- */

async function main(){

  /* ===== 1. RW._dbParseFtIn — every accepted form and sign ===== */
  {
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const P = RW._dbParseFtIn;
    ok(P("12'-0\"") === 144, '1a: feet-inches with hyphen separator');
    ok(P("12'-6\"") === 150, '1b: feet + inches, non-zero');
    ok(P("12' 6\"") === 150, '1c: feet + inches, space separator');
    ok(P("12'") === 144, '1d: feet only');
    ok(P('6"') === 6, '1e: inches only');
    ok(P("12'-6 1/2\"") === 150.5, '1f: feet + inches + fraction');
    ok(P('1/2"') === 0.5, '1g: bare fraction inches');
    ok(P("-12'-0\"") === -144, '1h: leading minus sign');
    ok(P("+12'-0\"") === 144, '1i: leading plus sign');
    ok(P("-14'-0\"") === -168, '1j: another negative, used by the headline test');
    ok(P('18') === null, '1k: bare number rejected as ambiguous');
    ok(P('T/WALL') === null, '1l: a datum name is not parseable');
    ok(P('') === null, '1m: empty string');
    ok(P(null) === null, '1n: null');
    ok(P('   ') === null, '1o: whitespace-only');
    ok(P("12'x") === null, '1p: trailing garbage after feet rejected');
  }

  /* ===== 2. RW._dbFormatFtIn — whole inches, exact feet, fractions, zero ===== */
  {
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const F = RW._dbFormatFtIn;
    ok(F(24) === "2'-0\"", '2a: exact feet, no remainder — the headline sample span');
    ok(F(0) === "0'-0\"", '2b: zero');
    ok(F(6) === "0'-6\"", '2c: whole inches under a foot');
    ok(F(150) === "12'-6\"", '2d: feet + whole inches');
    ok(F(6.5) === "0'-6 1/2\"", '2e: fractional remainder reduces to a half');
    ok(F(150.5) === "12'-6 1/2\"", '2f: feet + fractional inches together');
  }

  /* ===== 3. RW._dbSpan — computed / datum fallback / override wins / partial / blank ===== */
  {
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    let r = RW._dbSpan("-12'-0\"", "-14'-0\"", '');
    ok(r.value === "2'-0\"" && r.source === 'computed', '3a: both feet-inches -> subtraction, source computed');
    r = RW._dbSpan('T/WALL', 'T/FOOTING', '');
    ok(r.value === 'T/WALL to T/FOOTING' && r.source === 'datum', '3b: both non-parseable -> datum join');
    r = RW._dbSpan("-12'-0\"", "-14'-0\"", '600mm');
    ok(r.value === '600mm' && r.source === 'override', '3c: override always wins over a computed pair');
    r = RW._dbSpan('T/WALL', 'T/FOOTING', 'full height');
    ok(r.value === 'full height' && r.source === 'override', '3d: override wins over a datum pair too');
    r = RW._dbSpan('T/WALL', '', '');
    ok(r.value === 'T/WALL' && r.source === 'partial', '3e: only top given');
    r = RW._dbSpan('', '', '');
    ok(r.value === '' && r.source === '', '3f: both blank -> blank, no source');
  }

  /* ===== 4. RW._dbParseTemplate — order, dedup, derived names excluded, {{ }} not a var ===== */
  {
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const names = RW._dbParseTemplate('{desc} - {keyword}\n{source}\n{word}: [{top}] - [{bot}]\nthickness: {thickness}\n{a} {thickness} {desc:lower} {span}');
    ok(JSON.stringify(names) === JSON.stringify(['desc', 'keyword', 'source', 'word', 'top', 'bot', 'thickness']),
      '4a: first-appearance order, deduped, span/a excluded — got ' + JSON.stringify(names));
    ok(RW._dbParseTemplate('{{literal}} {real}').join(',') === 'real', '4b: {{ }} escape is not read as a variable');
    ok(RW._dbParseTemplate('').length === 0, '4c: empty template -> no fields');
    ok(RW._dbParseTemplate(null).length === 0, '4d: null template -> no fields');
  }

  /* ===== 5. RW._dbRender — modifiers, unknowns, escaping, blank values keep their line ===== */
  {
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    ok(RW._dbRender('{x:lower}', { x: 'CONCRETE' }) === 'concrete', '5a: :lower modifier');
    ok(RW._dbRender('{x:upper}', { x: 'wall' }) === 'WALL', '5b: :upper modifier');
    ok(RW._dbRender('{x:title}', { x: 'concrete wall' }) === 'Concrete Wall', '5c: :title modifier');
    ok(RW._dbRender('{x:bogus}', { x: 'Wall' }) === 'Wall', '5d: unknown modifier passes through unchanged');
    ok(RW._dbRender('{missing}', {}) === '', '5e: unknown variable renders empty');
    ok(RW._dbRender('{{literal}}', {}) === '{literal}', '5f: {{ }} escapes to a literal single brace');
    ok(RW._dbRender('a\nb\nc', {}) === 'a\nb\nc', '5g: multi-line text integrity with no placeholders');
    ok(RW._dbRender('thickness: {thickness}', { thickness: 'NS' }) === 'thickness: NS', '5h: a literal NS value renders as typed');
    ok(RW._dbRender('thickness: {thickness}', { thickness: '' }) === 'thickness: ',
      '5i: a blank value leaves its line present, not dropped');
    ok(RW._dbRender('thickness: {thickness}', {}) === 'thickness: ',
      '5j: an omitted value also leaves its line present');

    // :brk — brackets a negative feet-inches elevation only; everything else renders bare.
    ok(RW._dbRender('{x:brk}', { x: "-12'-0\"" }) === '[-12\'-0"]', '5k: negative feet-inches gets bracketed');
    ok(RW._dbRender('{x:brk}', { x: "12'-0\"" }) === "12'-0\"", '5l: positive feet-inches renders bare');
    ok(RW._dbRender('{x:brk}', { x: 'T/WALL' }) === 'T/WALL', '5m: a datum name (not parseable) renders bare');
    ok(RW._dbRender('{x:brk}', { x: '' }) === '', '5n: a blank value stays blank under :brk');
    ok(RW._dbRender('{x:brk}', { x: "[-12'-0\"]" }) === '[-12\'-0"]', '5o: an already-bracketed value keeps exactly one layer, not [[...]]');
    ok(RW._dbRender('{x:brk}', { x: '18' }) === '18', '5p: a bare ambiguous number (RW._dbParseFtIn rejects it) renders bare');

    ok(RW._dbUnapplyModifier('[-12\'-0"]', 'brk') === "-12'-0\"", '5q: :brk unapply strips one bracket layer');
    ok(RW._dbUnapplyModifier('T/WALL', 'brk') === 'T/WALL', '5r: :brk unapply is a no-op on an unbracketed value');
    ok(RW._dbUnapplyModifier('Wall', 'lower') === 'Wall', '5s: unapply passes through any non-brk modifier unchanged');
    ok(RW._dbModifierInvertible.brk === true && !RW._dbModifierInvertible.lower,
      '5t: only :brk is registered as losslessly invertible');
  }

  /* ===== 6. {a} article resolution ===== */
  {
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    ok(RW._dbRender('{a} wall', {}) === 'a wall', '6a: consonant word -> "a"');
    ok(RW._dbRender('{a} elbow', {}) === 'an elbow', '6b: vowel-letter word -> "an"');
    ok(RW._dbRender('{a} {thickness} wall', { thickness: '18"' }) === 'an 18" wall', '6c: 18" -> "an"');
    ok(RW._dbRender('{a} {thickness} wall', { thickness: '12"' }) === 'a 12" wall', '6d: 12" -> "a"');
    ok(RW._dbRender('{a} {thickness} wall', { thickness: '80"' }) === 'an 80" wall', '6e: 80 (multiple of 8) -> "an"');
    ok(RW._dbRender('{a} {thickness} wall', { thickness: '11\'' }) === 'an 11\' wall', '6f: 11 -> "an"');
    ok(RW._dbRender('{a} hour', {}) === 'an hour', '6g: RW._dbArticleOverrides — silent-h exception');
    ok(RW._dbRender('{a} unit', {}) === 'a unit', '6h: RW._dbArticleOverrides — vowel-that-sounds-like-consonant exception');
    ok(RW._dbRender('{a:title} wall', {}) === 'A wall', '6i: {a:title} capitalizes the article');
    ok(RW._dbRender('end {a}', {}) === 'end a', '6j: {a} with nothing following defaults to "a"');
  }

  /* ===== 7. Headline test — the sample description, byte-for-byte ===== */
  {
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const values = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes',
    };
    values.span = RW._dbSpan(values.top, values.bot, '').value;
    const out = RW._dbRender(RW._dbDefaultTemplate, values);
    const expected = [
      'Concrete - Wall',
      'schedule',
      'height: [-12\'-0"] - [-14\'-0"]',
      'thickness: 18"',
      'explanation: The detail shows an 18" concrete wall with the height of 2\'-0". the thickness can be found in schedule table within the same page while the height can be found in the plan and notes',
    ].join('\n');
    ok(out === expected, '7a: default template renders the sample description byte-for-byte — got:\n' + out);
  }

  /* ===== 8. Datum variant + word swap ===== */
  {
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const values = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: 'T/WALL', bot: 'T/FOOTING', thickness: '18"', where: 'the plan and notes',
    };
    values.span = RW._dbSpan(values.top, values.bot, '').value;
    let out = RW._dbRender(RW._dbDefaultTemplate, values);
    ok(out.indexOf('height: T/WALL - T/FOOTING') !== -1,
      '8a: datum values render bare (unbracketed) into the measurement line — no unit marks to bracket');
    ok(out.indexOf('with the height of T/WALL to T/FOOTING.') !== -1, '8b: span falls back to "top to bot" in the explanation');

    values.word = 'depth';
    out = RW._dbRender(RW._dbDefaultTemplate, values);
    ok(out.indexOf('depth: T/WALL - T/FOOTING') !== -1 && out.indexOf('with the depth of') !== -1
       && out.indexOf('the depth can be found') !== -1 && out.indexOf('height') === -1,
      '8c: {word} swaps every mention from height to depth in one change');
  }

  /* ===== 9. Injection: idempotency, create+edit gate, hidden/other modal, lazy fallback, reset ===== */
  {
    let s = makeStubWindow(); let win = seedWin(s.win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const modal = win.document.getElementById('label-modal');
    ok(!!modal.querySelector('#rw-db-root'), '9a: "Create New Label" injects at install time');
    RW._dbMaybeInject(modal);
    ok(modal._children.filter((c) => c.id === 'rw-db-root').length === 1, '9b: a repeat call is idempotent (no second root)');
  }
  {
    let s = makeStubWindow(); let win = seedWin(s.win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Edit Label' });
    const RW = loadModule(win);
    const modal = win.document.getElementById('label-modal');
    ok(!!modal.querySelector('#rw-db-root'), '9c: "Edit Label" also injects (unlike boon-ocr\'s create-only rule)');
  }
  {
    let s = makeStubWindow(); let win = seedWin(s.win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    modal.hidden = true;
    const RW = loadModule(win);
    ok(!modal.querySelector('#rw-db-root'), '9d: a hidden modal is not injected into');
  }
  {
    let s = makeStubWindow(); let win = seedWin(s.win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Some Other Dialog' });
    const RW = loadModule(win);
    const modal = win.document.getElementById('label-modal');
    ok(!modal.querySelector('#rw-db-root'), '9e: a non-matching title is not injected into');
  }
  {
    // Modal absent at install time — the document.body childList/subtree fallback observer.
    let s = makeStubWindow(); let win = seedWin(s.win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const RW = loadModule(win);
    ok(!win.document.getElementById('label-modal'), '9f: no modal exists yet at install');
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    // Simulate the body observer firing now that the modal exists.
    MO._instances[0].trigger();
    ok(!!modal.querySelector('#rw-db-root'), '9g: the lazy document.body fallback injects once the modal appears');
  }
  {
    // Hidden -> visible transition clears field values (both Create and a same-session re-Edit).
    let s = makeStubWindow(); let win = seedWin(s.win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    modal.hidden = true;
    const RW = loadModule(win);
    ok(!modal.querySelector('#rw-db-root'), '9h: starts hidden, nothing injected yet');
    modal.hidden = false;
    MO._instances[0].trigger();
    ok(!!modal.querySelector('#rw-db-root'), '9i: becoming visible injects');
    const topField = win.document.getElementById('rw-db-field-top');
    topField.value = "-12'-0\"";
    topField._fire('input', {});
    ok(win.document.getElementById('rw-db-field-top').value === "-12'-0\"", '9j: value actually took before hiding again');
    modal.hidden = true;
    MO._instances[0].trigger();
    modal.hidden = false;
    MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-field-top').value === '', '9k: hidden->visible transition clears the field');
  }

  /* ===== 10. Field rebuild on template edit preserves surviving values, drops removed ones ===== */
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const descField = win.document.getElementById('rw-db-field-desc');
    descField.value = 'Concrete';
    descField._fire('input', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{desc} only, no keyword';
    templateEl._fire('input', {});
    ok(win.document.getElementById('rw-db-field-desc').value === 'Concrete', '10a: a surviving name keeps its value across a template edit');
    ok(!win.document.getElementById('rw-db-field-keyword'), '10b: a removed name\'s row is gone');
  }

  /* ===== 10b. Simple/Advanced toggle ===== */
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-template-wrap').style.display === 'none', '10b-a: Simple is the default — template hidden');
    ok(win.document.getElementById('rw-db-addvar-wrap').style.display === 'none', '10b-b: Simple is the default — add-variable hidden');
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    ok(win.document.getElementById('rw-db-template-wrap').style.display === '', '10b-c: Advanced reveals the template box');
    ok(win.document.getElementById('rw-db-addvar-wrap').style.display === '', '10b-d: Advanced reveals the add-variable row');
    ok(win.document.getElementById('rw-db-adv-toggle').innerText === 'Simple', '10b-e: toggle label flips to "Simple"');
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    ok(win.document.getElementById('rw-db-template-wrap').style.display === 'none', '10b-f: toggling back hides the template again');
  }
  {
    // Advanced mode survives a modal reopen within the session.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    ok(RW._dbAdvanced === true, '10b-g: advanced flag set');
    modal.hidden = true; MO._instances[0].trigger();
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-template-wrap').style.display === '', '10b-h: Advanced survives a reopen');
  }

  /* ===== 10c. Add-variable (Advanced only) ===== */
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});

    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = 'rebar: '; // caret goes to the end below
    templateEl.selectionStart = templateEl.value.length;
    templateEl.selectionEnd = templateEl.value.length;
    win.document.getElementById('rw-db-addvar-name').value = 'rebar';
    win.document.getElementById('rw-db-addvar-value').value = '#5 @ 12" o.c.';
    win.document.getElementById('rw-db-addvar-insert')._fire('click', {});
    ok(templateEl.value === 'rebar: {rebar}', '10c-a: Insert splices {name} at the caret');
    const field = win.document.getElementById('rw-db-field-rebar');
    ok(!!field && field.value === '#5 @ 12" o.c.', '10c-b: the new field appears already carrying the typed value');

    // A selection is replaced, not appended after.
    templateEl.value = 'AAAA';
    templateEl.selectionStart = 1; templateEl.selectionEnd = 3; // selects "AA" (middle)
    win.document.getElementById('rw-db-addvar-name').value = 'mid';
    win.document.getElementById('rw-db-addvar-value').value = 'x';
    win.document.getElementById('rw-db-addvar-insert')._fire('click', {});
    ok(templateEl.value === 'A{mid}A', '10c-c: Insert replaces a selection rather than appending — got ' + templateEl.value);

    // Bad name, derived name, and duplicate are all refused and leave the template untouched.
    const before = templateEl.value;
    win.document.getElementById('rw-db-addvar-name').value = '3bad';
    win.document.getElementById('rw-db-addvar-insert')._fire('click', {});
    ok(templateEl.value === before, '10c-d: a name starting with a digit is refused');
    ok(win.document.getElementById('rw-db-addvar-status').innerText.length > 0, '10c-e: refusal leaves inline status text');

    win.document.getElementById('rw-db-addvar-name').value = 'span';
    win.document.getElementById('rw-db-addvar-insert')._fire('click', {});
    ok(templateEl.value === before, '10c-f: the derived name "span" is refused');

    win.document.getElementById('rw-db-addvar-name').value = 'mid'; // already in the template
    win.document.getElementById('rw-db-addvar-insert')._fire('click', {});
    ok(templateEl.value === before, '10c-g: a duplicate name is refused');
  }

  /* ===== 11. Fill — writes the exact text, dispatches input+change, never submits ===== */
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-field-desc').value = 'Concrete';
    win.document.getElementById('rw-db-field-desc')._fire('input', {});
    win.document.getElementById('rw-db-field-keyword').value = 'Wall';
    win.document.getElementById('rw-db-field-keyword')._fire('input', {});

    const descInp = modal.querySelector('#label-description');
    let inputFired = 0, changeFired = 0;
    descInp.addEventListener('input', () => inputFired++);
    descInp.addEventListener('change', () => changeFired++);

    win.document.getElementById('rw-db-fill')._fire('click', {});
    ok(descInp.value.indexOf('Concrete - Wall') === 0, '11a: Fill writes the exact rendered text (empty textarea, no confirm needed)');
    ok(inputFired === 1 && changeFired === 1, '11b: Fill dispatches both input and change exactly once');
    ok(!win._submitClicked, '11c: Fill never clicks #label-submit-btn — the load-bearing no-auto-submit guard');
    ok(typeof annotationState === 'undefined' || annotationState == null, '11d: annotationState is never touched by this add-on');
  }

  /* ===== 12. Overwrite confirm — a non-empty textarea needs a second click ===== */
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Edit Label' });
    const RW = loadModule(win);
    const descInp = modal.querySelector('#label-description');
    descInp.value = 'A hand-written description already here.';

    win.document.getElementById('rw-db-fill')._fire('click', {});
    ok(descInp.value === 'A hand-written description already here.', '12a: first click on a non-empty textarea writes nothing');
    ok(win.document.getElementById('rw-db-fill').innerText === 'Overwrite?', '12b: the button relabels to "Overwrite?"');

    win.document.getElementById('rw-db-fill')._fire('click', {});
    ok(descInp.value !== 'A hand-written description already here.', '12c: a second click commits the overwrite');
    ok(win.document.getElementById('rw-db-fill').innerText === 'Fill Description', '12d: the button relabels back afterward');
  }
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const descInp = modal.querySelector('#label-description');
    ok(descInp.value === '', 'precondition: a fresh Create modal\'s description starts empty');
    win.document.getElementById('rw-db-fill')._fire('click', {});
    ok(descInp.value !== '', '12e: an empty textarea writes on the very first click, no confirm needed');
  }

  /* ===== 13. <style id="rw-db-style"> injected once, idempotent, names color + background ===== */
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const styles = win.document.head._children.filter((c) => c.id === 'rw-db-style');
    ok(styles.length === 1, '13a: exactly one style tag injected');
    ok(/background/.test(styles[0].textContent) && /color/.test(styles[0].textContent),
      '13b: the style names both a background and a color, not just one');
    RW._dbBuildPanel(win.document.getElementById('label-modal')); // idempotent no-op (root exists)
    ok(win.document.head._children.filter((c) => c.id === 'rw-db-style').length === 1,
      '13c: a repeat build does not inject a second style tag');
  }

  /* ===== 13d. Height cap + collapse — regression guard for the real live bug (panel pushed the
     host's own Cancel/Save row out of view, with no way to reach it or shrink the panel) ===== */
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const root = win.document.getElementById('rw-db-root');
    ok(/max-height/.test(root.style.cssText) && /overflow-y/.test(root.style.cssText),
      '13d-a: the root caps its own height and scrolls internally, regardless of template size');

    const body = win.document.getElementById('rw-db-body');
    ok(!!body && body.style.display !== 'none', '13d-b: the body starts expanded');
    ok(win.document.getElementById('rw-db-collapse').innerHTML === '&#9660;', '13d-c: the caret starts pointing "expanded"');

    win.document.getElementById('rw-db-collapse')._fire('click', {});
    ok(body.style.display === 'none', '13d-d: a click on the caret collapses the body');
    ok(win.document.getElementById('rw-db-collapse').innerHTML === '&#9654;', '13d-e: the caret flips to "collapsed"');
    ok(RW._dbPanelExpanded === false, '13d-f: RW._dbPanelExpanded reflects the collapsed state');

    win.document.getElementById('rw-db-collapse')._fire('click', {});
    ok(body.style.display !== 'none', '13d-g: a second click re-expands');
  }
  {
    // Collapsed state survives a modal reopen within the session (the root is never rebuilt —
    // only field VALUES reset on reopen — same convention as the Advanced toggle, section 10b).
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-collapse')._fire('click', {});
    ok(win.document.getElementById('rw-db-body').style.display === 'none', '13d-h: collapsed before reopen');
    modal.hidden = true; MO._instances[0].trigger();
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-body').style.display === 'none', '13d-i: still collapsed after a reopen');
  }

  /* ===== 14. Cross-tool independence — coexists with boon-ocr's controls on the same textarea ===== */
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    // Simulate boon-ocr's own controls already sitting AFTER #label-description (its real
    // insertAdjacentElement('afterend', ...) idiom), before this add-on ever runs.
    const descInp = modal.querySelector('#label-description');
    const ocrBtn = win.document.createElement('button');
    ocrBtn.id = 'rw-ocr-btn-label-desc';
    descInp.insertAdjacentElement('afterend', ocrBtn);

    const RW = loadModule(win);
    ok(!!modal.querySelector('#rw-db-root'), '14a: this add-on still injects with boon-ocr\'s controls already present');
    ok(!!modal.querySelector('#rw-ocr-btn-label-desc'), '14b: boon-ocr\'s own button is untouched');
    const ids = modal._children.map((c) => c.id);
    ok(new Set(ids).size === ids.length, '14c: no id collides between the two tools\' DOM');
  }

  /* ===== 15. Tokenizer / regex layer — the reverse parser's pure building blocks ===== */
  {
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);

    // 15a: RW._dbEscapeRegex
    const specials = '.*+?^${}()|[]\\';
    for (const ch of specials){
      const re = new RegExp('^' + RW._dbEscapeRegex(ch) + '$');
      ok(re.test(ch), '15a: RW._dbEscapeRegex escapes "' + ch + '" so it matches only itself');
    }
    ok(RW._dbEscapeRegex('a-b') === 'a-b', '15a-2: "-" is left unescaped (no special meaning outside a class)');

    // 15b/15d/15e: RW._dbTokenizeTemplate
    const lines = RW._dbTokenizeTemplate(RW._dbDefaultTemplate);
    ok(lines.length === 5, '15b: the default template tokenizes into 5 lines');
    const line3 = lines[2];
    ok(line3.length === 5
      && line3[0].type === 'var' && line3[0].name === 'word'
      && line3[1].type === 'literal' && line3[1].text === ': '
      && line3[2].type === 'var' && line3[2].name === 'top' && line3[2].modifier === 'brk'
      && line3[3].type === 'literal' && line3[3].text === ' - '
      && line3[4].type === 'var' && line3[4].name === 'bot' && line3[4].modifier === 'brk',
      '15b-2: line 3 tokenizes to [word][": "][top:brk][" - "][bot:brk] — got ' + JSON.stringify(line3));
    const withSpanA = RW._dbTokenizeTemplate('{a} {span}')[0];
    ok(withSpanA.some((t) => t.type === 'var' && t.name === 'a') && withSpanA.some((t) => t.type === 'var' && t.name === 'span'),
      '15d: {a} and {span} ARE tokenized as vars — unlike RW._dbParseTemplate, which drops them');
    const escLine = RW._dbTokenizeTemplate('{{lit}} {x}')[0];
    ok(escLine[0].type === 'literal' && escLine[0].text === '{lit} ', '15c: {{ }} become a literal single brace inside a literal token, never a var');
    ok(RW._dbTokenizeTemplate('{desc:lower}')[0][0].modifier === 'lower', '15e: modifier captured');
    ok(RW._dbTokenizeTemplate('{desc}')[0][0].modifier === null, '15e-2: absent modifier is null');

    // 15f: RW._dbSlotScore
    const S = RW._dbSlotScore;
    ok(S(null, ' - ', null) > S(null, ' - ', 'lower'), '15f: an unmodified site outscores the same site modified');
    ok(S(null, ' - ', 'brk') === S(null, ' - ', null), '15f-2: :brk scores exactly as unmodified — it is losslessly invertible');
    ok(S(null, null, null) < S(null, ' - ', null), '15f-3: a whole-line wildcard scores lower than an anchored site');
    ok(S(null, null, 'lower') === 0, '15f-4: a modified whole-line wildcard scores 0 — it is evidence of nothing');
    ok(S('', '', null) < S(' with the ', ' of ', null), '15f-5: an abutting (whitespace-only) neighbour scores lower than real anchor text');

    // 15g: RW._dbBuildLineMatcher
    const built = RW._dbBuildLineMatcher(lines[0], null, false, {});
    ok(built.slots.length === 2 && built.slots[0].name === 'desc' && built.slots[0].group === 1
      && built.slots[1].name === 'keyword' && built.slots[1].group === 2,
      '15g: slot names/groups line up with template order');
    const knownBuilt = RW._dbBuildLineMatcher(lines[0], { desc: 'Concrete' }, false, {});
    ok(knownBuilt.slots.length === 1 && knownBuilt.slots[0].name === 'keyword',
      '15g-2: a name present in `known` compiles to a literal and produces no slot for it');
    ok(RW._dbBuildLineMatcher(lines[4], null, false, { maxSlots: 2 }) === null,
      '15g-3: a line needing more capture slots than maxSlots returns null');
  }

  /* ===== 16. RW._dbParseDescription — the reverse parser ===== */
  {
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const sampleValues = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes',
    };
    function renderSample(values){
      const v = Object.assign({}, values);
      v.span = RW._dbSpan(v.top || '', v.bot || '', v.span && v.overridden ? v.span : '').value;
      return RW._dbRender(RW._dbDefaultTemplate, v);
    }

    // 16a: byte-for-byte round trip
    const rendered = renderSample(sampleValues);
    const r16a = RW._dbParseDescription(RW._dbDefaultTemplate, rendered);
    let allMatch = true;
    for (const k of Object.keys(sampleValues)) if (r16a.values[k] !== sampleValues[k]) allMatch = false;
    ok(allMatch, '16a: every sampled value round-trips exactly — got ' + JSON.stringify(r16a.values));
    ok(r16a.confidence === 1, '16a-2: confidence is 1 when every strong line matched');
    ok(r16a.missing.length === 0, '16a-3: nothing missing');
    ok(r16a.span && r16a.span.overridden === false, '16a-4: span not flagged as an override — it matches the computed value');

    // 16b: the inverse property — re-render the recovered values, compare byte-for-byte
    const rerendered = renderSample(Object.assign({}, r16a.values, { overridden: r16a.span.overridden, span: r16a.span.text }));
    ok(rerendered === rendered, '16b: re-rendering the recovered values reproduces the original text exactly');

    // 16c: datum variant round-trips, span not an override
    const datumValues = Object.assign({}, sampleValues, { top: 'T/WALL', bot: 'T/FOOTING' });
    const datumRendered = renderSample(datumValues);
    const r16c = RW._dbParseDescription(RW._dbDefaultTemplate, datumRendered);
    ok(r16c.values.top === 'T/WALL' && r16c.values.bot === 'T/FOOTING', '16c: datum names round-trip');
    ok(r16c.span && r16c.span.overridden === false, '16c-2: datum-fallback span not flagged as override');

    // 16d: word swap round-trips (not accidentally tuned to "height")
    const depthValues = Object.assign({}, sampleValues, { word: 'depth' });
    const r16d = RW._dbParseDescription(RW._dbDefaultTemplate, renderSample(depthValues));
    ok(r16d.values.word === 'depth', '16d: {word}="depth" round-trips');

    // 16e: the headline proof — a multi-word desc through the ambiguous explanation run
    const multiWord = Object.assign({}, sampleValues, { desc: 'Reinforced Concrete' });
    const multiRendered = renderSample(multiWord);
    const r16e = RW._dbParseDescription(RW._dbDefaultTemplate, multiRendered);
    ok(r16e.values.desc === 'Reinforced Concrete', '16e: a multi-word desc recovers exactly, not truncated at the first space');
    ok(r16e.values.where === 'the plan and notes', '16e-2: {where} still recovers from the same (now-resolved) explanation line');
    const multiRerendered = renderSample(Object.assign({}, r16e.values, { overridden: r16e.span.overridden, span: r16e.span.text }));
    ok(multiRerendered === multiRendered, '16e-3: the multi-word case round-trips byte-for-byte too');

    // 16f: {where} is not truncated at its first space (multi-word, line-end greedy capture)
    ok(r16a.values.where === 'the plan and notes', '16f: {where} recovers its full multi-word value');

    // 16g: a recovered blank counts as recovered, not missing; beats a remembered value
    const blankThickness = Object.assign({}, sampleValues, { thickness: '' });
    const r16g = RW._dbParseDescription(RW._dbDefaultTemplate, renderSample(blankThickness));
    ok(r16g.values.thickness === '' && r16g.recovered.indexOf('thickness') !== -1 && r16g.missing.indexOf('thickness') === -1,
      '16g: a blank thickness is recovered as "", not reported missing');

    // 16h: a name appearing only under a lossy modifier recovers the MODIFIED text (documented loss)
    const r16h = RW._dbParseDescription('{desc:lower} only', RW._dbRender('{desc:lower} only', { desc: 'Concrete' }));
    ok(r16h.values.desc === 'concrete', '16h: {desc:lower}-only site recovers lowercased text, not the original casing');

    // 16i: negative — section 12's exact hand-written fixture recovers nothing
    const r16i = RW._dbParseDescription(RW._dbDefaultTemplate, 'A hand-written description already here.');
    ok(r16i.recovered.length === 0 && r16i.confidence === 0, '16i: an unrelated hand-written description recovers nothing (the wildcard-line rule)');

    // 16j: negative — unrelated multi-line prose
    const r16j = RW._dbParseDescription(RW._dbDefaultTemplate, 'Some notes.\nMore notes.\nEven more notes here.');
    ok(r16j.confidence < 1, '16j: unrelated prose does not falsely report full confidence');

    // 16k: negative — blank/missing description never throws
    ['', null, undefined, '   '].forEach((d, i) => {
      let threw = false, r;
      try { r = RW._dbParseDescription(RW._dbDefaultTemplate, d); } catch (e){ threw = true; }
      ok(!threw && r && r.recovered.length === 0, '16k-' + i + ': blank/missing description (' + JSON.stringify(d) + ') -> empty result, no throw');
    });

    // 16l: negative — blank/missing template never throws
    [null, ''].forEach((t, i) => {
      let threw = false, r;
      try { r = RW._dbParseDescription(t, 'Concrete - Wall'); } catch (e){ threw = true; }
      ok(!threw && r && r.recovered.length === 0, '16l-' + i + ': blank template (' + JSON.stringify(t) + ') -> empty result, no throw');
    });

    // 16m: partial description (only the first two lines present)
    const r16m = RW._dbParseDescription(RW._dbDefaultTemplate, 'Concrete - Wall\nschedule');
    ok(r16m.recovered.indexOf('desc') !== -1 && r16m.recovered.indexOf('keyword') !== -1 && r16m.recovered.indexOf('source') !== -1,
      '16m: desc/keyword/source recovered from the two present lines');
    ok(r16m.missing.indexOf('top') !== -1 && r16m.missing.indexOf('thickness') !== -1 && r16m.missing.indexOf('where') !== -1,
      '16m-2: the absent lines\' names are reported missing');
    ok(Math.abs(r16m.confidence - 0.25) < 1e-9, '16m-3: confidence reflects 1 of 4 strong lines matched — got ' + r16m.confidence);

    // 16n: a hand-added extra line still lets the anchored lines recover, but the round trip is not exact
    const withExtra = rendered + '\nP.S. see markup on sheet A-101';
    const r16n = RW._dbParseDescription(RW._dbDefaultTemplate, withExtra);
    ok(r16n.recovered.length === 8, '16n: an extra trailing line does not cost recovery of the 5 real template lines');
    const r16nRerendered = renderSample(Object.assign({}, r16n.values, { overridden: r16n.span.overridden, span: r16n.span.text }));
    ok(r16nRerendered !== withExtra, '16n-2: the extra line means the re-render is NOT byte-identical (no Fill baseline)');

    // 16o: span override recovery
    const overrideRendered = RW._dbRender(RW._dbDefaultTemplate, Object.assign({}, sampleValues, { span: '600mm' }));
    const r16o = RW._dbParseDescription(RW._dbDefaultTemplate, overrideRendered);
    ok(r16o.span && r16o.span.overridden === true && r16o.span.text === '600mm', '16o: a manual span override is recovered and flagged');
    ok(r16o.values.top === sampleValues.top && r16o.values.bot === sampleValues.bot, '16o-2: top/bot still recover normally alongside an overridden span');

    // 16p: {{ }} literal braces round-trip
    const braceTpl = '{{literal}} {x}';
    const braceRendered = RW._dbRender(braceTpl, { x: 'value' });
    ok(braceRendered === '{literal} value', 'precondition: brace template renders as expected');
    const r16p = RW._dbParseDescription(braceTpl, braceRendered);
    ok(r16p.values.x === 'value', '16p: {{ }} braces are not misread as a variable during parsing');

    // 16q: backtracking guard — a long adversarial line completes fast, and an over-length line is skipped
    const t0 = Date.now();
    RW._dbParseDescription(RW._dbDefaultTemplate, ['a', 'b', 'c', 'd', ('x '.repeat(900).trim())].join('\n'));
    ok(Date.now() - t0 < 250, '16q: a long non-matching line completes well under 250ms (no catastrophic backtracking)');
    const overCap = RW._dbParseDescription(RW._dbDefaultTemplate, ['a', 'b', 'c', 'd', ('y '.repeat(1200).trim())].join('\n'), { maxLineLength: 2000 });
    ok(overCap.recovered.length === 0 || overCap.recovered.length < 8, '16q-2: an over-length line is skipped rather than matched against');

    // 16r: purity — deterministic, arguments unmutated, shared VAR_RE state not leaked
    const tplBefore = RW._dbDefaultTemplate;
    const rA = JSON.stringify(RW._dbParseDescription(tplBefore, 'Concrete - Wall'));
    const rB = JSON.stringify(RW._dbParseDescription(tplBefore, 'Concrete - Wall'));
    ok(rA === rB, '16r: two identical calls return identical results');
    ok(RW._dbDefaultTemplate === tplBefore, '16r-2: the template argument is not mutated');
    ok(RW._dbParseTemplate(RW._dbDefaultTemplate).length === 8, '16r-3: RW._dbParseTemplate still works correctly after a parse (VAR_RE.lastIndex not left dirty)');

    // 16s: bracket-specific — a description written under the OLD always-bracket template recovers
    // top/bot UNBRACKETED, and a positive pair round-trips with no brackets at all.
    const oldStyleDesc = [
      'Concrete - Wall', 'schedule', 'height: [12\'-0"] - [10\'-0"]', 'thickness: 18"',
      'explanation: The detail shows an 18" concrete wall with the height of 2\'-0". the thickness can be found in schedule table within the same page while the height can be found in the plan and notes',
    ].join('\n');
    const r16s = RW._dbParseDescription(RW._dbDefaultTemplate, oldStyleDesc);
    ok(r16s.values.top === "12'-0\"" && r16s.values.bot === "10'-0\"",
      '16s: an old always-bracketed description recovers top/bot unbracketed');
    const positiveValues = Object.assign({}, sampleValues, { top: "12'-0\"", bot: "10'-0\"" });
    const positiveRendered = renderSample(positiveValues);
    ok(positiveRendered.indexOf('height: 12\'-0" - 10\'-0"') !== -1, '16s-2: re-rendering a positive pair yields no brackets at all');
    ok(positiveRendered.indexOf('[') === -1, '16s-3: no bracket character anywhere in a fully-positive render');
  }

  /* ===== 17. The seam and the UI: Edit prefills, Create doesn't, Clear/Re-read, span override ===== */
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    // Build the rendered description with a throwaway module instance first (RW._dbRender/_dbSpan
    // are pure — safe to call before the real modal-driving instance below is even created).
    const helperWin = seedWin(makeStubWindow().win);
    const RWHelper = loadModule(helperWin);
    const sample = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes',
    };
    sample.span = RWHelper._dbSpan(sample.top, sample.bot, '').value;
    const rendered = RWHelper._dbRender(RWHelper._dbDefaultTemplate, sample);

    const modal = makeFakeLabelModal(win, { title: 'Edit Label', description: rendered });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-field-desc').value === 'Concrete', '17a: an Edit modal prefills a field from the existing description');
    ok(win.document.getElementById('rw-db-field-thickness').value === '18"', '17a-2: another field prefills too');
    ok(win.document.getElementById('rw-db-preview').innerText === rendered, '17b: the preview matches the original description byte-for-byte right after open');
    ok(win.document.getElementById('rw-db-prefill-status').innerText.indexOf('preview matches it exactly') !== -1,
      '17b-2: the status line confirms the exact match');

    // 17o: the prefill path never writes the host textarea and never submits
    const descInp = modal.querySelector('#label-description');
    ok(descInp.value === rendered, '17o: #label-description is untouched by prefilling (still exactly what was there)');
    ok(!win._submitClicked, '17o-2: prefilling never clicks #label-submit-btn');

    // 17e: status names the count, Clear visible
    ok(win.document.getElementById('rw-db-prefill-status').innerText.indexOf('read all 8 fields') !== -1,
      '17e: status reports all 8 fields read');
    ok(win.document.getElementById('rw-db-prefill-clear').style.display !== 'none', '17e-2: Clear button visible after a successful prefill');

    // 17f: Clear blanks every field, hides the row, leaves the host textarea untouched
    win.document.getElementById('rw-db-prefill-clear')._fire('click', {});
    ok(win.document.getElementById('rw-db-field-desc').value === '', '17f: Clear blanks a prefilled field');
    ok(win.document.getElementById('rw-db-prefill-wrap').style.display === 'none', '17f-2: Clear hides the status row');
    ok(RW._dbSpanOverridden === false && RW._dbPrefillBaseline === '', '17f-3: Clear resets span-override and baseline state');
    ok(descInp.value === rendered, '17f-4: Clear never touches the host\'s own Description field');

    // 17m: the prefill row is visible in Simple mode (not gated by Advanced)
    ok(win.document.getElementById('rw-db-template-wrap').style.display === 'none', 'precondition: Simple mode is the default');
  }
  {
    // 17c: a Create modal with the very same rendered text sitting in the textarea does NOT prefill
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const helperWin = seedWin(makeStubWindow().win);
    const RWHelper = loadModule(helperWin);
    const sample = { desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height', top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes' };
    sample.span = RWHelper._dbSpan(sample.top, sample.bot, '').value;
    const rendered = RWHelper._dbRender(RWHelper._dbDefaultTemplate, sample);
    makeFakeLabelModal(win, { title: 'Create New Label', description: rendered });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-field-desc').value === '', '17c: a Create modal never prefills, even with text already in the textarea');
    ok(win.document.getElementById('rw-db-prefill-wrap').style.display === 'none', '17c-2: the prefill status row stays hidden on Create');
  }
  {
    // 17d: unparseable description -> blank, status explains, Clear hidden
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Edit Label', description: 'A hand-written description already here.' });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-field-desc').value === '', '17d: an unparseable description leaves fields blank');
    ok(win.document.getElementById('rw-db-prefill-status').innerText.indexOf('does not match') !== -1, '17d-2: status explains it could not match');
    ok(win.document.getElementById('rw-db-prefill-clear').style.display === 'none', '17d-3: Clear is hidden — nothing to clear');
  }
  {
    // 17g/17h: a modal reopen re-prefills from whatever's there NOW, and Create after Edit stays blank
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Edit Label', description: 'Concrete - Wall\nschedule' });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-field-desc').value === 'Concrete', 'precondition: first Edit open prefilled desc');

    modal.hidden = true; MO._instances[0].trigger();
    modal.querySelector('#label-modal-title').textContent = 'Edit Label';
    modal.querySelector('#label-description').value = 'CMU - Footing';
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-field-desc').value === 'CMU', '17g: reopening on a DIFFERENT Edit description prefills the new values, not the old');
    ok(win.document.getElementById('rw-db-field-keyword').value === 'Footing', '17g-2: the other recovered field also updated');

    modal.hidden = true; MO._instances[0].trigger();
    modal.querySelector('#label-modal-title').textContent = 'Create New Label';
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-field-desc').value === '', '17h: reopening as Create after an Edit prefill still starts blank');
    ok(win.document.getElementById('rw-db-prefill-wrap').style.display === 'none', '17h-2: the status row is hidden on that Create open too (no stale text from the prior Edit)');
  }
  {
    // 17i: RW._dbRememberValues fills in whatever the prefill itself missed, and the status
    // reports both counts. Reuses ONE modal element throughout (as 17g/17h do) — a hidden->visible
    // transition on the SAME #label-modal is exactly what a real re-open of the host's dialog
    // looks like to this add-on's observer.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    RW._dbRememberValues = true;

    // First label: fill EVERY field with a real (non-blank) value, then Fill with remembering on
    // — so RW._dbLastValues ends up with a genuinely useful value for every name, not blanks.
    const firstValues = {
      desc: 'CMU', keyword: 'Beam', source: 'detail', word: 'depth',
      top: "-1'-0\"", bot: "-2'-0\"", thickness: '8"', where: 'the roof plan',
    };
    for (const name of Object.keys(firstValues)){
      const el = win.document.getElementById('rw-db-field-' + name);
      el.value = firstValues[name];
      el._fire('input', {});
    }
    win.document.getElementById('rw-db-fill')._fire('click', {});
    ok(RW._dbLastValues && RW._dbLastValues.where === 'the roof plan', 'precondition: remembering captured the first label\'s values');

    // Second label (Edit): only lines 1-2 present, so desc/keyword/source are recovered from the
    // description itself; top/bot/thickness/where are missing from it and should fall back to
    // the remembered values from the first label.
    modal.hidden = true; MO._instances[0].trigger();
    modal.querySelector('#label-modal-title').textContent = 'Edit Label';
    modal.querySelector('#label-description').value = 'CMU - Slab\nplan and notes';
    modal.hidden = false; MO._instances[0].trigger();

    ok(win.document.getElementById('rw-db-field-desc').value === 'CMU', '17i: desc recovered from the description itself');
    ok(win.document.getElementById('rw-db-field-where').value === 'the roof plan', '17i-2: a name the prefill missed falls back to the remembered value');
    const statusText = win.document.getElementById('rw-db-prefill-status').innerText;
    ok(statusText.indexOf('from the previous label') !== -1, '17i-3: the status line discloses that some fields came from the previous label, not this description');
  }
  {
    // 17j: span-override ordering — the recovered override must survive RW._dbResetFields' own
    // clearing, which runs first (see applyPrefill).
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const helperWin = seedWin(makeStubWindow().win);
    const RWHelper = loadModule(helperWin);
    const sample = { desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height', top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes', span: '600mm' };
    const rendered = RWHelper._dbRender(RWHelper._dbDefaultTemplate, sample);
    makeFakeLabelModal(win, { title: 'Edit Label', description: rendered });
    const RW = loadModule(win);
    ok(RW._dbSpanOverridden === true, '17j: a manual span override in the description is recovered');
    const overrideInput = win.document.getElementById('rw-db-span-override-input');
    ok(!!overrideInput && overrideInput.value === '600mm', '17j-2: the override input shows the recovered text');
    ok(!win.document.getElementById('rw-db-span-display'), '17j-3: the computed-span display is not shown while overridden');
  }
  {
    // 17k: Edit still requires two clicks on Fill even when the description was prefilled exactly
    // (the guard is unchanged this round — see CLAUDE.md "Deferred").
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const helperWin = seedWin(makeStubWindow().win);
    const RWHelper = loadModule(helperWin);
    const sample = { desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height', top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes' };
    sample.span = RWHelper._dbSpan(sample.top, sample.bot, '').value;
    const rendered = RWHelper._dbRender(RWHelper._dbDefaultTemplate, sample);
    const modal = makeFakeLabelModal(win, { title: 'Edit Label', description: rendered });
    const RW = loadModule(win);
    const descInp = modal.querySelector('#label-description');
    win.document.getElementById('rw-db-fill')._fire('click', {});
    ok(descInp.value === rendered, '17k: the first click on an exactly-prefilled Edit modal still only asks');
    ok(win.document.getElementById('rw-db-fill').innerText === 'Overwrite?', '17k-2: the button still relabels to Overwrite?');
    win.document.getElementById('rw-db-fill')._fire('click', {});
    ok(descInp.value === rendered, '17k-3: a second click commits — text is unchanged since it round-trips exactly');
  }
  {
    // 17n: Re-read parses against the CURRENT #rw-db-template, not the default
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Edit Label', description: 'rebar: #5 @ 12" o.c.' });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-prefill-status').innerText.indexOf('does not match') !== -1,
      'precondition: the default template does not match this custom-looking description');
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {}); // reveal the template box
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = 'rebar: {rebar}';
    templateEl._fire('input', {});
    win.document.getElementById('rw-db-prefill-reread')._fire('click', {});
    ok(win.document.getElementById('rw-db-field-rebar').value === '#5 @ 12" o.c.', '17n: Re-read against a custom template recovers its own field');
  }
  {
    // 17p: RW._dbPrefillStatusText wordings, pure
    let win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    ok(RW._dbPrefillStatusText({}, false, 0) === 'this description does not match the template — fields left blank',
      '17p: not-applied wording');
    ok(RW._dbPrefillStatusText({ recovered: ['a', 'b'], missing: [], weak: [] }, true, 0) === 'read all 2 fields from the existing description',
      '17p-2: all-recovered wording');
    ok(RW._dbPrefillStatusText({ recovered: ['a'], missing: ['b'], weak: [] }, true, 0) === 'read 1 of 2 fields from the existing description — blank: b',
      '17p-3: partial wording names the blanks');
    ok(RW._dbPrefillStatusText({ recovered: ['a'], missing: [], weak: ['a'] }, true, 0).indexOf('double-check: a') !== -1,
      '17p-4: weak wording flags a site to double-check');
    ok(RW._dbPrefillStatusText({ recovered: ['a'], missing: ['b'], weak: [] }, true, 2).indexOf('(2 from the previous label)') !== -1,
      '17p-5: remembered wording names the count');
  }

  /* ===== 18. OCR Box interaction — a hidden-by-boon-ocr flicker must not wipe the builder ===== */
  {
    // 18a/18b: RW._ocrBoxDrawing latched true during the hidden window suppresses the reset.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-field-desc').value = 'Concrete';
    win.document.getElementById('rw-db-field-desc')._fire('input', {});

    modal.hidden = true; MO._instances[0].trigger();     // boon-ocr's armOcrBoxDraw-style hide
    RW._ocrBoxDrawing = true;                             // set AFTER the hide, same as the real sequence
    MO._instances[0].trigger();                           // a mutation firing while still hidden latches it
    RW._ocrBoxDrawing = false;                            // finishOcrBoxDraw clears it BEFORE restoring display
    modal.hidden = false; MO._instances[0].trigger();     // the restore
    ok(win.document.getElementById('rw-db-field-desc').value === 'Concrete',
      '18a: a hidden->visible flip latched during OCR Box drawing does not wipe a typed field');

    // 18b: the skip is one-shot — a genuine reopen right after still resets normally.
    modal.hidden = true; MO._instances[0].trigger();
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-field-desc').value === '',
      '18b: the very next hidden->visible transition (no box-drawing flag) resets normally — the skip does not stick');
  }
  {
    // 18c: RW._ocrBoxDrawing never set at all -> existing behavior is completely unaffected.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-field-top').value = "-12'-0\"";
    win.document.getElementById('rw-db-field-top')._fire('input', {});
    modal.hidden = true; MO._instances[0].trigger();
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-field-top').value === '',
      '18c: with boon-ocr absent entirely (RW._ocrBoxDrawing never set), hidden->visible still resets exactly as before');
  }
  {
    // 18d: an Edit modal behaves the same way — the prefill/reprefill also survives an OCR Box flicker.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Edit Label', description: 'Concrete - Wall\nschedule' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-field-thickness').value = '18"'; // a value the description itself never had
    win.document.getElementById('rw-db-field-thickness')._fire('input', {});

    modal.hidden = true; MO._instances[0].trigger();
    RW._ocrBoxDrawing = true;
    MO._instances[0].trigger();
    RW._ocrBoxDrawing = false;
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-field-thickness').value === '18"',
      '18d: an Edit modal\'s hand-typed field also survives an OCR Box flicker, not just Create\'s blank fields');
  }

  /* ===== 19. Template persistence — survives a modal reopen and, via localStorage, a reload ===== */
  {
    // 19a: a pre-seeded stored value is loaded as RW._dbDefaultTemplate at install, and the
    // textarea (once built, Advanced mode) reflects it.
    const s = makeStubWindow();
    let win = seedWin(s.win);
    win.MutationObserver = makeMutationObserverStub();
    win.localStorage.setItem('rwDescTemplate', '{onlyfield}');
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbDefaultTemplate === '{onlyfield}', '19a: a seeded stored template becomes the effective default at install');
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    ok(win.document.getElementById('rw-db-template').value === '{onlyfield}', '19a-2: the Advanced template textarea reflects the seeded value');
    ok(!!win.document.getElementById('rw-db-field-onlyfield'), '19a-3: the generated field row matches the seeded template');
  }
  {
    // 19b: editing the textarea saves the whole COLLECTION under the round-6 key (round 5's single
    // legacy key is never written to any more — see section 20 for the collection-specific cases).
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{custom} field';
    templateEl._fire('input', {});
    const saved = JSON.parse(win.localStorage.getItem(RW._dbTemplatesStorageKey));
    ok(Array.isArray(saved) && saved.length === 1 && saved[0].name === 'Default' && saved[0].text === '{custom} field',
      '19b: an edit is saved to localStorage as the active entry in the collection');
    ok(RW._dbDefaultTemplate === '{custom} field', '19b-2: the edit also becomes the new in-memory effective default immediately');
  }
  {
    // 19c: a throwing localStorage (private window / blocked site data) never crashes install,
    // and the module still works, in-memory only, with the built-in default.
    const s = makeStubWindow();
    let win = seedWin(s.win);
    win.localStorage = s.makeStorage({ throwing: true });
    win.MutationObserver = makeMutationObserverStub();
    let threw = false;
    let RW;
    try {
      makeFakeLabelModal(win, { title: 'Create New Label' });
      RW = loadModule(win);
    } catch (e) { threw = true; }
    ok(!threw, '19c: a throwing localStorage does not crash install');
    ok(RW && RW._dbDefaultTemplate === RW._dbBuiltinDefaultTemplate, '19c-2: falls back to the built-in default when storage is unusable');
    // Editing the template afterward must not throw either (the save side must degrade the same way).
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    let threwOnEdit = false;
    try { templateEl.value = '{x}'; templateEl._fire('input', {}); } catch (e) { threwOnEdit = true; }
    ok(!threwOnEdit, '19c-3: editing the template with a throwing localStorage does not throw either');
  }
  {
    // 19d: a console override set before this module ever ran wins over a seeded stored value.
    const s = makeStubWindow();
    let win = seedWin(s.win);
    win.localStorage.setItem('rwDescTemplate', '{fromstorage}');
    win.__RW = { _dbDefaultTemplate: '{fromconsole}' };
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbDefaultTemplate === '{fromconsole}', '19d: a pre-set console override wins over a seeded stored value');
  }
  {
    // 19e: the same-session gap this feature closes — editing the template, then closing and
    // reopening the SAME modal (no reload at all), still shows the edited template, not the
    // original built-in one RW._dbResetFields used to always stomp it back to.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{persisted}';
    templateEl._fire('input', {});

    modal.hidden = true; MO._instances[0].trigger();
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-template').value === '{persisted}',
      '19e: an edited template survives a same-session modal reopen instead of reverting to the built-in default');
    ok(!!win.document.getElementById('rw-db-field-persisted'), '19e-2: the field rows still match the edited (not reverted) template');
  }
  {
    // 19f: Reset to default clears storage (dbPersist's pristine rule — a lone "Default" entry
    // holding the built-in text has nothing worth remembering) and restores the exact built-in
    // template.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{custom}';
    templateEl._fire('input', {});
    ok(win.localStorage.getItem(RW._dbTemplatesStorageKey) !== null, 'precondition: the custom edit was saved');

    win.document.getElementById('rw-db-template-reset')._fire('click', {});
    ok(RW._dbDefaultTemplate === RW._dbBuiltinDefaultTemplate, '19f: Reset to default restores RW._dbDefaultTemplate to the exact built-in template');
    ok(win.document.getElementById('rw-db-template').value === RW._dbBuiltinDefaultTemplate, '19f-2: the textarea reflects the reset immediately');
    ok(win.localStorage.getItem(RW._dbTemplatesStorageKey) === null && win.localStorage.getItem(RW._dbActiveTemplateStorageKey) === null,
      '19f-3: the stored value is forgotten, not merely overwritten with the built-in text');
  }
  {
    // 19g: a blank/whitespace-only stored value is treated as nothing saved, not an intentional
    // blank template that would leave the annotator with no fields at all.
    const s = makeStubWindow();
    let win = seedWin(s.win);
    win.localStorage.setItem('rwDescTemplate', '   ');
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbDefaultTemplate === RW._dbBuiltinDefaultTemplate, '19g: a whitespace-only stored value falls back to the built-in default');
  }

  /* ===== 20. Round 6 — a named collection of templates: resolution, selection persistence,
     per-entry editing, management (save-as/rename/delete/reset), auto-detect on Edit, and the
     picker's own visibility gating ===== */

  // 20a: a corrupt/non-array JSON blob under the new key falls back to the built-in collection,
  // without throwing.
  {
    const s = makeStubWindow();
    let win = seedWin(s.win);
    win.localStorage.setItem('rwDescTemplates', 'not valid json{');
    win.MutationObserver = makeMutationObserverStub();
    let threw = false, RW;
    try { makeFakeLabelModal(win, { title: 'Create New Label' }); RW = loadModule(win); }
    catch (e) { threw = true; }
    ok(!threw, '20a: corrupt JSON under the collection key does not crash install');
    ok(RW._dbTemplates.length === 1 && RW._dbTemplates[0].name === 'Default'
      && RW._dbTemplates[0].text === RW._dbBuiltinDefaultTemplate,
      '20a-2: falls back to a single built-in Default entry');
  }
  // 20b: a well-formed-but-wrong-shaped JSON blob (not an array of {name,text}) also falls back.
  {
    let win = seedWin(makeStubWindow().win);
    win.localStorage.setItem('rwDescTemplates', JSON.stringify({ oops: true }));
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbTemplates.length === 1 && RW._dbTemplates[0].name === 'Default',
      '20b: a non-array JSON value falls back to the built-in collection');
  }
  // 20c: a seeded valid collection wins over the built-in, and the seeded active name is honored.
  {
    let win = seedWin(makeStubWindow().win);
    win.localStorage.setItem('rwDescTemplates', JSON.stringify([
      { name: 'Default', text: '{onlydefault}' },
      { name: 'SourceB', text: '{onlyb}' },
    ]));
    win.localStorage.setItem('rwDescActiveTemplate', 'SourceB');
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbTemplates.length === 2, '20c: a seeded valid collection wins over the built-in');
    ok(RW._dbActiveTemplateName === 'SourceB', '20c-2: the seeded active selection is honored');
    ok(RW._dbDefaultTemplate === '{onlyb}', '20c-3: the effective default mirrors the ACTIVE entry, not entry 0');
  }
  // 20d: an active name that no longer names any surviving entry falls back to entry 0.
  {
    let win = seedWin(makeStubWindow().win);
    win.localStorage.setItem('rwDescTemplates', JSON.stringify([{ name: 'Default', text: '{x}' }]));
    win.localStorage.setItem('rwDescActiveTemplate', 'Ghost');
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbActiveTemplateName === 'Default', '20d: an unknown stored active name falls back to entry 0');
  }
  // 20e: a pre-set RW._dbTemplates console override wins over whatever storage holds.
  {
    let win = seedWin(makeStubWindow().win);
    win.localStorage.setItem('rwDescTemplates', JSON.stringify([{ name: 'FromStorage', text: '{s}' }]));
    win.__RW = { _dbTemplates: [{ name: 'FromConsole', text: '{c}' }] };
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbTemplates.length === 1 && RW._dbTemplates[0].name === 'FromConsole',
      '20e: a pre-set RW._dbTemplates console override wins over a seeded collection');
  }
  // 20f: a pre-set RW._dbDefaultTemplate still wins as the active text (round 5's contract,
  // applied to whichever entry ends up active — here entry 0, since RW._dbTemplates itself
  // wasn't overridden).
  {
    let win = seedWin(makeStubWindow().win);
    win.__RW = { _dbDefaultTemplate: '{fromconsole}' };
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbDefaultTemplate === '{fromconsole}', '20f: a pre-set RW._dbDefaultTemplate still wins as the active text');
    ok(RW._dbTemplates[0].text === '{fromconsole}', '20f-2: the override is written into the active entry itself');
  }
  // 20g: throwing storage -> the built-in collection, in-memory only, no crash.
  {
    const s = makeStubWindow();
    let win = seedWin(s.win);
    win.localStorage = s.makeStorage({ throwing: true });
    win.MutationObserver = makeMutationObserverStub();
    let threw = false, RW;
    try { makeFakeLabelModal(win, { title: 'Create New Label' }); RW = loadModule(win); }
    catch (e) { threw = true; }
    ok(!threw, '20g: throwing storage does not crash install');
    ok(RW && RW._dbTemplates.length === 1 && RW._dbTemplates[0].text === RW._dbBuiltinDefaultTemplate,
      '20g-2: falls back to the built-in collection, in-memory only');
  }
  // 20h: legacy migration — only the OLD single-template key is seeded, no new-style collection
  // yet: adopted as one "Default" entry, selected.
  {
    let win = seedWin(makeStubWindow().win);
    win.localStorage.setItem('rwDescTemplate', '{legacyonly}');
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbTemplates.length === 1 && RW._dbTemplates[0].name === 'Default' && RW._dbTemplates[0].text === '{legacyonly}',
      '20h: a legacy single template is migrated in as one Default entry');
    ok(RW._dbActiveTemplateName === 'Default', '20h-2: the migrated entry is selected');
  }
  // 20i: an edit lands in the ACTIVE entry (not entry 0 if a different one is active), survives a
  // same-session reopen, and leaves a SIBLING entry's text untouched.
  {
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});

    // Save the current (built-in) text as a new entry "B" — RW._dbSaveTemplateAs selects it.
    win.document.getElementById('rw-db-tpl-name').value = 'B';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    ok(RW._dbTemplates.length === 2 && RW._dbActiveTemplateName === 'B', '20i: Save as new appends and selects the new entry');

    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{onlyb}';
    templateEl._fire('input', {});
    ok(RW._dbTemplates.find((t) => t.name === 'Default').text === RW._dbBuiltinDefaultTemplate,
      "20i-2: editing while B is active leaves Default's own text untouched");

    modal.hidden = true; MO._instances[0].trigger();
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-template').value === '{onlyb}',
      '20i-3: the per-entry edit survives a same-session modal reopen');

    // Switching selection reflects the OTHER entry's own (unedited) text.
    win.document.getElementById('rw-db-template-select').value = 'Default';
    win.document.getElementById('rw-db-template-select')._fire('change', {});
    ok(win.document.getElementById('rw-db-template').value === RW._dbBuiltinDefaultTemplate,
      '20i-4: switching back to Default shows ITS own (unedited) text');
  }
  // 20j: templates AND the active selection both survive a "reload" (a fresh window sharing the
  // same underlying localStorage data).
  {
    const win1 = seedWin(makeStubWindow().win);
    win1.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win1, { title: 'Create New Label' });
    const RW1 = loadModule(win1);
    win1.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win1.document.getElementById('rw-db-tpl-name').value = 'B';
    win1.document.getElementById('rw-db-tpl-saveas')._fire('click', {});

    const win2 = seedWin(makeStubWindow().win);
    win2.localStorage = win1.localStorage; // same underlying storage = the same browser origin
    win2.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win2, { title: 'Create New Label' });
    const RW2 = loadModule(win2);
    ok(RW2._dbTemplates.length === 2, '20j: both templates survive a reload');
    ok(RW2._dbActiveTemplateName === 'B', '20j-2: the active SELECTION survives the reload too');
  }
  // 20k: Save as new / Rename / Delete refusals, reported inline in #rw-db-tpl-status.
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const status = win.document.getElementById('rw-db-tpl-status');
    const nameEl = win.document.getElementById('rw-db-tpl-name');

    nameEl.value = '   ';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    ok(RW._dbTemplates.length === 1 && status.innerText.length > 0, '20k: a blank name is refused, reported inline');

    nameEl.value = 'B';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    ok(RW._dbTemplates.length === 2 && RW._dbActiveTemplateName === 'B', 'precondition: B saved and selected');

    nameEl.value = 'B'; // a second entry now genuinely exists to collide with
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    ok(RW._dbTemplates.length === 2, '20k-2: Save as new refuses a name already in use (case-insensitively)');

    nameEl.value = 'default'; // B (active) renamed to a case-variant of the OTHER entry's name
    win.document.getElementById('rw-db-tpl-rename')._fire('click', {});
    ok(RW._dbActiveTemplateName === 'B', '20k-3: Rename refuses a case-insensitive duplicate of a DIFFERENT entry — nothing changed');

    nameEl.value = 'Renamed';
    win.document.getElementById('rw-db-tpl-rename')._fire('click', {});
    ok(RW._dbActiveTemplateName === 'Renamed' && RW._dbTemplates.some((t) => t.name === 'Renamed'),
      '20k-4: a valid Rename takes effect and keeps the selection on the renamed entry');

    win.document.getElementById('rw-db-tpl-delete')._fire('click', {}); // drops "Renamed", back to just Default
    ok(RW._dbTemplates.length === 1 && RW._dbActiveTemplateName === 'Default', 'precondition: back down to one entry');
    win.document.getElementById('rw-db-tpl-delete')._fire('click', {});
    ok(RW._dbTemplates.length === 1 && status.innerText.length > 0,
      '20k-5: Delete refuses to remove the last remaining template, reported inline');
  }
  // 20l: Delete drops the active entry and selects entry 0 when more than one exists.
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-tpl-name').value = 'B';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    ok(RW._dbActiveTemplateName === 'B', 'precondition: B is active');
    win.document.getElementById('rw-db-tpl-delete')._fire('click', {});
    ok(RW._dbTemplates.length === 1 && RW._dbActiveTemplateName === 'Default',
      '20l: Delete removes the active entry and falls back to entry 0');
  }
  // 20m: Reset to default touches only the ACTIVE entry — a sibling's custom text is untouched.
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-tpl-name').value = 'B';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{customb}';
    templateEl._fire('input', {});

    win.document.getElementById('rw-db-template-select').value = 'Default';
    win.document.getElementById('rw-db-template-select')._fire('change', {});
    templateEl.value = '{customdefault}';
    templateEl._fire('input', {});

    win.document.getElementById('rw-db-template-reset')._fire('click', {});
    ok(RW._dbTemplates.find((t) => t.name === 'Default').text === RW._dbBuiltinDefaultTemplate,
      '20m: Reset to default restores the ACTIVE entry (Default) to the built-in text');
    ok(RW._dbTemplates.find((t) => t.name === 'B').text === '{customb}',
      "20m-2: a sibling entry's custom text is left untouched by Reset");
  }
  // 20n/20o: auto-detect on Edit — switches to the template the description actually matches,
  // recovers it exactly, and never fires on Create.
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-tpl-name').value = 'SourceB';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = 'material: {material}\nnotes: {notes}';
    templateEl._fire('input', {});
    // Back to Default (the built-in, unrelated template) before Edit ever opens.
    win.document.getElementById('rw-db-template-select').value = 'Default';
    win.document.getElementById('rw-db-template-select')._fire('change', {});
    ok(RW._dbActiveTemplateName === 'Default', 'precondition: Default is active before Edit opens');

    const descForB = 'material: Concrete\nnotes: see sheet A2';
    const hit = RW._dbDetectTemplate(descForB);
    ok(hit && hit.name === 'SourceB' && hit.exact === true,
      '20n: RW._dbDetectTemplate finds the exact match among saved templates — got ' + JSON.stringify(hit && { name: hit.name, exact: hit.exact }));

    ok(RW._dbDetectTemplate('A hand-written description already here.') === null,
      '20n-2: an unrelated hand-written description matches nothing (matchedLines stays 0 for every entry)');

    // 20n-3: a genuine tie — two structurally identical templates (differing only in variable
    // name) score identically on every metric including exactness. The currently active one wins.
    win.document.getElementById('rw-db-template-select').value = 'SourceB';
    win.document.getElementById('rw-db-template-select')._fire('change', {});
    templateEl.value = 'x: {foo}';
    templateEl._fire('input', {});
    win.document.getElementById('rw-db-tpl-name').value = 'Alt';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {}); // saves + selects "Alt"
    templateEl.value = 'x: {bar}';
    templateEl._fire('input', {});
    ok(RW._dbActiveTemplateName === 'Alt', 'precondition: Alt (x: {bar}) is active');

    const tieHit = RW._dbDetectTemplate('x: hello');
    ok(tieHit && tieHit.name === 'Alt', "20n-3: a genuine tie (identical scores, both exact) is won by the ACTIVE template — got " + JSON.stringify(tieHit && tieHit.name));

    win.document.getElementById('rw-db-template-select').value = 'SourceB';
    win.document.getElementById('rw-db-template-select')._fire('change', {});
    const tieHit2 = RW._dbDetectTemplate('x: hello');
    ok(tieHit2 && tieHit2.name === 'SourceB', '20n-4: switching which one is active flips which side of the tie wins');
  }
  {
    // 20o: the full DOM seam — an Edit modal holding a description rendered from the SECOND saved
    // template switches the picker to it and prefills exactly.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-tpl-name').value = 'SourceB';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = 'material: {material}\nnotes: {notes}';
    templateEl._fire('input', {});
    win.document.getElementById('rw-db-template-select').value = 'Default';
    win.document.getElementById('rw-db-template-select')._fire('change', {});

    modal.hidden = true; MO._instances[0].trigger();
    modal.querySelector('#label-modal-title').textContent = 'Edit Label';
    modal.querySelector('#label-description').value = 'material: Concrete\nnotes: see sheet A2';
    modal.hidden = false; MO._instances[0].trigger();

    ok(win.document.getElementById('rw-db-template-select').value === 'SourceB',
      '20o: opening Edit on a description matching SourceB switches the picker to it');
    ok(win.document.getElementById('rw-db-field-material').value === 'Concrete',
      '20o-2: fields prefill from the newly-detected template');
    ok(win.document.getElementById('rw-db-prefill-status').innerText.indexOf('preview matches it exactly') !== -1,
      '20o-3: the prefill is an exact byte-for-byte match');

    // A Create modal never runs detection at all — the picker stays on whatever was active.
    modal.hidden = true; MO._instances[0].trigger();
    modal.querySelector('#label-modal-title').textContent = 'Create New Label';
    modal.querySelector('#label-description').value = 'material: Concrete\nnotes: see sheet A2';
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-template-select').value === 'SourceB',
      '20o-4: a Create modal never runs auto-detect — the active template is unchanged');
  }
  // 20p: picker visibility (round 7) — shown unconditionally in Simple mode, even with only one
  // template, shown in Advanced regardless, and still shown in Simple after adding a second
  // template (never accidentally hidden by anything else in the toggle/save-as path).
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-tplsel-wrap').style.display === '',
      '20p: the picker is shown in Simple mode even with only one template');

    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    ok(win.document.getElementById('rw-db-tplsel-wrap').style.display === '',
      '20p-2: the picker is shown in Advanced mode too');

    win.document.getElementById('rw-db-tpl-name').value = 'B';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {}); // back to Simple
    ok(win.document.getElementById('rw-db-tplsel-wrap').style.display === '',
      '20p-3: still shown in Simple mode after a second template is added');
  }

  /* ===== 21. Round 6 — whole-description override ===== */
  {
    // 21a/21b: manual engage/revert, seeded from the current preview, with a standing status note.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-field-desc').value = 'Concrete';
    win.document.getElementById('rw-db-field-desc')._fire('input', {});
    const generated = win.document.getElementById('rw-db-preview').innerText;

    win.document.getElementById('rw-db-output-override-btn')._fire('click', {});
    ok(RW._dbOutputOverridden === true, '21a: Override engages');
    ok(win.document.getElementById('rw-db-output-override').value === generated,
      '21a-2: the override textarea is seeded with exactly what the preview showed');
    ok(win.document.getElementById('rw-db-output-status').innerText.length > 0, '21a-3: a standing status note appears');
    ok(win.document.getElementById('rw-db-preview').style.display === 'none', '21a-4: the read-only preview is hidden while overridden');

    win.document.getElementById('rw-db-output-revert-btn')._fire('click', {});
    ok(RW._dbOutputOverridden === false, '21b: ✕ reverts');
    ok(win.document.getElementById('rw-db-output-status').innerText === '', '21b-2: the status note clears');
    ok(win.document.getElementById('rw-db-preview').style.display !== 'none', '21b-3: the preview reappears');
  }
  {
    // 21c: typing in the override textarea drives RW._dbComputeOutput and Fill, verbatim — the
    // preview/Fill single-source invariant, holding for the override too.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-output-override-btn')._fire('click', {});
    const ta = win.document.getElementById('rw-db-output-override');
    ta.value = 'Hand-typed whole description.';
    ta._fire('input', {});
    ok(RW._dbComputeOutput() === 'Hand-typed whole description.', '21c: RW._dbComputeOutput returns the override text verbatim');

    win.document.getElementById('rw-db-fill')._fire('click', {});
    const descInp = modal.querySelector('#label-description');
    ok(descInp.value === 'Hand-typed whole description.', '21c-2: Fill writes the override text into #label-description');
  }
  {
    // 21d: field edits while overridden leave the output unchanged (the span-override analogue).
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-output-override-btn')._fire('click', {});
    win.document.getElementById('rw-db-output-override').value = 'Frozen text.';
    win.document.getElementById('rw-db-output-override')._fire('input', {});
    win.document.getElementById('rw-db-field-desc').value = 'Concrete';
    win.document.getElementById('rw-db-field-desc')._fire('input', {});
    ok(RW._dbComputeOutput() === 'Frozen text.', '21d: a field edit while overridden does not change the output');
  }
  {
    // 21e/21f: a hidden->visible reopen clears the override, and so do Clear and Re-read.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-output-override-btn')._fire('click', {});
    ok(RW._dbOutputOverridden === true, 'precondition: override engaged');
    modal.hidden = true; MO._instances[0].trigger();
    modal.hidden = false; MO._instances[0].trigger();
    ok(RW._dbOutputOverridden === false, '21e: a fresh modal open clears the override');
  }
  {
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Edit Label', description: 'Concrete - Wall\nschedule' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-output-override-btn')._fire('click', {});
    win.document.getElementById('rw-db-prefill-reread')._fire('click', {});
    ok(RW._dbOutputOverridden === false, '21f: Re-read drops the override');

    win.document.getElementById('rw-db-output-override-btn')._fire('click', {});
    win.document.getElementById('rw-db-prefill-clear')._fire('click', {});
    ok(RW._dbOutputOverridden === false, '21f-2: Clear drops the override too');
  }
  {
    // 21g: auto-engage — an Edit modal whose description matches no template engages the override
    // holding that description byte-for-byte, so Fill reproduces it exactly.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Edit Label', description: 'A hand-written description already here.' });
    const RW = loadModule(win);
    ok(RW._dbOutputOverridden === true, '21g: the override auto-engages on a non-matching Edit description');
    ok(win.document.getElementById('rw-db-output-override').value === 'A hand-written description already here.',
      '21g-2: seeded with the original description verbatim');
    ok(win.document.getElementById('rw-db-prefill-status').innerText.indexOf('override on, keeping it as-is') !== -1,
      '21g-3: the prefill status explains why');

    win.document.getElementById('rw-db-fill')._fire('click', {}); // first click only arms (non-empty textarea)
    win.document.getElementById('rw-db-fill')._fire('click', {}); // second click commits
    const descInp = modal.querySelector('#label-description');
    ok(descInp.value === 'A hand-written description already here.',
      '21g-4: Fill reproduces the original description exactly, rather than an empty-field rendering');
  }
  {
    // 21h: a Create modal with a blank textarea never auto-engages.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbOutputOverridden === false, '21h: a fresh Create modal never auto-engages the override');
  }
  {
    // 21i: an Edit modal that DID prefill successfully never auto-engages either.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Edit Label', description: 'Concrete - Wall\nschedule' });
    const RW = loadModule(win);
    ok(RW._dbOutputOverridden === false, '21i: a successfully-prefilled Edit modal does not auto-engage the override');
  }

  /* ===== 22. Round 8 — smart NS wording in the explanation ===== */
  {
    // 22a: RW._dbIsNS
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    ok(RW._dbIsNS('NS') === true, '22a: exact "NS"');
    ok(RW._dbIsNS('ns') === true, '22a-2: lowercase "ns"');
    ok(RW._dbIsNS(' Ns ') === true, '22a-3: mixed case + surrounding whitespace');
    ok(RW._dbIsNS('') === false, '22a-4: blank is not NS');
    ok(RW._dbIsNS('18"') === false, '22a-5: a real value is not NS');
    ok(RW._dbIsNS('Not Shown') === false, '22a-6: a different phrase is not NS — only the literal marker counts');
    ok(RW._dbIsNS(null) === false, '22a-7: null is not NS');
  }
  {
    // 22b: RW._dbFindNsExplanationLine — structural detection, not literal-text matching
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    ok(RW._dbFindNsExplanationLine(RW._dbDefaultTemplate) === 4,
      '22b: the built-in default template\'s explanation line is found at index 4');
    ok(RW._dbFindNsExplanationLine('{thickness} {span} {source}') === -1,
      '22b-2: a line missing {where} never matches — no false positive');
    ok(RW._dbFindNsExplanationLine('{desc}\nnote: {span} and {where} and {source} and {thickness}, reworded') === 1,
      '22b-3: reordering/rewording the surrounding literal text still finds it structurally');
    ok(RW._dbFindNsExplanationLine('') === -1, '22b-4: an empty template never matches');
    ok(RW._dbFindNsExplanationLine(null) === -1, '22b-5: a null template never throws, never matches');
  }
  {
    // 22c: RW._dbNsExplanationText — the exact decision table, confirmed with the user
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const sample = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes',
    };
    sample.span = RW._dbSpan(sample.top, sample.bot, '').value;

    ok(RW._dbNsExplanationText(sample) === null, '22c: neither NS -> null, caller keeps the normal render');

    const thicknessNS = Object.assign({}, sample, { thickness: 'NS' });
    ok(RW._dbNsExplanationText(thicknessNS) ===
      'The detail shows a concrete wall with the height of 2\'-0". No thickness information found. the height can be found in the plan and notes',
      '22c-2: thickness NS only — exact approved wording');

    const topNS = Object.assign({}, sample, { top: 'NS' });
    ok(RW._dbNsExplanationText(topNS) ===
      'The detail shows an 18" concrete wall. No information on TOW; the thickness can be found in schedule table within the same page.',
      '22c-3: top (TOW) NS only — exact approved wording');

    const botNS = Object.assign({}, sample, { bot: 'NS' });
    ok(RW._dbNsExplanationText(botNS) ===
      'The detail shows an 18" concrete wall. No information on TOF; the thickness can be found in schedule table within the same page.',
      '22c-4: bot (TOF) NS only — exact approved wording');

    const bothSidesNS = Object.assign({}, sample, { top: 'NS', bot: 'NS' });
    ok(RW._dbNsExplanationText(bothSidesNS) ===
      'The detail shows an 18" concrete wall. No information on TOW and TOF; the thickness can be found in schedule table within the same page.',
      '22c-5: both top AND bot NS — "TOW and TOF"');

    const combinedNS = Object.assign({}, sample, { thickness: 'NS', top: 'NS' });
    ok(RW._dbNsExplanationText(combinedNS) === 'No thickness information found and no information on TOW.',
      '22c-6: thickness AND elevation both NS — the combined, whole-explanation wording');

    const combinedBothSides = Object.assign({}, sample, { thickness: 'NS', top: 'NS', bot: 'NS' });
    ok(RW._dbNsExplanationText(combinedBothSides) === 'No thickness information found and no information on TOW and TOF.',
      '22c-7: thickness NS plus BOTH elevation sides NS combines correctly too');
  }
  {
    // 22d: RW._dbApplyNsExplanation — the splice, no-ops, and prefix preservation
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const sample = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes',
    };
    sample.span = RW._dbSpan(sample.top, sample.bot, '').value;
    const normalRendered = RW._dbRender(RW._dbDefaultTemplate, sample);

    ok(RW._dbApplyNsExplanation(normalRendered, RW._dbDefaultTemplate, sample) === normalRendered,
      '22d: neither NS -> byte-identical no-op (re-confirms the headline sample is unaffected)');

    ok(RW._dbApplyNsExplanation('irrelevant', '{thickness} {span} {source}', sample) === 'irrelevant',
      '22d-2: no matching line in the template -> no-op');

    const nsValues = Object.assign({}, sample, { thickness: 'NS' });
    const nsRendered = RW._dbRender(RW._dbDefaultTemplate, nsValues);
    const spliced = RW._dbApplyNsExplanation(nsRendered, RW._dbDefaultTemplate, nsValues);
    const lines = spliced.split('\n');
    ok(lines.length === 5, '22d-3: line count is unchanged — one template line still renders to one line');
    ok(lines[0] === 'Concrete - Wall' && lines[1] === 'schedule' && lines[2] === 'height: [-12\'-0"] - [-14\'-0"]'
      && lines[3] === 'thickness: NS', '22d-4: every OTHER line is left completely untouched');
    ok(lines[4] === 'explanation: The detail shows a concrete wall with the height of 2\'-0". '
      + 'No thickness information found. the height can be found in the plan and notes',
      '22d-5: the explanation line is spliced with its "explanation: " prefix preserved — got ' + lines[4]);
  }
  {
    // 22e: the DOM/UI seam — RW._dbRunPreview and RW._dbRunFill both show the NS wording, via the
    // one shared RW._dbComputeOutput (so Fill writes exactly what the preview showed).
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const set = (name, val) => {
      const el = win.document.getElementById('rw-db-field-' + name);
      el.value = val; el._fire('input', {});
    };
    set('desc', 'Concrete'); set('keyword', 'Wall'); set('source', 'schedule');
    set('word', 'height'); set('top', "-12'-0\""); set('bot', "-14'-0\"");
    set('thickness', 'NS'); set('where', 'the plan and notes');

    const preview = win.document.getElementById('rw-db-preview').innerText;
    ok(preview.indexOf('No thickness information found.') !== -1,
      '22e: the live preview shows the NS wording — got:\n' + preview);
    ok(preview === RW._dbComputeOutput(), '22e-2: the preview matches RW._dbComputeOutput exactly');

    win.document.getElementById('rw-db-fill')._fire('click', {}); // empty textarea, no confirm needed
    const descInp = modal.querySelector('#label-description');
    ok(descInp.value === preview, '22e-3: Fill writes exactly what the preview showed');
  }
  {
    // 22f: regression guard — an ORDINARY (non-NS) description still recovers {where}/{source}
    // exactly, the round-4 guarantee this whole design was built specifically to protect.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const helperWin = seedWin(makeStubWindow().win);
    const RWHelper = loadModule(helperWin);
    const sample = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes',
    };
    sample.span = RWHelper._dbSpan(sample.top, sample.bot, '').value;
    const rendered = RWHelper._dbRender(RWHelper._dbDefaultTemplate, sample);
    makeFakeLabelModal(win, { title: 'Edit Label', description: rendered });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-field-where').value === 'the plan and notes',
      '22f: {where} still recovers exactly on an ordinary (non-NS) Edit — the guarantee this design protects');
    ok(win.document.getElementById('rw-db-field-source').value === 'schedule',
      '22f-2: {source} recovers too');
    ok(win.document.getElementById('rw-db-prefill-status').innerText.indexOf('preview matches it exactly') !== -1,
      '22f-3: the exact byte-for-byte prefill signal is unaffected');
  }
  {
    // 22g: reopening a label whose description WAS produced under an NS condition never crashes —
    // it degrades gracefully (that one line just doesn't re-match), same class as any hand-edited
    // sentence already does today.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const helperWin = seedWin(makeStubWindow().win);
    const RWHelper = loadModule(helperWin);
    const nsValues = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: "-12'-0\"", bot: "-14'-0\"", thickness: 'NS', where: 'the plan and notes',
    };
    nsValues.span = RWHelper._dbSpan(nsValues.top, nsValues.bot, '').value;
    const nsRendered = RWHelper._dbRender(RWHelper._dbDefaultTemplate, nsValues);
    const nsFinal = RWHelper._dbApplyNsExplanation(nsRendered, RWHelper._dbDefaultTemplate, nsValues);
    let threw = false;
    try { makeFakeLabelModal(win, { title: 'Edit Label', description: nsFinal }); loadModule(win); }
    catch (e) { threw = true; }
    ok(!threw, '22g: reopening a label produced under an NS condition never crashes the panel');
    ok(win.document.getElementById('rw-db-field-thickness').value === 'NS',
      '22g-2: the earlier lines (thickness: NS) still recover fine — only the explanation line is affected');
  }

  /* ===== 23. Round 9 — a SLAB thickness embedded in `bot`, kept independent of the WALL's own
     {thickness} field ===== */
  //
  // A real design bug caught by the user before this round ever reached a live page: the first
  // draft auto-filled and read-only-locked {thickness} from bot's detected value — but {thickness}
  // is the WALL's own thickness (used in "thickness: {thickness}" and the explanation's own
  // "{a} {thickness} {desc:lower} ..."), a completely different physical quantity from whatever
  // slab sits between the wall and the footing. Fixed by never touching {thickness} at all: the
  // detected slab thickness feeds ONLY the span/height-depth arithmetic below.
  {
    // 23a: RW._dbParseBotThickness
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    ok(JSON.stringify(RW._dbParseBotThickness('2" - 0\'-5"')) === JSON.stringify({ slabThickness: '2"', elevation: "0'-5\"" }),
      '23a: a valid compound value splits into slabThickness + elevation');
    ok(JSON.stringify(RW._dbParseBotThickness('SLAB')) === JSON.stringify({ slabThickness: 'NS', elevation: 'NS' }),
      '23a-2: bare "SLAB" -> both pieces unknown ("NS")');
    ok(JSON.stringify(RW._dbParseBotThickness(' slab ')) === JSON.stringify({ slabThickness: 'NS', elevation: 'NS' }),
      '23a-3: case-insensitive / trimmed, matching RW._dbIsNS\'s own style');
    ok(RW._dbParseBotThickness("-14'-0\"") === null, '23a-4: a plain elevation is not compound');
    ok(RW._dbParseBotThickness('T/FOOTING') === null, '23a-5: a datum name is not compound');
    ok(RW._dbParseBotThickness('NS') === null, '23a-6: plain "NS" (not "SLAB") is unaffected — round 8\'s own case, untouched');
    ok(RW._dbParseBotThickness('') === null, '23a-7: blank is not compound');
    ok(RW._dbParseBotThickness(null) === null, '23a-8: null never throws');
    ok(RW._dbParseBotThickness('2" - garbage') === null, '23a-9: a malformed compound (one side unparseable) falls through, not compound');
    ok(RW._dbParseBotThickness('garbage - 0\'-5"') === null, '23a-10: same, the OTHER side unparseable');
  }
  {
    // 23b: RW._dbComputeSpanWithThickness
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const withThickness = RW._dbComputeSpanWithThickness("-12'-0\"", '2" - 0\'-5"', '');
    ok(withThickness.value === "12'-3\"" && withThickness.source === 'computed-thickness',
      '23b: TOW(144) - slab thickness(2") - TOF(5) = 137 -> ' + JSON.stringify(withThickness));

    const bareSlab = RW._dbComputeSpanWithThickness("-12'-0\"", 'SLAB', '');
    ok(bareSlab.source !== 'computed-thickness' && bareSlab.value.indexOf('NS') !== -1,
      '23b-2: bare SLAB (slab thickness itself unknown) -> no subtraction attempted, falls back to RW._dbSpan\'s own datum handling');

    const ordinary = RW._dbComputeSpanWithThickness("-12'-0\"", "-14'-0\"", '');
    const plain = RW._dbSpan("-12'-0\"", "-14'-0\"", '');
    ok(JSON.stringify(ordinary) === JSON.stringify(plain),
      '23b-3: an ordinary bot value is byte-identical to calling RW._dbSpan directly — regression guard');

    const overridden = RW._dbComputeSpanWithThickness("-12'-0\"", '2" - 0\'-5"', '600mm');
    ok(overridden.value === '600mm' && overridden.source === 'override',
      '23b-4: an explicit span Override still wins over everything, even a compound bot');

    const nonComputedTop = RW._dbComputeSpanWithThickness('T/WALL', '2" - 0\'-5"', '');
    ok(nonComputedTop.source !== 'computed-thickness',
      '23b-5: a non-parseable top means nothing to subtract from — no subtraction attempted');
  }
  {
    // 23c: the independence guard — {thickness} (the WALL's own thickness) is NEVER touched by
    // bot, in either direction, no matter what bot contains.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const bot = win.document.getElementById('rw-db-field-bot');
    const thickness = win.document.getElementById('rw-db-field-thickness');
    const nsBtn = win.document.getElementById('rw-db-ns-thickness');

    thickness.value = '12"'; // the WALL's own thickness, typed independently
    thickness._fire('input', {});
    bot.value = '2" - 0\'-5"'; // a DIFFERENT number — the slab's thickness
    bot._fire('input', {});
    ok(thickness.value === '12"', '23c: a compound bot never overwrites the separately-typed {thickness}');
    ok(!thickness.readOnly, '23c-2: {thickness} is never made read-only by bot');
    ok(!nsBtn.disabled, '23c-3: its NS button is never disabled either');
    ok(thickness.title === '', '23c-4: no title/tooltip is imposed on it');

    bot.value = 'SLAB';
    bot._fire('input', {});
    ok(thickness.value === '12"', '23c-5: bare SLAB doesn\'t touch {thickness} either');
  }
  {
    // 23d: bare SLAB only affects the ELEVATION side of round 8's wording (no information on TOF)
    // — it does NOT imply anything about the wall's own thickness, which stays whatever was typed
    // (or blank) and renders completely normally in the same sentence.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const set = (name, val) => {
      const el = win.document.getElementById('rw-db-field-' + name);
      el.value = val; el._fire('input', {});
    };
    set('desc', 'Concrete'); set('keyword', 'Wall'); set('source', 'schedule');
    set('word', 'height'); set('top', "-12'-0\""); set('where', 'the plan and notes');
    set('thickness', '12"'); // the wall's real thickness, known
    set('bot', 'SLAB');

    const preview = win.document.getElementById('rw-db-preview').innerText;
    ok(preview.indexOf('No information on TOF;') !== -1,
      '23d: bare SLAB triggers only the elevation-NS wording — got:\n' + preview);
    ok(preview.indexOf('a 12" concrete wall') !== -1,
      '23d-2: the wall\'s own (known) thickness still renders normally in the same sentence');
    ok(preview.indexOf('No thickness information found') === -1,
      '23d-3: the thickness-NS wording is NOT triggered — the wall\'s thickness was never marked NS');
  }
  {
    // 23d-4: the combined wording still works when BOTH are genuinely unknown — but now that
    // requires the annotator to mark the wall's thickness NS independently (its own NS button),
    // not something bot implies on its own.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const set = (name, val) => {
      const el = win.document.getElementById('rw-db-field-' + name);
      el.value = val; el._fire('input', {});
    };
    set('desc', 'Concrete'); set('keyword', 'Wall'); set('source', 'schedule');
    set('word', 'height'); set('top', "-12'-0\""); set('where', 'the plan and notes');
    set('bot', 'SLAB');
    win.document.getElementById('rw-db-ns-thickness')._fire('click', {}); // the wall's OWN NS button

    const preview = win.document.getElementById('rw-db-preview').innerText;
    ok(preview.indexOf('No thickness information found and no information on TOF.') !== -1,
      '23d-4: both marked unknown (independently) still combines correctly — got:\n' + preview);
  }
  {
    // 23e: the full DOM/UI seam with a real slab thickness AND a different, independent wall
    // thickness — preview and Fill agree exactly, and the two numbers never cross-contaminate.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const set = (name, val) => {
      const el = win.document.getElementById('rw-db-field-' + name);
      el.value = val; el._fire('input', {});
    };
    set('desc', 'Concrete'); set('keyword', 'Wall'); set('source', 'schedule');
    set('word', 'height'); set('top', "-12'-0\""); set('where', 'the plan and notes');
    set('thickness', '12"'); // the wall's own thickness
    set('bot', '2" - 0\'-5"'); // the slab's thickness — a different number

    const preview = win.document.getElementById('rw-db-preview').innerText;
    // No brackets around bot's compound text — :brk only brackets a value that parses as a
    // NEGATIVE feet-inches elevation, and this compound string doesn't parse as feet-inches at all
    // (same as any datum name), so it renders bare, exactly as typed.
    ok(preview.indexOf('height: [-12\'-0"] - 2" - 0\'-5"') !== -1,
      '23e: the measurement line shows bot raw, exactly as typed (no brackets) — got:\n' + preview);
    ok(preview.indexOf("with the height of 12'-3\"") !== -1,
      '23e-2: the explanation uses the SLAB-thickness-adjusted span (12\'-3") — got:\n' + preview);
    ok(preview.indexOf('a 12" concrete wall') !== -1,
      '23e-3: ...while still describing the wall by its OWN thickness (12"), not the slab\'s (2") — got:\n' + preview);
    ok(preview.indexOf('thickness: 12"') !== -1, '23e-4: the thickness line shows the wall\'s own value');
    ok(preview === RW._dbComputeOutput(), '23e-5: the preview matches RW._dbComputeOutput exactly');

    win.document.getElementById('rw-db-fill')._fire('click', {});
    const descInp = modal.querySelector('#label-description');
    ok(descInp.value === preview, '23e-6: Fill writes exactly what the preview showed');
  }
  {
    // 23f: reopening a label whose description used this format recovers both thicknesses
    // correctly and independently, and the override-detection comparison correctly does NOT flag
    // a false "span overridden".
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const helperWin = seedWin(makeStubWindow().win);
    const RWHelper = loadModule(helperWin);
    const values = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: "-12'-0\"", bot: '2" - 0\'-5"', thickness: '12"', where: 'the plan and notes',
    };
    values.span = RWHelper._dbComputeSpanWithThickness(values.top, values.bot, '').value;
    const rendered = RWHelper._dbRender(RWHelper._dbDefaultTemplate, values);
    const final = RWHelper._dbApplyNsExplanation(rendered, RWHelper._dbDefaultTemplate, values);
    makeFakeLabelModal(win, { title: 'Edit Label', description: final });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-field-bot').value === '2" - 0\'-5"',
      '23f: bot recovers its raw compound text verbatim on reopen');
    ok(win.document.getElementById('rw-db-field-thickness').value === '12"',
      '23f-2: {thickness} independently recovers the WALL\'s own value from its own line, unaffected by the slab\'s 2"');
    ok(!win.document.getElementById('rw-db-field-thickness').readOnly,
      '23f-3: {thickness} is fully editable again after reopening — never locked');
    ok(RW._dbSpanOverridden === false,
      '23f-4: NOT falsely flagged as a manual span override — the regression this round specifically guards against');
    ok(win.document.getElementById('rw-db-prefill-status').innerText.indexOf('preview matches it exactly') !== -1,
      '23f-5: the byte-for-byte prefill signal holds for a slab-thickness-adjusted description too');
  }
  {
    // 23g: regression guard — an ORDINARY (non-compound) bot never triggers any of this.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const thickness = win.document.getElementById('rw-db-field-thickness');
    const bot = win.document.getElementById('rw-db-field-bot');
    bot.value = "-14'-0\"";
    bot._fire('input', {});
    ok(!thickness.readOnly, '23g: an ordinary bot value never read-onlies {thickness}');
    ok(thickness.value === '', '23g-2: {thickness} is never auto-filled from an ordinary bot value');
  }

  /* ===== 24. Round 10 — float the panel beside the modal when there's room ===== */
  {
    // 24a: default (the stub's default modal rect leaves NO room) -> mounts inline, exactly as
    // every prior round's behavior — the whole feature is a no-op for this, the common, scenario.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const modal = win.document.getElementById('label-modal');
    const root = win.document.getElementById('rw-db-root');
    ok(!!modal.querySelector('#rw-db-root'), '24a: root stays a descendant of the modal by default');
    ok(root.style.position !== 'fixed', '24a-2: not positioned fixed');
    ok(/max-height:40vh/.test(root.style.cssText), '24a-3: the original 40vh inline cap is restored');
  }
  {
    // 24b: enough room to the modal's right -> floats. Regression test for the exact bug
    // boon-label-management hit once: a fixed-position element with no explicit anchor falls back
    // to its static position and can render fully off-screen — assert BOTH top and left are set.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    modal.getBoundingClientRect = () => rect(0, 50, 200, 400); // right=200, room=1000
    const RW = loadModule(win);
    const root = win.document.getElementById('rw-db-root');
    ok(root._parent === win.document.body, '24b: root is re-parented to document.body');
    ok(root.style.position === 'fixed', '24b-2: position:fixed');
    ok(!!root.style.top && !!root.style.left,
      '24b-3: BOTH top and left are explicitly set — never left to fall back to a static position');
    ok(root.style.left === '212px', '24b-4: docked just past the modal\'s right edge (200 + 12px gap)');
    ok(root.style.width === '320px', '24b-5: an explicit width, since it no longer derives one from an inline flow parent');
    ok(root.style.zIndex === '2147483646', '24b-6: a z-index high enough to sit above the host app');
  }
  {
    // 24c: Fill, the "Reset to default" button, and a genuine reopen's own field-reset all still
    // work correctly while floating — the regression test for the four
    // modal.querySelector -> document.getElementById fixes.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    modal.getBoundingClientRect = () => rect(0, 0, 200, 400);
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-root')._parent === win.document.body, 'precondition: floating');

    win.document.getElementById('rw-db-field-desc').value = 'Concrete';
    win.document.getElementById('rw-db-field-desc')._fire('input', {});
    win.document.getElementById('rw-db-fill')._fire('click', {});
    const descInp = modal.querySelector('#label-description');
    ok(descInp.value.indexOf('Concrete') === 0, '24c: Fill still writes into the host\'s Description field while floating');

    const descInp2 = modal.querySelector('#label-description');
    descInp2.value = 'A hand-written description already here.';
    win.document.getElementById('rw-db-fill')._fire('click', {});
    ok(win.document.getElementById('rw-db-fill').innerText === 'Overwrite?',
      '24c-2: the two-click overwrite guard still relabels the (floating) button correctly');

    win.document.getElementById('rw-db-adv-toggle')._fire('click', {}); // reveal the template box
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{onlyfield}';
    templateEl._fire('input', {});
    win.document.getElementById('rw-db-template-reset')._fire('click', {});
    ok(templateEl.value === RW._dbBuiltinDefaultTemplate,
      '24c-3: Reset to default still finds the (floating) template box via its own fixed lookup');

    // A genuine reopen exercises RW._dbResetFields' OWN two fixed lookups directly (distinct from
    // RW._dbResetTemplateToDefault's, tested above) — the Fill button relabel and the template
    // box reset both still need to find the floating panel's own elements. Both "before" states
    // are set through a path INDEPENDENT of RW._dbRunFill/the template input listener (which have
    // their own, separately-tested lookups), so a skipped reset and a genuine one are actually
    // distinguishable here, rather than accidentally producing the same end state either way.
    const fillBtnEl = win.document.getElementById('rw-db-fill');
    fillBtnEl.innerText = 'Overwrite?'; // forced directly, not via a Fill click
    templateEl.value = 'garbage-not-the-default'; // forced directly, WITHOUT firing input — so
                                                     // RW._dbDefaultTemplate itself is untouched
    const expectedDefault = RW._dbDefaultTemplate;
    modal.hidden = true; MO._instances[0].trigger();
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-fill').innerText === 'Fill Description',
      '24c-4: a fresh reopen resets the (floating) Fill button\'s label via RW._dbResetFields\' own fixed lookup');
    ok(win.document.getElementById('rw-db-template').value === expectedDefault,
      '24c-5: ...and resets the (floating) template box back to the default, not left at "garbage-not-the-default"');
  }
  {
    // 24d: RW._dbApplyPanelVisibility — a floating root gets NO visibility inheritance from the
    // modal at all (unlike inline, where a hidden ancestor already hides it for free), so this
    // must be synced explicitly. A scenario that couldn't even arise before this round.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    modal.getBoundingClientRect = () => rect(0, 0, 200, 400);
    const RW = loadModule(win);
    const root = win.document.getElementById('rw-db-root');
    ok(root.style.display !== 'none', 'precondition: visible while the modal is visible');

    modal.hidden = true; MO._instances[0].trigger();
    ok(root.style.display === 'none', '24d: the floating root hides when the modal hides');

    modal.hidden = false; MO._instances[0].trigger();
    ok(root.style.display !== 'none', '24d-2: and shows again when the modal shows');
  }
  {
    // 24e: position is computed ONCE per open, not tracked continuously — the user's own choice.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    modal.getBoundingClientRect = () => rect(0, 0, 200, 400);
    const RW = loadModule(win);
    const root = win.document.getElementById('rw-db-root');
    const firstLeft = root.style.left;
    ok(firstLeft === '212px', 'precondition: initial position');

    // Change the rect and fire a mutation WITHOUT a hidden->visible edge (still visible throughout)
    modal.getBoundingClientRect = () => rect(0, 0, 500, 400);
    MO._instances[0].trigger();
    ok(root.style.left === firstLeft, '24e: an unrelated mutation while still open does not reposition the panel');

    // A genuine reopen DOES pick up the new rect.
    modal.hidden = true; MO._instances[0].trigger();
    modal.hidden = false; MO._instances[0].trigger();
    ok(root.style.left === '512px', '24e-2: a fresh reopen recomputes position against the modal\'s current rect');
  }
  {
    // 24f: RW._dbBuildPanel's idempotency guard still correctly finds the root once it has
    // floated outside the modal — the specific bug a modal-scoped check would have reintroduced.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    modal.getBoundingClientRect = () => rect(0, 0, 200, 400);
    const RW = loadModule(win);
    RW._dbMaybeInject(modal); // a repeat call, as test 9b already exercises for the inline case
    const bodyRoots = win.document.body._children.filter((c) => c.id === 'rw-db-root');
    const modalRoots = modal._children.filter((c) => c.id === 'rw-db-root');
    ok(bodyRoots.length === 1 && modalRoots.length === 0,
      '24f: exactly one root exists, in document.body — no duplicate built after floating');
  }

  /* ===== 25. Round 11 — Save as new can overwrite an existing template, with a two-click confirm ===== */
  {
    // 25a: a genuinely new name still saves immediately, no confirm needed — unchanged behavior.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-tpl-name').value = 'B';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    ok(RW._dbTemplates.length === 2 && RW._dbActiveTemplateName === 'B',
      '25a: a new name saves and selects immediately, on the first click');
    ok(win.document.getElementById('rw-db-tpl-saveas').innerText === 'Save as new',
      '25a-2: the button never relabels for a non-duplicate name');
  }
  {
    // 25b-25e: the two-click overwrite confirm, mirroring RW._dbRunFill's own idiom exactly.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const nameEl = win.document.getElementById('rw-db-tpl-name');
    const saveBtn = win.document.getElementById('rw-db-tpl-saveas');
    const statusEl = win.document.getElementById('rw-db-tpl-status');
    const templateEl = win.document.getElementById('rw-db-template');

    nameEl.value = 'B';
    saveBtn._fire('click', {}); // create the target we'll later try to overwrite
    templateEl.value = '{onlyb}';
    templateEl._fire('input', {});
    win.document.getElementById('rw-db-template-select').value = 'Default';
    win.document.getElementById('rw-db-template-select')._fire('change', {});
    templateEl.value = '{newtext}'; // what we're about to save OVER "B"
    templateEl._fire('input', {});

    nameEl.value = 'B'; // an EXISTING name
    saveBtn._fire('click', {});
    ok(RW._dbTemplates.find((t) => t.name === 'B').text === '{onlyb}',
      '25b: the first click does NOT overwrite yet');
    ok(saveBtn.innerText === 'Overwrite?', '25c: the button relabels to "Overwrite?"');
    ok(statusEl.innerText.indexOf('"B" already exists') !== -1, '25c-2: inline status explains why');
    ok(RW._dbActiveTemplateName === 'Default', '25c-3: the active template has not changed yet either');

    saveBtn._fire('click', {}); // same name, second click
    ok(RW._dbTemplates.find((t) => t.name === 'B').text === '{newtext}',
      '25d: a second click on the SAME target commits the overwrite');
    ok(RW._dbActiveTemplateName === 'B', '25d-2: the overwritten template becomes active');
    ok(saveBtn.innerText === 'Save as new', '25e: the button relabels back afterward');
    ok(statusEl.innerText === '' && nameEl.value === '', '25e-2: status and the name field both clear');
    ok(RW._dbTemplates.length === 2, '25e-3: no new entry was created — "B" was overwritten, not duplicated');
  }
  {
    // 25f: changing the typed name between clicks does NOT confirm the original target — it's
    // treated as a fresh first click for the NEW target instead.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const nameEl = win.document.getElementById('rw-db-tpl-name');
    const saveBtn = win.document.getElementById('rw-db-tpl-saveas');
    nameEl.value = 'B'; saveBtn._fire('click', {});
    nameEl.value = 'C'; saveBtn._fire('click', {});

    nameEl.value = 'Default'; // arm targeting "Default"
    saveBtn._fire('click', {});
    ok(saveBtn.innerText === 'Overwrite?', 'precondition: armed for "Default"');

    nameEl.value = 'B'; // switch target WITHOUT a plain input event — direct click with new value
    saveBtn._fire('click', {});
    ok(RW._dbTemplates.find((t) => t.name === 'Default').text === RW._dbBuiltinDefaultTemplate,
      '25f: "Default" was NOT overwritten — the target changed before a matching second click');
    ok(saveBtn.innerText === 'Overwrite?', '25f-2: instead, it re-armed for the new target ("B")');
  }
  {
    // 25g: typing into the name field (an input event) cancels an armed confirmation outright.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const nameEl = win.document.getElementById('rw-db-tpl-name');
    const saveBtn = win.document.getElementById('rw-db-tpl-saveas');
    const statusEl = win.document.getElementById('rw-db-tpl-status');
    nameEl.value = 'Default';
    saveBtn._fire('click', {});
    ok(saveBtn.innerText === 'Overwrite?', 'precondition: armed');

    nameEl.value = 'Default2';
    nameEl._fire('input', {});
    ok(saveBtn.innerText === 'Save as new', '25g: typing after arming cancels it — button relabels back');
    ok(statusEl.innerText === '', '25g-2: the status note clears too');
  }
  {
    // 25h: switching the active template (via the picker) cancels a pending overwrite arm.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-tpl-name').value = 'B';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    win.document.getElementById('rw-db-tpl-name').value = 'Default'; // now arm on "Default"
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    ok(win.document.getElementById('rw-db-tpl-saveas').innerText === 'Overwrite?', 'precondition: armed');

    win.document.getElementById('rw-db-template-select').value = 'B';
    win.document.getElementById('rw-db-template-select')._fire('change', {});
    ok(win.document.getElementById('rw-db-tpl-saveas').innerText === 'Save as new',
      '25h: switching templates cancels the pending arm');
  }
  {
    // 25i: a fresh modal reopen also cancels a pending arm — never carried over between labels.
    let win = seedWin(makeStubWindow().win);
    const MO = makeMutationObserverStub();
    win.MutationObserver = MO;
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-tpl-name').value = 'Default';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    ok(win.document.getElementById('rw-db-tpl-saveas').innerText === 'Overwrite?', 'precondition: armed');

    modal.hidden = true; MO._instances[0].trigger();
    modal.hidden = false; MO._instances[0].trigger();
    ok(win.document.getElementById('rw-db-tpl-saveas').innerText === 'Save as new',
      '25i: a fresh reopen cancels any pending overwrite arm');
  }
  {
    // 25j: the duplicate check is case-insensitive, matching the existing Save-as-new/Rename rule.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-tpl-name').value = 'DEFAULT'; // differs only in case from "Default"
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    ok(win.document.getElementById('rw-db-tpl-saveas').innerText === 'Overwrite?',
      '25j: an existing name is recognized case-insensitively, same as Save-as-new/Rename already were');
    ok(RW._dbTemplates.length === 1, '25j-2: no duplicate entry was created for the differently-cased name');
  }
  {
    // 25k: overwriting the ACTIVE template's own name is a harmless, working no-op-ish case.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{editedwhileactive}';
    templateEl._fire('input', {});
    win.document.getElementById('rw-db-tpl-name').value = 'Default'; // its OWN current name
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {});
    ok(RW._dbTemplates.length === 1 && RW._dbTemplates[0].name === 'Default'
      && RW._dbTemplates[0].text === '{editedwhileactive}',
      '25k: overwriting the active template with its own name works without error or duplication');
  }
  {
    // 25l: regression guard — Rename is unaffected by any of this; it still refuses a duplicate
    // outright, with no arm/confirm state, and never overwrites the OTHER entry.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-tpl-name').value = 'B';
    win.document.getElementById('rw-db-tpl-saveas')._fire('click', {}); // now active = "B"
    win.document.getElementById('rw-db-tpl-name').value = 'Default';
    win.document.getElementById('rw-db-tpl-rename')._fire('click', {});
    ok(RW._dbActiveTemplateName === 'B', '25l: Rename still refuses a duplicate outright — no overwrite, no rename');
    ok(RW._dbTemplates.find((t) => t.name === 'Default').text === RW._dbBuiltinDefaultTemplate,
      '25l-2: the OTHER entry ("Default") is completely untouched');
    ok(win.document.getElementById('rw-db-tpl-rename').innerText === 'Rename',
      '25l-3: Rename has no two-click confirm state of its own — it never relabels');
  }

  /* ===== 26. Round 12 — user-definable formula fields ===== */
  {
    // 26a: RW._dbParseFormulaExpr — accepted shapes
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    ok(JSON.stringify(RW._dbParseFormulaExpr('{a} + {b}')) === JSON.stringify({ names: ['a', 'b'], ops: ['+'] }),
      '26a: spaced two-operand chain');
    ok(JSON.stringify(RW._dbParseFormulaExpr('{a}+{b}-{c}')) === JSON.stringify({ names: ['a', 'b', 'c'], ops: ['+', '-'] }),
      '26a-2: no whitespace at all, three operands');
    ok(JSON.stringify(RW._dbParseFormulaExpr('  {a}   +   {b}  ')) === JSON.stringify({ names: ['a', 'b'], ops: ['+'] }),
      '26a-3: extra/irregular whitespace tolerated');
    ok(JSON.stringify(RW._dbParseFormulaExpr('{a} - {b} + {c} - {d}')) === JSON.stringify({ names: ['a', 'b', 'c', 'd'], ops: ['-', '+', '-'] }),
      '26a-4: a longer mixed chain');
  }
  {
    // 26b: RW._dbParseFormulaExpr — every rejected shape
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    ok(RW._dbParseFormulaExpr('') === null, '26b: empty');
    ok(RW._dbParseFormulaExpr(null) === null, '26b-2: null never throws');
    ok(RW._dbParseFormulaExpr('{a}') === null, '26b-3: a single operand (a pure, always-blank alias) is refused');
    ok(RW._dbParseFormulaExpr('{a} +') === null, '26b-4: a dangling trailing operator');
    ok(RW._dbParseFormulaExpr('+ {a}') === null, '26b-5: a leading operator');
    ok(RW._dbParseFormulaExpr('{a} * {b}') === null, '26b-6: * is out of scope');
    ok(RW._dbParseFormulaExpr('{a} / {b}') === null, '26b-7: / is out of scope');
    ok(RW._dbParseFormulaExpr('({a} + {b})') === null, '26b-8: parentheses are out of scope');
    ok(RW._dbParseFormulaExpr('{a} + b') === null, '26b-9: a bare (non-braced) name is not a valid operand');
    ok(RW._dbParseFormulaExpr('{a:lower} + {b}') === null, '26b-10: a modifier on an operand is refused');
    ok(RW._dbParseFormulaExpr('{a} {b}') === null, '26b-11: two operands with no operator between them');
    ok(RW._dbParseFormulaExpr('{1a} + {b}') === null, '26b-12: an operand name starting with a digit');
    ok(RW._dbParseFormulaExpr('{a} + 6"') === null, '26b-13: a literal number is out of scope');
  }
  {
    // 26c: RW._dbParseFormulaDefinition
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    ok(JSON.stringify(RW._dbParseFormulaDefinition('{total} = {a} + {b}')) ===
      JSON.stringify({ name: 'total', expr: '{a} + {b}', names: ['a', 'b'], ops: ['+'] }),
      '26c: the canonical form');
    ok(JSON.stringify(RW._dbParseFormulaDefinition('{total}={a}+{b}').names) === JSON.stringify(['a', 'b']),
      '26c-2: no whitespace around "="');
    ok(RW._dbParseFormulaDefinition('total = {a} + {b}') === null, '26c-3: a bare (non-braced) LHS is refused');
    ok(RW._dbParseFormulaDefinition('{total:lower} = {a} + {b}') === null, '26c-4: a modifier on the LHS is refused');
    ok(RW._dbParseFormulaDefinition('{total} {a} + {b}') === null, '26c-5: missing "="');
    ok(RW._dbParseFormulaDefinition('{total} = ') === null, '26c-6: empty right-hand side');
    ok(RW._dbParseFormulaDefinition('{total} = {a} = {b}') === null, '26c-7: a second "=" is not a valid expression');
  }
  {
    // 26d: RW._dbEvaluateFormula
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const add = RW._dbParseFormulaDefinition('{total} = {a} + {b}');
    ok(RW._dbEvaluateFormula(add, { a: "1'-0\"", b: "2'-0\"" }) === "3'-0\"", '26d: addition');
    const sub = RW._dbParseFormulaDefinition('{net} = {a} - {b}');
    ok(RW._dbEvaluateFormula(sub, { a: "1'-0\"", b: "3'-0\"" }) === "-2'-0\"", '26d-2: a negative result formats with a leading "-"');
    ok(RW._dbEvaluateFormula(sub, { a: "1'-6 1/2\"", b: "0'-6\"" }) === "1'-0 1/2\"", '26d-3: a fractional remainder reduces to sixteenths');
    const chain = RW._dbParseFormulaDefinition('{t} = {x} - {y} + {z}');
    ok(RW._dbEvaluateFormula(chain, { x: "1'-0\"", y: "0'-6\"", z: "0'-6\"" }) === "1'-0\"",
      '26d-4: strict left-to-right, three operands');
    ok(RW._dbEvaluateFormula(add, { a: "1'-0\"" }) === '', '26d-5: a missing operand -> blank');
    ok(RW._dbEvaluateFormula(add, { a: "1'-0\"", b: '' }) === '', '26d-6: a blank operand -> blank');
    ok(RW._dbEvaluateFormula(add, { a: "1'-0\"", b: 'T/WALL' }) === '', '26d-7: a datum-name operand -> blank');
    ok(RW._dbEvaluateFormula(add, { a: "1'-0\"", b: 'NS' }) === '', '26d-8: an NS operand -> blank');
    ok(RW._dbEvaluateFormula(add, { a: '18', b: "1'-0\"" }) === '', '26d-9: a bare ambiguous number -> blank (RW._dbParseFtIn rejects it)');
  }
  {
    // 26e: RW._dbApplyFormulas — identity-when-empty and order-independent evaluation
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const values = { a: "1'-0\"", b: "2'-0\"" };
    ok(RW._dbApplyFormulas(values) === values, '26e: with no formulas defined, the SAME object is returned (a provable no-op)');

    RW._dbFormulas = [RW._dbParseFormulaDefinition('{total} = {a} + {b}')];
    const out = RW._dbApplyFormulas(values);
    ok(out !== values && out.total === "3'-0\"", '26e-2: a copy is returned, with the formula value injected');
    ok(values.total === undefined, '26e-3: the original object is left untouched');

    // Hand-inject an illegal chained pair, bypassing validation entirely, in BOTH array orders —
    // RW._dbApplyFormulas must degrade to blank regardless, since it evaluates every formula
    // against a frozen snapshot of the ORIGINAL values, never against its own partial output.
    const t = RW._dbParseFormulaDefinition('{t} = {a} + {b}');
    const c = RW._dbParseFormulaDefinition('{c} = {t} + {b}'); // "t" doesn't exist in raw `values`
    RW._dbFormulas = [t, c];
    let r = RW._dbApplyFormulas(values);
    ok(r.t === "3'-0\"" && r.c === '', '26e-4: chained pair, order [t, c] — c degrades to blank, not garbage');
    RW._dbFormulas = [c, t];
    r = RW._dbApplyFormulas(values);
    ok(r.t === "3'-0\"" && r.c === '', '26e-5: same pair, REVERSED array order — identical result, proving order-independence');
  }
  {
    // 26f: RW._dbNeedsSpan
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    ok(RW._dbNeedsSpan(RW._dbDefaultTemplate) === RW._dbTemplateUsesSpan(RW._dbDefaultTemplate),
      '26f: with no formulas, identical to RW._dbTemplateUsesSpan (true case)');
    ok(RW._dbNeedsSpan('{desc} - {keyword}') === RW._dbTemplateUsesSpan('{desc} - {keyword}'),
      '26f-2: ...and identical in the false case too');
    RW._dbFormulas = [RW._dbParseFormulaDefinition('{total} = {span} + {extra}')];
    ok(RW._dbNeedsSpan('{desc} - {total}') === true,
      '26f-3: true when a live formula reads {span}, even though the template itself never mentions it');
  }
  {
    // 26g: RW._dbRenderFinal
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const values = { desc: 'Concrete', keyword: 'Wall' };
    const manual = RW._dbApplyNsExplanation(RW._dbRender('{desc} - {keyword}', values), '{desc} - {keyword}', values);
    ok(RW._dbRenderFinal('{desc} - {keyword}', values) === manual,
      '26g: with no formulas, byte-identical to composing RW._dbRender + RW._dbApplyNsExplanation by hand');

    RW._dbFormulas = [RW._dbParseFormulaDefinition('{total} = {x} + {y}')];
    ok(RW._dbRenderFinal('{total}', { x: "1'-0\"", y: "2'-0\"" }) === "3'-0\"",
      '26g-2: substitutes the computed formula value');
    ok(RW._dbRenderFinal('{total:brk}', { x: "-5'-0\"", y: "1'-0\"" }) === "[-4'-0\"]",
      '26g-3: :brk brackets a negative formula result the same way it brackets top/bot');
  }
  {
    // 26h: Advanced-only visibility
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-formula-wrap').style.display === 'none',
      '26h: hidden in Simple mode');
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    ok(win.document.getElementById('rw-db-formula-wrap').style.display === '',
      '26h-2: shown in Advanced mode');
  }
  {
    // 26i: a valid Add — collection grows, derived names update, inputs clear, no field row.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const inputEl = win.document.getElementById('rw-db-formula-input');
    inputEl.value = '{total} = {top} + {thickness}';
    win.document.getElementById('rw-db-formula-add')._fire('click', {});
    ok(RW._dbFormulas.length === 1 && RW._dbFormulas[0].name === 'total', '26i: the formula is added');
    ok(RW._dbDerivedNames.total === true, '26i-2: its name is registered as derived');
    ok(inputEl.value === '' && win.document.getElementById('rw-db-formula-status').innerText === '',
      '26i-3: the input and status both clear');
    ok(!win.document.getElementById('rw-db-field-total'), '26i-4: no plain input field is created for it');
    ok(!!win.document.getElementById('rw-db-formula-row-total'), '26i-5: a row appears in the formula list');
  }
  {
    // 26j: every refusal, with its exact message, leaves the collection unchanged.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const inputEl = win.document.getElementById('rw-db-formula-input');
    const statusEl = win.document.getElementById('rw-db-formula-status');
    const add = (raw) => { inputEl.value = raw; win.document.getElementById('rw-db-formula-add')._fire('click', {}); };

    add('garbage');
    ok(RW._dbFormulas.length === 0 && statusEl.innerText.indexOf('{total} = {a} + {b}') !== -1,
      '26j: malformed shape — got: ' + statusEl.innerText);

    add('{total} = {x}');
    ok(RW._dbFormulas.length === 0 && statusEl.innerText.indexOf('two or more') !== -1,
      '26j-2: malformed right-hand side — got: ' + statusEl.innerText);

    add('{' + 'q'.repeat(41) + '} = {x} + {y}');
    ok(RW._dbFormulas.length === 0 && statusEl.innerText.indexOf('too long') !== -1, '26j-3: name too long');

    add('{span} = {x} + {y}');
    ok(RW._dbFormulas.length === 0 && statusEl.innerText.indexOf('reserved') !== -1, '26j-4: reserved name (span)');

    add('{a} = {x} + {y}');
    ok(RW._dbFormulas.length === 0 && statusEl.innerText.indexOf('reserved') !== -1, '26j-5: reserved name (a)');

    add('{total} = {x} + {y}');
    ok(RW._dbFormulas.length === 1, 'precondition: "total" defined');
    add('{total} = {p} + {q}');
    ok(RW._dbFormulas.length === 1 && RW._dbFormulas[0].expr === '{x} + {y}' && statusEl.innerText.indexOf('already exists') !== -1,
      '26j-6: duplicate name — refused, original untouched — got: ' + statusEl.innerText);

    add('{t} = {t} + {z}');
    ok(!RW._dbFormulas.some((f) => f.name === 't') && statusEl.innerText.indexOf("can't use its own name") !== -1,
      '26j-7: self-reference — got: ' + statusEl.innerText);

    add('{c} = {total} + {z}');
    ok(!RW._dbFormulas.some((f) => f.name === 'c') && statusEl.innerText.indexOf('is itself a formula') !== -1,
      '26j-8: an operand that is already a formula — got: ' + statusEl.innerText);

    add('{x} = {p} + {q}'); // "x" is already an OPERAND of "total" — the other chaining direction
    ok(!RW._dbFormulas.some((f) => f.name === 'x') && statusEl.innerText.indexOf('already used inside the formula for "total"') !== -1,
      '26j-9: a name already used as an OPERAND of an existing formula — got: ' + statusEl.innerText);

    add('{net} = {x} + {a}');
    ok(!RW._dbFormulas.some((f) => f.name === 'net') && statusEl.innerText.indexOf("a/an article") !== -1,
      '26j-10: {a} the article as an operand — got: ' + statusEl.innerText);

    add('{desc} = {p} + {q}'); // "desc" is a real field in the built-in default template
    ok(!RW._dbFormulas.some((f) => f.name === 'desc') && statusEl.innerText.indexOf('already a field in the template') !== -1,
      '26j-11: name collides with a plain field in a saved template — got: ' + statusEl.innerText);
  }
  {
    // 26k/26l: Delete — via RW._dbDeleteFormula directly and via its own row button.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-formula-input').value = '{total} = {x} + {y}';
    win.document.getElementById('rw-db-formula-add')._fire('click', {});
    ok(!!win.document.getElementById('rw-db-formula-del-total'), 'precondition: the row and its Delete button exist');

    win.document.getElementById('rw-db-formula-del-total')._fire('click', {});
    ok(RW._dbFormulas.length === 0, '26k: the formula is removed');
    ok(RW._dbDerivedNames.total === undefined, '26k-2: its derived-name registration is removed too');
    ok(!win.document.getElementById('rw-db-formula-row-total'), '26l: its row disappears from the list');

    // "total" is usable as a plain field again, now that it's no longer a formula.
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{total}';
    templateEl._fire('input', {});
    ok(!!win.document.getElementById('rw-db-field-total'), '26k-3: {total} becomes a normal input field on the next rebuild');
  }
  {
    // 26m: preview and Fill agree exactly, with a formula in play.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-formula-input').value = '{total} = {x} + {y}';
    win.document.getElementById('rw-db-formula-add')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    // {x}/{y} must ALSO appear literally in the template — a formula's operands only get their
    // own input row when they're literally used somewhere (see round 12's documented round-trip
    // limitation) — {total} alone would leave nothing for the annotator to actually type into.
    templateEl.value = 'x: {x}\ny: {y}\ntotal: {total}';
    templateEl._fire('input', {});
    const set = (name, val) => { const el = win.document.getElementById('rw-db-field-' + name); el.value = val; el._fire('input', {}); };
    set('x', "1'-0\""); set('y', "2'-0\"");

    const preview = win.document.getElementById('rw-db-preview').innerText;
    ok(preview === "x: 1'-0\"\ny: 2'-0\"\ntotal: 3'-0\"", '26m: the preview shows the computed total — got: ' + preview);
    ok(preview === RW._dbComputeOutput(), '26m-2: matches RW._dbComputeOutput exactly');

    win.document.getElementById('rw-db-fill')._fire('click', {});
    ok(modal.querySelector('#label-description').value === preview, '26m-3: Fill writes exactly what the preview showed');
  }
  {
    // 26n: a formula reading {span} in a template that never mentions {span} itself still
    // computes, and the span row (and its Override button) becomes visible.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const modal = makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-formula-input').value = '{doubled} = {span} + {span}';
    win.document.getElementById('rw-db-formula-add')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    // {top}/{bot} still need their own literal mention to get real input rows — the span ROW
    // itself is a fixed part of the panel, not template-generated, which is exactly what this
    // test is proving (it shows even though {span} itself is never written by the template).
    templateEl.value = 'top: {top}\nbot: {bot}\ndoubled: {doubled}';
    templateEl._fire('input', {});
    ok(!!win.document.getElementById('rw-db-span-row') && win.document.getElementById('rw-db-span-row').style.display !== 'none',
      '26n: the span row is visible even though the template never writes {span} itself');
    const set = (name, val) => { const el = win.document.getElementById('rw-db-field-' + name); el.value = val; el._fire('input', {}); };
    set('top', "-12'-0\""); set('bot', "-14'-0\"");
    ok(win.document.getElementById('rw-db-preview').innerText === "top: -12'-0\"\nbot: -14'-0\"\ndoubled: 4'-0\"",
      '26n-2: computed correctly — got: ' + win.document.getElementById('rw-db-preview').innerText);
  }
  {
    // 26o: persistence — only {name, expr} is written.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-formula-input').value = '{total} = {x} + {y}';
    win.document.getElementById('rw-db-formula-add')._fire('click', {});
    const saved = JSON.parse(win.localStorage.getItem(RW._dbFormulasStorageKey));
    ok(JSON.stringify(saved) === JSON.stringify([{ name: 'total', expr: '{x} + {y}' }]),
      '26o: storage holds only {name, expr} — got: ' + JSON.stringify(saved));
  }
  {
    // 26p: survives a simulated reload (a second window sharing the same underlying storage).
    const win1 = seedWin(makeStubWindow().win);
    win1.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win1, { title: 'Create New Label' });
    const RW1 = loadModule(win1);
    win1.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win1.document.getElementById('rw-db-formula-input').value = '{total} = {x} + {y}';
    win1.document.getElementById('rw-db-formula-add')._fire('click', {});

    const win2 = seedWin(makeStubWindow().win);
    win2.localStorage = win1.localStorage;
    win2.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win2, { title: 'Create New Label' });
    const RW2 = loadModule(win2);
    ok(RW2._dbFormulas.length === 1 && RW2._dbFormulas[0].name === 'total', '26p: survives a reload');
    ok(RW2._dbDerivedNames.total === true, '26p-2: its derived-name registration survives too');
  }
  {
    // 26q: malformed/illegal stored entries are dropped individually, never throwing, never
    // rejecting the whole collection.
    let win = seedWin(makeStubWindow().win);
    win.localStorage.setItem('rwDescFormulas', JSON.stringify([
      { name: 'good', expr: '{x} + {y}' },
      { name: 'badshape', expr: '{x}' },               // single operand
      { name: 'span', expr: '{x} + {y}' },             // reserved name
      { name: 'selfref', expr: '{selfref} + {x}' },    // self-reference
      { name: 'chain1', expr: '{x} + {y}' },
      { name: 'chain2', expr: '{chain1} + {p}' },      // chains off chain1 — only chain2 is dropped;
                                                        // chain1 itself is a perfectly valid formula
                                                        // built from plain fields, so it stands alone
      'not an object',
      { name: 'GOOD', expr: '{p} + {q}' },             // case-insensitive duplicate of "good"
    ]));
    win.MutationObserver = makeMutationObserverStub();
    let threw = false, RW;
    try { makeFakeLabelModal(win, { title: 'Create New Label' }); RW = loadModule(win); }
    catch (e) { threw = true; }
    ok(!threw, '26q: a corrupt/illegal formulas blob never crashes install');
    const names = RW._dbFormulas.map((f) => f.name).sort();
    ok(JSON.stringify(names) === JSON.stringify(['chain1', 'good']),
      '26q-2: the genuinely valid entries survive, chain2 alone dropped for chaining — got: ' + JSON.stringify(names));
  }
  {
    // 26r: a non-array / unparseable JSON blob falls back to an empty collection, no throw.
    let win = seedWin(makeStubWindow().win);
    win.localStorage.setItem('rwDescFormulas', 'not valid json{');
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbFormulas.length === 0, '26r: corrupt JSON falls back to no formulas at all');
  }
  {
    // 26s: a console override (RW._dbFormulas set before this module ran) wins over storage.
    let win = seedWin(makeStubWindow().win);
    win.localStorage.setItem('rwDescFormulas', JSON.stringify([{ name: 'fromstorage', expr: '{x} + {y}' }]));
    win.__RW = { _dbFormulas: [{ name: 'fromconsole', expr: '{x} + {y}' }] };
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    ok(RW._dbFormulas.length === 1 && RW._dbFormulas[0].name === 'fromconsole',
      '26s: a pre-set console override wins over a seeded stored collection');
  }
  {
    // 26t: a throwing localStorage never crashes install, or a later Add.
    const s = makeStubWindow();
    let win = seedWin(s.win);
    win.localStorage = s.makeStorage({ throwing: true });
    win.MutationObserver = makeMutationObserverStub();
    let threw = false, RW;
    try { makeFakeLabelModal(win, { title: 'Create New Label' }); RW = loadModule(win); }
    catch (e) { threw = true; }
    ok(!threw, '26t: a throwing localStorage does not crash install');
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-formula-input').value = '{total} = {x} + {y}';
    let threwOnAdd = false;
    try { win.document.getElementById('rw-db-formula-add')._fire('click', {}); }
    catch (e) { threwOnAdd = true; }
    ok(!threwOnAdd, '26t-2: adding a formula with a throwing localStorage does not throw either');
    ok(RW._dbFormulas.length === 1, '26t-3: the add still succeeds in-memory, just isn\'t persisted');
  }
  {
    // 26u: deleting the last formula removes the storage key entirely.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-formula-input').value = '{total} = {x} + {y}';
    win.document.getElementById('rw-db-formula-add')._fire('click', {});
    ok(win.localStorage.getItem(RW._dbFormulasStorageKey) !== null, 'precondition: saved');
    win.document.getElementById('rw-db-formula-del-total')._fire('click', {});
    ok(win.localStorage.getItem(RW._dbFormulasStorageKey) === null, '26u: the key is removed, not left holding "[]"');
  }
  {
    // 26v: untouched-guarantee regressions — with ZERO formulas defined, nothing about this round
    // changes any existing behavior.
    const win = seedWin(makeStubWindow().win);
    const RW = loadModule(win);
    const values = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes',
    };
    values.span = RW._dbSpan(values.top, values.bot, '').value;
    const out = RW._dbRender(RW._dbDefaultTemplate, values);
    const expected = [
      'Concrete - Wall', 'schedule', 'height: [-12\'-0"] - [-14\'-0"]', 'thickness: 18"',
      'explanation: The detail shows an 18" concrete wall with the height of 2\'-0". the thickness can be found in schedule table within the same page while the height can be found in the plan and notes',
    ].join('\n');
    ok(out === expected, '26v: the headline test (7a) is unaffected, re-asserted here for locality');
    ok(JSON.stringify(RW._dbDerivedNames) === JSON.stringify({ span: true, a: true }),
      '26v-2: RW._dbDerivedNames deep-equals {span:true, a:true} with no formulas ever defined');
  }
  {
    // 26w: round 8's NS substitution still fires correctly through RW._dbRenderFinal.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    const set = (name, val) => { const el = win.document.getElementById('rw-db-field-' + name); el.value = val; el._fire('input', {}); };
    set('desc', 'Concrete'); set('keyword', 'Wall'); set('source', 'schedule');
    set('word', 'height'); set('top', "-12'-0\""); set('where', 'the plan and notes');
    set('thickness', 'NS');
    ok(win.document.getElementById('rw-db-preview').innerText.indexOf('No thickness information found') !== -1,
      '26w: round 8\'s NS wording still fires, routed through RW._dbRenderFinal');
  }
  {
    // 26x: round 4's full field recovery is unaffected by a formula placeholder sitting in the
    // template — it recovers every plain field exactly, and the formula name appears in NONE of
    // recovered/missing/weak (it was never a candidate to recover in the first place).
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    const helperWin = seedWin(makeStubWindow().win);
    const RWHelper = loadModule(helperWin);
    win.__RW = { _dbFormulas: [{ name: 'total', expr: '{x} + {y}' }] }; // won't matter for THIS test
    const sample = {
      desc: 'Concrete', keyword: 'Wall', source: 'schedule', word: 'height',
      top: "-12'-0\"", bot: "-14'-0\"", thickness: '18"', where: 'the plan and notes',
    };
    sample.span = RWHelper._dbSpan(sample.top, sample.bot, '').value;
    const rendered = RWHelper._dbRender(RWHelper._dbDefaultTemplate, sample);
    makeFakeLabelModal(win, { title: 'Edit Label', description: rendered });
    const RW = loadModule(win);
    ok(win.document.getElementById('rw-db-field-desc').value === 'Concrete', '26x: an ordinary field still recovers exactly');
    ok(win.document.getElementById('rw-db-prefill-status').innerText.indexOf('preview matches it exactly') !== -1,
      '26x-2: the exact byte-for-byte prefill signal is unaffected');
  }
  {
    // 26y: THE regression test this round exists to prove — with a formula in the active
    // template, RW._dbDetectTemplate on a description containing its rendered value reports
    // exact === true. This is the direct check that RW._dbDetectTemplate and RW._dbComputeOutput
    // sharing RW._dbRenderFinal actually closes the round-9-style gap, not just tidies the code.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    win.document.getElementById('rw-db-formula-input').value = '{total} = {x} + {y}';
    win.document.getElementById('rw-db-formula-add')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = 'material: {x}\nother: {y}\ntotal: {total}';
    templateEl._fire('input', {});

    const desc = 'material: 1\'-0"\nother: 2\'-0"\ntotal: 3\'-0"';
    const hit = RW._dbDetectTemplate(desc);
    ok(hit && hit.name === 'Default' && hit.exact === true,
      '26y: RW._dbDetectTemplate reports an exact match for a description containing the formula\'s own computed value — got ' + JSON.stringify(hit && { name: hit.name, exact: hit.exact }));
  }

  console.log((pass + fail) + ' tests, ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
