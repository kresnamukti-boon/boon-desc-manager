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

  const winListeners = {};
  const win = {
    document: documentStub,
    innerWidth: 1200,
    innerHeight: 800,
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

  return { win, doc: documentStub, byId: (id) => registry.get(id) || null };
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
    ok(out.indexOf('height: [T/WALL] - [T/FOOTING]') !== -1, '8a: datum values render into the measurement line');
    ok(out.indexOf('with the height of T/WALL to T/FOOTING.') !== -1, '8b: span falls back to "top to bot" in the explanation');

    values.word = 'depth';
    out = RW._dbRender(RW._dbDefaultTemplate, values);
    ok(out.indexOf('depth: [T/WALL] - [T/FOOTING]') !== -1 && out.indexOf('with the depth of') !== -1
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

  console.log((pass + fail) + ' tests, ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
