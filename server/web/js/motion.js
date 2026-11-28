// Nichts verschwindet ohne Animation: Ein- und Ausblenden über `el.hidden = …` und das Auf- und Zuklappen von
// <details> laufen animiert (Höhe und Deckkraft). Gilt für die ganze App, ohne jede Stelle einzeln anzupassen.
// Ohne Animation bleibt es, wenn das Element nicht im Dokument steht, gerade gar nicht sichtbar ist,
// in einem Bereich mit data-noanim liegt oder das System „Bewegung reduzieren“ verlangt.

const DUR = 200;
const EASE = 'cubic-bezier(.2, 0, 0, 1)';
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');

function shown(el) {
  return el.isConnected && el.getClientRects().length > 0;
}

function skip(el) {
  // Seitenbereiche direkt im <body> (App, Anmeldung, Einrichtung) wechseln ohne Zusammenklappen.
  // Während eine Seite gerade einblendet, gilt der erste Zustand sofort (sonst springen Kacheln beim Aufbau).
  // Im Hintergrund (App/Tab nicht sichtbar) sofort: sonst läuft die Animation erst beim Zurückkommen sichtbar nach
  return reduced() || document.visibilityState === 'hidden' || (enterView?.contains(el) && el !== enterView && performance.now() < enterSettle) || !el.isConnected || el.parentElement === document.body || el.closest?.('[data-noanim]') || typeof el.animate !== 'function';
}

const COLLAPSED = { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' };
function boxOf(el) {
  const cs = getComputedStyle(el);
  return { height: `${el.offsetHeight}px`, opacity: 1, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, marginBottom: cs.marginBottom };
}

function run(el, frames, done) {
  el.__anim?.cancel();
  const prevOverflow = el.style.overflow;
  el.style.overflow = 'hidden';
  const a = el.animate(frames, { duration: DUR, easing: EASE });
  el.__anim = a;
  const finish = () => {
    if (el.__anim !== a) return;
    el.__anim = null;
    el.style.overflow = prevOverflow;
    done?.();
  };
  a.onfinish = finish;
  a.oncancel = () => { if (el.__anim === a) el.__anim = null; el.style.overflow = prevOverflow; };
  return a;
}

// Ausblenden: erst zusammenklappen, dann wirklich verstecken. Der Getter liefert schon den Zielzustand.
function hide(el) {
  if (skip(el) || !shown(el)) { native.set.call(el, true); return; }
  el.__hideTarget = true;
  run(el, [boxOf(el), COLLAPSED], () => { el.__hideTarget = undefined; native.set.call(el, true); el.dispatchEvent(new Event('motionend')); });
}

// Einblenden: sichtbar machen und von Höhe 0 aufklappen
function show(el) {
  el.__hideTarget = undefined;
  el.__anim?.cancel();
  native.set.call(el, false);
  if (skip(el) || !shown(el)) return;
  run(el, [COLLAPSED, boxOf(el)], () => el.dispatchEvent(new Event('motionend')));
}

Object.defineProperty(HTMLElement.prototype, 'hidden', {
  configurable: true,
  enumerable: native.enumerable,
  get() {
    return this.__hideTarget ?? native.get.call(this);
  },
  set(v) {
    const want = Boolean(v);
    const pending = this.__hideTarget;
    if (pending === undefined && native.get.call(this) === want) return; // nichts zu tun (z. B. bei jeder Statusmeldung)
    if (pending === true && want) return; // klappt schon zu
    if (want) hide(this);
    else show(this);
  },
});

// Wartet, bis eine laufende Ein-/Ausblend-Animation fertig ist (für Code, der danach Größen misst)
export function afterMotion(el) {
  return el?.__anim ? el.__anim.finished.catch(() => {}) : Promise.resolve();
}

// <details>: Schließen animiert (der Browser schließt sonst sofort), Öffnen klappt auf
document.addEventListener('click', (e) => {
  const summary = e.target.closest?.('summary');
  const det = summary?.parentElement;
  if (!(det instanceof HTMLDetailsElement) || summary !== det.querySelector(':scope > summary') || reduced()) return;
  const body = [...det.children].filter((c) => c !== summary);
  if (!body.length) return;
  if (det.open) {
    e.preventDefault();
    if (det.__closing) return;
    det.__closing = true;
    let left = body.length;
    for (const c of body) {
      run(c, [boxOf(c), COLLAPSED], () => {
        if (--left === 0) {
          det.__closing = false;
          det.open = false;
        }
      });
    }
  } else {
    requestAnimationFrame(() => {
      for (const c of body) if (shown(c)) run(c, [COLLAPSED, boxOf(c)]);
    });
  }
}, true);

// Nachgeladene Inhalte einer Seite (Karten, Listen, Kacheln) blenden ebenso ein wie der erste Aufbau. Nur in der
// Ladephase kurz nach dem Seitenwechsel, damit laufende Aktualisierungen (Statuswerte) nicht ständig animieren.
const ENTER = '.card, .tile, .list, .list-item, .script-item, details.fold, .section-title, .empty, .offline-banner, .chips, .kv';
let enterView = null;
let enterUntil = 0;
let enterSettle = 0;
let enterDy = 24;
// Nach der Ladephase: Kacheln und Listen zeichnen sich bei jeder Statusmeldung neu. Ein eingefügtes Element gilt
// nur dann als „erscheint“, wenn es kein gleichartiges entferntes Gegenstück gibt (erst gleiche Art und gleicher
// Text, dann gleiche Art); umgekehrt „verschwindet“ ein entferntes ohne Gegenstück. Beides läuft wie beim
// Auf- und Zuklappen der Live-Werte: erscheinen = Fläche wächst, dann von oben einblenden; verschwinden = erst
// ausblenden, dann schrumpft die Fläche. Unverändert neu gezeichnete Inhalte bewegen sich nicht.
const sig = (el) => `${el.tagName}.${el.getAttribute('class') || ''}`;
const txt = (el) => (el.textContent || '').trim().slice(0, 80);
const LIVE = { easing: 'cubic-bezier(.2, 0, 0, 1)' };
const FLAT = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' };
const inlineish = (el) => getComputedStyle(el).display.startsWith('inline');
function sizeOf(el) {
  const { opacity, ...box } = boxOf(el); // nur Höhe und Abstände
  return box;
}

function grow(el) {
  if (inlineish(el)) {
    el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { transform: 'none' }], { ...LIVE, duration: 180 });
    return;
  }
  const prev = el.style.overflow;
  el.style.overflow = 'hidden';
  const h = el.animate([FLAT, sizeOf(el)], { ...LIVE, duration: 260 });
  h.onfinish = h.oncancel = () => { el.style.overflow = prev; };
  el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { transform: 'none' }], { ...LIVE, duration: 180, delay: 80, fill: 'backwards' });
}

