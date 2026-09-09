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

function makeStubWindow(){
  const registry = new Map();
  function registerId(el){ if (el && el.id) registry.set(el.id, el); }
  function unregisterId(el){ if (el && el.id && registry.get(el.id) === el) registry.delete(el.id); }

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
      setPointerCapture(){}, releasePointerCapture(){},
      setAttribute(name, val){ attrs[name] = String(val); if (name === 'list') this.list = val; },
      getAttribute(name){ return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
      appendChild(child){ this._children.push(child); child._parent = this; registerId(child); return child; },
      insertBefore(child, ref){
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
      getBoundingClientRect(){ return { left: 0, top: 0, width: 100, height: 100 }; },
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
    // 19b: editing the textarea writes the new value into storage under the console-overridable key.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{custom} field';
    templateEl._fire('input', {});
    ok(win.localStorage.getItem(RW._dbTemplateStorageKey) === '{custom} field', '19b: an edit is saved to localStorage under RW._dbTemplateStorageKey');
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
    // 19f: Reset to default clears storage and restores the exact built-in template.
    let win = seedWin(makeStubWindow().win);
    win.MutationObserver = makeMutationObserverStub();
    makeFakeLabelModal(win, { title: 'Create New Label' });
    const RW = loadModule(win);
    win.document.getElementById('rw-db-adv-toggle')._fire('click', {});
    const templateEl = win.document.getElementById('rw-db-template');
    templateEl.value = '{custom}';
    templateEl._fire('input', {});
    ok(win.localStorage.getItem(RW._dbTemplateStorageKey) === '{custom}', 'precondition: the custom edit was saved');

    win.document.getElementById('rw-db-template-reset')._fire('click', {});
    ok(RW._dbDefaultTemplate === RW._dbBuiltinDefaultTemplate, '19f: Reset to default restores RW._dbDefaultTemplate to the exact built-in template');
    ok(win.document.getElementById('rw-db-template').value === RW._dbBuiltinDefaultTemplate, '19f-2: the textarea reflects the reset immediately');
    ok(win.localStorage.getItem(RW._dbTemplateStorageKey) === null, '19f-3: the stored value is forgotten, not merely overwritten with the built-in text');
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

  console.log((pass + fail) + ' tests, ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
