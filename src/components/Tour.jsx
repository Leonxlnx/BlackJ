import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, getState, subscribe } from '../store.js';
import { useT } from '../i18n.js';
import * as A from '../actions.js';
import { parseTarget, resolve, rectOf } from '../lib/tour.js';
import Icon from './Icon.jsx';

const CLICKABLE = 'button, a, [role="button"], [role="tab"], [role="menuitem"]';
const MISSING_MS = 4000;

/** What ends a step when the tutor gave no action: right-click on classes, click on buttons. */
function actionOf(step, el) {
  const kind = (parseTarget(step.target) || {}).kind;
  let action = step.action || (kind === 'class' ? 'contextmenu' : el && el.matches(CLICKABLE) ? 'click' : 'next');
  // A disabled target (debugger buttons while running, compile while compiling) cannot be clicked.
  if (['click', 'doubleclick', 'contextmenu'].includes(action) && el && el.matches(':disabled')) action = 'next';
  return action;
}

/** **bold** and `code`, nothing else (the text comes from the model). */
function inline(text) {
  return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

/** The file a "type" step watches: the step's own file, else the open one. */
function fileOfStep(target) {
  const p = parseTarget(target);
  if (p && (p.kind === 'line' || p.kind === 'gutter' || p.kind === 'editor-tab')) return p.arg;
  return getState().activeTab;
}

/** Auto-advance: resolves the step when the student did what it asks. Returns a cleanup. */
function watchStep(tour, action, onDone) {
  const step = tour.steps[tour.index];
  const s0 = getState();
  const inTarget = (e) => {
    const el = resolve(step.target);
    return el && el.contains(e.target);
  };
  const later = () => setTimeout(onDone, 120);
  const offs = [];
  const on = (type, test) => {
    const h = (e) => test(e) && later();
    document.addEventListener(type, h, true);
    offs.push(() => document.removeEventListener(type, h, true));
  };
  const watch = (test) => offs.push(subscribe(() => test(getState()) && onDone()));
  if (action === 'click') on('click', inTarget);
  else if (action === 'doubleclick') on('dblclick', inTarget);
  else if (action === 'contextmenu') {
    on('contextmenu', inTarget);
    let had = !!s0.menu;
    watch((s) => {
      const opened = !had && !!s.menu;
      had = !!s.menu;
      return opened;
    });
  } else if (action === 'type') {
    const file = fileOfStep(step.target);
    const before = file && s0.files[file] ? s0.files[file].content : null;
    watch((s) => file && s.files[file] && s.files[file].content !== before);
  } else if (action === 'compile_ok') watch((s) => s.compile.state === 'ok' && (s.compile.at || 0) > tour.stepAt);
  else if (action === 'object_created') {
    const n = s0.bench.objects.length;
    watch((s) => s.bench.objects.length > n);
  } else if (action === 'method_called') {
    const mark = s0.console.length ? s0.console[s0.console.length - 1].id : 0;
    watch((s) => s.console.some((l) => l.stream === 'call' && l.id > mark));
  } else if (action === 'tests_pass') watch((s) => (s.tests.ranAt || 0) > tour.stepAt && s.tests.summary && s.tests.summary.total > 0 && s.tests.summary.passed === s.tests.summary.total);
  else if (action === 'main_finished') {
    let ran = s0.bench.state === 'running' || s0.bench.state === 'waiting';
    watch((s) => {
      const running = s.bench.state === 'running' || s.bench.state === 'waiting';
      if (running) ran = true;
      return ran && !running;
    });
  }
  let done = false;
  const once = onDone;
  onDone = () => {
    if (done) return;
    done = true;
    once();
  };
  return () => offs.forEach((f) => f());
}

/** Scrolls a target into view inside its own list (never the diagram, which pans by itself). */
function scrollIntoList(el, block) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (p.classList.contains('diagram') || p.classList.contains('monaco-editor')) return;
    const st = getComputedStyle(p);
    if (/(auto|scroll)/.test(st.overflowY + st.overflowX) && (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)) {
      el.scrollIntoView({ block, inline: 'nearest' });
      return;
    }
  }
}

const same = (a, b) => (!a && !b) || (a && b && Math.round(a.left) === Math.round(b.left) && Math.round(a.top) === Math.round(b.top) && Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height));
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * The tutorial overlay: a ring around the element the tutor points at, a small tag ("Hier klicken")
 * and the step's text beside it. The ring never covers the target, so the student clicks the real thing.
 */