// Entferntes Element kurz an seinen alten Platz zurück (noch vor dem nächsten Bild), ausblenden, zusammenklappen, weg
function vanish(el, parent, before) {
  el.__ghost = true;
  el.setAttribute('aria-hidden', 'true');
  el.style.pointerEvents = 'none';
  parent.insertBefore(el, before && before.parentNode === parent ? before : null);
  // Schon unsichtbar oder mit eigener Abgangs-Animation (CSS-Klasse): nicht ein zweites Mal ausblenden
  const cs = getComputedStyle(el);
  if (el.getClientRects().length === 0 || Number(cs.opacity) < 0.05 || el.offsetHeight < 2
    || el.getAnimations?.().some((a) => typeof CSSAnimation === 'function' && a instanceof CSSAnimation)) { el.remove(); return; }
  const fade = el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px)' }], { ...LIVE, duration: 150, fill: 'forwards' });
  fade.onfinish = () => {
    if (!el.isConnected) return;
    if (inlineish(el)) { el.remove(); return; }
    el.style.overflow = 'hidden';
    const h = el.animate([sizeOf(el), FLAT], { ...LIVE, duration: 220, fill: 'forwards' });
    h.onfinish = () => el.remove();
  };
  fade.oncancel = () => el.remove();
}

// Paare aus entfernten und eingefügten Geschwistern: erst gleiche Art + gleicher Text, dann gleiche Art
function pairUp(removed, added) {
  const pair = new Map(); // entfernt → eingefügt
  const used = new Set();
  const byKey = (keyOf) => {
    const pool = new Map();
    for (const el of removed) if (!pair.has(el)) { const k = keyOf(el); if (!pool.has(k)) pool.set(k, []); pool.get(k).push(el); }
    for (const el of added) {
      if (used.has(el)) continue;
      const list = pool.get(keyOf(el));
      if (list?.length) { const old = list.shift(); pair.set(old, el); used.add(el); }
    }
  };
  byKey((el) => `${sig(el)}|${txt(el)}`);
  byKey(sig);
  return { pair, used };
}

// Abgleich einer Ebene: Neues wächst herein, Weggefallenes klappt weg; gleichartige Paare werden (bis zur Tiefe 3)
// auch innen verglichen – so blendet z. B. ein neuer Eintrag in einer komplett neu gezeichneten Karte ein.
function reconcile(target, removed, added, nextSibling, depth) {
  const { pair, used } = pairUp(removed, added);
  for (const el of added) {
    if (used.has(el) || !(el instanceof HTMLElement) || typeof el.animate !== 'function') continue;
    if (!el.isConnected || el.hidden || el.getClientRects().length === 0) continue;
    // Effekte mit eigener Animation (Tipp-Welle, Spinner …) nicht anfassen
    if (el.classList.contains('ripple') || el.getAnimations?.().length) continue;
    grow(el);
  }
  // Verschwinden: nicht für Kacheln im Raster und nicht, wenn ein ganzer Bereich ausgetauscht wurde
  const gone = removed.filter((el) => !pair.has(el) && el instanceof HTMLElement && !el.classList.contains('ripple') && !el.classList.contains('tile'));
  if (gone.length && gone.length <= 6 && !target.classList.contains('dash') && target.isConnected) {
    for (const el of gone) {
      // alter Platz: vor dem Gegenstück des nächsten gebliebenen Elements, sonst an der alten Stelle
      const i = removed.indexOf(el);
      const nextKept = removed.slice(i + 1).map((x) => pair.get(x)).find((x) => x && x.parentNode === target);
      vanish(el, target, nextKept || nextSibling);
    }
  }
  if (depth >= 3) return;
  for (const [old, now] of pair) {
    if (old === now || !(now instanceof HTMLElement) || now.closest('[data-noanim]')) continue;
    if (txt(old) === txt(now) && old.childElementCount === now.childElementCount) continue; // unverändert
    reconcile(now, [...old.children], [...now.children], null, depth + 1);
  }
}

function appeared(records) {
  if (reduced() || document.visibilityState === 'hidden') return;
  // nur verschoben (in einem Durchgang entfernt und wieder eingefügt): weder ein- noch ausblenden
  const allRemoved = new Set(records.flatMap((r) => [...r.removedNodes]));
  const moved = new Set(records.flatMap((r) => [...r.addedNodes]).filter((n) => allRemoved.has(n)));
  for (const r of records) {
    if (r.type !== 'childList') continue;
    const target = r.target;
    if (!(target instanceof Element) || target.closest('[data-noanim]')) continue;
    const added = [...r.addedNodes].filter((n) => n instanceof Element && !n.__ghost && !moved.has(n));
    const removed = [...r.removedNodes].filter((n) => n instanceof Element && !n.__ghost && !moved.has(n) && !n.isConnected);
    if (!added.length && !removed.length) continue;
    reconcile(target, removed, added, r.nextSibling, 0);
  }
}

const observer = typeof MutationObserver === 'function' ? new MutationObserver((records) => {
  if (performance.now() > enterUntil) { appeared(records); return; }
  if (reduced()) return;
  let n = 0;
  for (const r of records) {
    for (const node of r.addedNodes) {
      // In einen aufgeklappten Bereich nachgeladene Zeilen (statt „Lade …“): Fläche wächst, Inhalt blendet ein –
      // wie nach der Ladephase, sonst springen sie ohne Übergang herein
      if (node instanceof HTMLElement && node.parentElement?.closest('details[open] > .fold-body') && !node.__ghost
        && typeof node.animate === 'function' && !node.closest('[data-noanim]') && node.getClientRects().length && !node.getAnimations?.().length) {
        grow(node);
        continue;
      }
      if (!(node instanceof HTMLElement) || node.parentElement === enterView || !node.matches(ENTER)) continue;
      if (node.parentElement?.classList.contains('stagger')) continue; // blendet schon per CSS gestaffelt ein
      if (node.closest('[data-noanim]') || typeof node.animate !== 'function') continue;
      // nicht noch einmal, wenn ein umgebendes Element gerade selbst einblendet
      let p = node.parentElement, busy = false;
      while (p && p !== enterView) { if (p.__entering) { busy = true; break; } p = p.parentElement; }
      if (busy) continue;
      node.__entering = true;
      const a = node.animate([{ opacity: 0, transform: `translateY(${enterDy}px)` }, { transform: 'none' }], // Ziel: eigene Deckkraft
        { duration: 380, delay: Math.min(n++, 8) * 30, easing: 'cubic-bezier(.05, .7, .1, 1)', fill: 'backwards' });
      a.onfinish = a.oncancel = () => { node.__entering = false; };
    }
  }
}) : null;