export default function Tour() {
  const t = useT();
  const tour = useStore((s) => s.tour);
  const overlayOpen = useStore((s) => !!s.menu || !!s.dialog || !!s.palette);
  const [geo, setGeo] = useState(null); // { rect, radius, el }
  const [missing, setMissing] = useState(false);
  const [glide, setGlide] = useState(false);
  const [size, setSize] = useState({ w: 288, h: 92 });
  const calloutRef = useRef(null);
  const step = tour ? tour.steps[tour.index] : null;
  const key = tour ? `${tour.id}:${tour.index}` : '';

  // Follows the target every frame (panning, scrolling, resizing), only while a tour runs.
  useEffect(() => {
    if (!tour) {
      setGeo(null);
      return undefined;
    }
    setMissing(false);
    setGlide(true);
    const glideTimer = setTimeout(() => setGlide(false), 220);
    const started = Date.now();
    let frame = 0;
    let last = null;
    let scrolled = false;
    let radius = null;
    const tick = () => {
      const rect = rectOf(step.target);
      const el = resolve(step.target);
      if (rect && !scrolled && el) {
        scrolled = true;
        scrollIntoList(el, (parseTarget(step.target) || {}).kind === 'settings' ? 'center' : 'nearest');
      }
      if (rect && radius == null) {
        const r = el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 : 4;
        radius = r >= 999 ? 999 : r + 4;
      }
      if (!same(rect, last)) {
        last = rect;
        setGeo(rect ? { rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }, radius: radius ?? 12 } : null);
      }
      if (!rect && Date.now() - started > MISSING_MS) setMissing(true);
      else if (rect) setMissing(false);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(glideTimer);
    };
  }, [key]);

  // Auto-advance once the student did what the step asks.
  useEffect(() => {
    if (!tour || tour.mode !== 'tour') return undefined;
    const el = resolve(step.target);
    const action = actionOf(step, el);
    if (action === 'next') return undefined;
    const id = tour.id;
    const index = tour.index;
    return watchStep(tour, action, () => {
      const now = getState().tour;
      if (now && now.id === id && now.index === index) A.tourNext();
    });
  }, [key, !!geo]);

  // A point ends when the student clicks the spot.
  useEffect(() => {
    if (!tour || tour.mode !== 'point') return undefined;
    const id = tour.id;
    const h = (e) => {
      const el = resolve(step.target);
      if (el && el.contains(e.target) && getState().tour && getState().tour.id === id) setTimeout(() => A.endTour('done'), 120);
    };
    document.addEventListener('click', h, true);
    return () => document.removeEventListener('click', h, true);
  }, [key]);

  useLayoutEffect(() => {
    const el = calloutRef.current;
    if (el && (el.offsetWidth !== size.w || el.offsetHeight !== size.h)) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  });

  if (!tour || !step) return null;
  const el = geo ? resolve(step.target) : null;
  const action = actionOf(step, el);
  const isPoint = tour.mode === 'point';
  const last = tour.index === tour.steps.length - 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // 6px out: the ring never lies on a selection border (a selected class or object card).
  const ring = geo && { left: geo.rect.left - 6, top: geo.rect.top - 6, width: geo.rect.width + 12, height: geo.rect.height + 12 };
  if (ring) Object.assign(ring, { right: ring.left + ring.width, bottom: ring.top + ring.height });

  // In a menu the open menu already says where to look: no tag over the cards behind it.
  const inMenu = !!(el && el.closest('.menu'));
  let tagText = null;
  if (!isPoint && ring && !inMenu) {
    if (action === 'contextmenu') tagText = t('tour.rightClick');
    else if (action === 'doubleclick') tagText = t('tour.doubleClick');
    else if (action !== 'type' && action !== 'next' && el && el.matches(CLICKABLE)) tagText = t('tour.clickHere');
  }
  // A target in the title bar: the tag sits on the ring's lower edge and the callout goes below the
  // panels' header rows, so neither covers a panel's tabs or its close button.
  const bar = el && el.closest('.titlebar');
  const tagBelow = ring && ring.top < 32 + 6;
  const tagW = tagText ? tagText.length * 7 + 18 : 0;
  const tag = tagText && ring ? { left: Math.max(12, Math.min(vw - tagW - 12, ring.left + ring.width / 2 - tagW / 2)), top: bar ? ring.bottom - 11 : tagBelow ? ring.bottom + 6 : ring.top - 6 - 22 } : null;

  // The callout goes on the side with room (below, right, left, above), never over the target.
  let pos = { left: Math.round(vw / 2 - size.w / 2), top: 64 };
  if (ring && !missing) {
    const gap = 10;
    // A target in a menu or dialog: the callout goes beside the whole menu, not over its other items.
    const holder = el && el.closest('.menu, .dialog');
    const hb = holder && holder.getBoundingClientRect();
    const area = hb ? { left: Math.min(ring.left, hb.left), top: Math.min(ring.top, hb.top), right: Math.max(ring.right, hb.right), bottom: Math.max(ring.bottom, hb.bottom) } : ring;
    const clampX = (x) => Math.max(12, Math.min(vw - size.w - 12, x));
    const clampY = (y) => Math.max(12, Math.min(vh - size.h - 12, y));
    const tagSide = tag ? (tagBelow ? 'below' : 'above') : null;
    const sides = [
      ['below', () => ({ left: clampX(ring.left + ring.width / 2 - size.w / 2), top: area.bottom + gap + (tagSide === 'below' ? 28 : 0) }), () => vh - area.bottom - gap >= size.h + 12],
      ['right', () => ({ left: area.right + gap, top: clampY(ring.top + ring.height / 2 - size.h / 2) }), () => vw - area.right - gap >= size.w + 12],
      ['left', () => ({ left: area.left - gap - size.w, top: clampY(ring.top + ring.height / 2 - size.h / 2) }), () => area.left - gap >= size.w + 12],
      ['above', () => ({ left: clampX(ring.left + ring.width / 2 - size.w / 2), top: area.top - gap - size.h - (tagSide === 'above' ? 28 : 0) }), () => area.top - gap >= size.h + 12],
    ];
    const tagBox = tag ? { left: tag.left, top: tag.top, right: tag.left + tagW, bottom: tag.top + 22 } : null;
    let chosen = null;
    for (const [name, at, fits] of sides) {
      if (name === tagSide && sides.some(([n, , f]) => n !== tagSide && f())) continue;
      if (!fits()) continue;
      const p = at();
      const box = { left: p.left, top: p.top, right: p.left + size.w, bottom: p.top + size.h };
      if (intersects(box, area) || (tagBox && intersects(box, tagBox))) continue;
      chosen = p;
      break;
    }
    pos = chosen || { left: clampX(ring.left + ring.width / 2 - size.w / 2), top: clampY(ring.bottom + gap) };
    if (bar) {
      const below = bar.getBoundingClientRect().bottom;
      const heads = [...document.querySelectorAll('.panel-head')].map((h) => h.getBoundingClientRect()).filter((r) => r.height && r.top < below + 24);
      // Under the target and to its left, below the header rows.
      pos = { left: clampX(ring.right - size.w), top: clampY(Math.max(below, tagBox ? tagBox.bottom : 0, ...heads.map((r) => r.bottom)) + gap) };
    }
  }

  const inDrawer = el && el.closest('.side-drawer');
  // A menu or dialog the step points into keeps the dim; one opened for something else does not.
  const dim = !isPoint && ring && !inDrawer && (!overlayOpen || !!(el && el.closest('.menu, .dialog')));
  const primaryNext = action === 'next' || missing;

  return (
    <div className="tour-layer">
      {ring && (
        <div
          className={'tour-ring' + (dim ? ' dim' : '') + (glide ? ' glide' : '')}
          style={{ transform: `translate(${Math.round(ring.left)}px, ${Math.round(ring.top)}px)`, width: Math.round(ring.width), height: Math.round(ring.height), borderRadius: geo.radius + 2 }}
        >
          {/* Once per step, the halo widens and settles twice, so the eye finds a small target. */}
          <span className="tour-pulse" key={'p' + key} />
        </div>
      )}
      {tag && <div className="tour-tag" key={'tag' + key} style={{ left: Math.round(tag.left), top: Math.round(tag.top) }}>{tagText}</div>}
      {(ring || missing) && (
        <div
          ref={calloutRef}
          key={'c' + key}
          className={'tour-callout' + (isPoint ? ' point' : '')}
          role="dialog"
          aria-live="polite"
          aria-label={t('tour.aria')}
          style={{ left: Math.round(pos.left), top: Math.round(pos.top) }}
        >
          <p className="tour-text">{inline(step.text)}</p>
          {missing && <p className="tour-missing">{t('tour.missing')}</p>}
          {isPoint ? (
            <button className="icon-btn" aria-label={t('tour.close')} title={t('tour.close')} onClick={() => A.endTour('closed')}>
              <Icon name="close" />
            </button>
          ) : (
            <div className="tour-foot">
              <span className="tour-count">{t('tour.count', { i: tour.index + 1, n: tour.steps.length })}</span>
              {tour.index > 0 && <button className="btn btn-sm btn-quiet" onClick={A.tourBack}>{t('tour.back')}</button>}
              <button className={'btn btn-sm ' + (primaryNext ? 'btn-primary' : 'btn-quiet')} onClick={A.tourNext}>{last ? t('tour.done') : t('tour.next')}</button>
              <button className="icon-btn" aria-label={t('tour.close')} title={t('tour.close')} onClick={() => A.endTour('closed')}>
                <Icon name="close" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