// Sobald jemand tippt oder klickt, ist die Ladephase vorbei: was danach neu gezeichnet wird (z. B. Auswahlknöpfe),
// erscheint ohne Einflug-Animation
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { enterUntil = 0; enterSettle = 0; }, true);

// Beim Seitenwechsel aufrufen: fromAbove für die Seiten der unteren Leiste
export function pageEnter(view, fromAbove) {
  enterDy = fromAbove ? -18 : 24;
  view.classList.toggle('from-above', Boolean(fromAbove));
  enterSettle = performance.now() + 700;
  if (!observer) { enterView = view; return; }
  if (enterView !== view) { observer.disconnect(); observer.observe(view, { childList: true, subtree: true }); enterView = view; }
  enterUntil = performance.now() + 2500;
}

// --- Layout-Sprünge beim Ändern der Fenstergröße ------------------------------------------------------------------
// Wechselt die Navigationsleiste (unten ↔ links) oder bricht ein Bereich um, springen Inhalte. Die Lage von Leiste,
// App-Bereich und Karten wird nach jedem Bild gemerkt (ResizeObserver läuft nach dem Layout); springt etwas zwischen
// zwei Bildern um mehr als 40 px, gleitet es von der alten an die neue Stelle. Stetiges Mitwachsen bleibt direkt.
// Kacheln auf Home animiert das Dashboard selbst.
const JUMP = 40;
const tracked = () => {
  const list = [document.getElementById('navbar'), document.querySelector('.app > .topbar'), document.getElementById('view')];
  const view = document.getElementById('view');
  if (view) for (const el of view.querySelectorAll(':scope > *, :scope > * > .card, .view .card, .view .list-item')) if (list.length < 80) list.push(el);
  return list.filter((el) => el && !el.closest('.dash'));
};
// Lage im Dokument ohne laufende Verschiebungen (offset-Kette ignoriert transform)
const docRect = (el) => {
  let x = 0;
  let y = 0;
  for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
  return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
};
let rects = new WeakMap();
let lastWide = null;
function remember() {
  const next = new WeakMap();
  for (const el of tracked()) next.set(el, docRect(el));
  rects = next;
}
function onLayoutChange() {
  if (reduced() || document.visibilityState === 'hidden') { remember(); return; }
  const nav = document.getElementById('navbar');
  const wide = nav ? getComputedStyle(nav).flexDirection.startsWith('column') || nav.getBoundingClientRect().height > window.innerHeight / 2 : null;
  const switched = lastWide !== null && wide !== lastWide;
  lastWide = wide;
  const moved = []; // schon verschobene Bereiche: ihre Inhalte gleiten mit, nicht noch einmal einzeln
  for (const el of tracked()) {
    const r0 = rects.get(el);
    if (!r0 || !el.isConnected || el.getClientRects().length === 0) continue;
    const r1 = docRect(el);
    const dx = r0.left - r1.left;
    const dy = r0.top - r1.top;
    if (el === nav && switched) {
      // Leiste wechselt den Platz: von links bzw. von unten hereingleiten
      nav.animate(wide ? [{ transform: 'translateX(-100%)', opacity: 0 }, { transform: 'none', opacity: 1 }]
        : [{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2, 0, 0, 1)' });
      continue;
    }
    if (Math.abs(dx) < JUMP && Math.abs(dy) < JUMP) continue;
    if (el.getAnimations?.().some((a) => a.playState === 'running')) continue;
    // Inhalt eines schon verschobenen Bereichs: nur den Rest der Bewegung animieren
    const parent = moved.find((m) => m.el.contains(el));
    const rx = dx - (parent?.dx || 0);
    const ry = dy - (parent?.dy || 0);
    moved.push({ el, dx, dy });
    if (Math.abs(rx) < JUMP && Math.abs(ry) < JUMP) continue;
    el.animate([{ transform: `translate(${rx}px, ${ry}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2, 0, 0, 1)' });
  }
  remember();
}
if (typeof ResizeObserver === 'function') {
  let pending = false;
  const ro = new ResizeObserver(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; onLayoutChange(); });
  });
  ro.observe(document.documentElement);
  // nach Seitenwechseln und Inhaltsänderungen die Lage neu merken (ohne Animation)
  let t = 0;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(remember, 400); }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(remember, 200); }, { passive: true });
}
