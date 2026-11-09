import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, setState, getState } from '../store.js';
import { useT, formatKeys } from '../i18n.js';
import * as A from '../actions.js';
import { childPackages, simpleName, flowLayout, layoutScore, routeDiagram, diagramEdges, arrowHead } from '../model.js';
import { signature } from '../lib/javaParse.js';
import Icon from './Icon.jsx';
import '../styles/diagram.css';

const VIS = { public: '+', private: '−', protected: '#', package: '~' };
const MAX_MEMBERS = 7;
const SNAP = 8;
// The smallest zoom the automatic fit uses: below it card text drops under 11px. When even the
// compact cards do not fit at this zoom, the canvas pans instead of shrinking them further.
const MIN_K = 0.9;
// Cards keep their member lists down to this zoom; a tall panel is better used for them than
// left empty below compact cards.
const FULL_K = 0.85;
// The row gap of cards without member lists, and the tighter one used before the canvas has to pan.
const ROW_GAP = 44;
const TIGHT_GAP = 32;

// Zoom limits for the wheel and the buttons.
const K_MIN = 0.25;
const K_MAX = 2;
const clampK = (k) => Math.min(K_MAX, Math.max(K_MIN, k));
const reducedMotion = () => !!document.documentElement.dataset.smoke || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The view that shows the same diagram point under (mx, my) at zoom k. */
const zoomAround = (v, mx, my, k) => ({ k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k });

const num = (v) => Math.round(v * 100) / 100;
const ptsAttr = (pts) => pts.map((p) => num(p.x) + ',' + num(p.y)).join(' ');

/** A path through points with its corners rounded. */
function roundedPath(pts, r = 6) {
  let d = `M${num(pts[0].x)} ${num(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const n = pts[i + 1];
    const k = Math.min(r, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const u = (q) => {
      const l = Math.hypot(q.x - c.x, q.y - c.y) || 1;
      return { x: c.x + ((q.x - c.x) / l) * k, y: c.y + ((q.y - c.y) / l) * k };
    };
    const a = u(p);
    const b = u(n);
    d += ` L${num(a.x)} ${num(a.y)} Q${num(c.x)} ${num(c.y)} ${num(b.x)} ${num(b.y)}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${num(last.x)} ${num(last.y)}`;
}

const lineClass = (kind) => 'line' + (kind === 'uses' ? ' uses' : kind === 'impl' ? ' impl' : '');

/**
 * The relations as UML draws them (model.js routeDiagram does the geometry): "extends" a solid line,
 * "implements" a dashed one, both ending in a hollow triangle on the supertype; "uses" a lighter
 * dashed line with an open head on the class that is used. Every group carries what it stands for
 * (data-from, data-to, data-kind) and every head its tip, so the smoke test can measure them.
 * While a card is pointed at, its own relations are drawn strong and the others step back; for a
 * subclass that is the way up through its tree.
 */
const Relations = memo(function Relations({ routes, active }) {
  const mark = (on) => (!active ? '' : on ? ' hl' : ' dim');
  return (
    <>
      {routes.trees.map((t) => {
        const kid = active && active !== t.to && t.kids.includes(active) ? active : null;
        return (
          <g key={t.id} className={'rel tree ' + t.kind + (kid ? ' part' : mark(active === t.to))} data-kind={t.kind} data-to={t.to} data-from={t.kids.join(' ')}>
            {t.paths.map((p, i) => <path key={i} className={lineClass(t.kind)} d={roundedPath(p)} data-pts={ptsAttr(p)} />)}
            {kid && <path className={lineClass(t.kind) + ' trace'} d={roundedPath(t.routes[kid])} />}
            <path className={'head tri' + (kid ? ' lit' : '')} d={t.head.d} data-tip={num(t.head.tip.x) + ' ' + num(t.head.tip.y)} />
          </g>
        );
      })}
      {routes.lines.map((l) => (
        <g key={l.from + '>' + l.to + '>' + l.kind} className={'rel ' + l.kind + mark(active === l.from || active === l.to)} data-kind={l.kind} data-from={l.from} data-to={l.to}>
          <path className={lineClass(l.kind)} d={roundedPath(l.line)} data-pts={ptsAttr(l.pts)} />
          <path className={'head ' + l.head.type} d={l.head.d} data-tip={num(l.head.tip.x) + ' ' + num(l.head.tip.y)} />
        </g>
      ))}
    </>
  );
});

/** The legend's sample of one kind of relation: drawn by the same code and at the same size as the
    arrows in the diagram at 100%. */
function Glyph({ kind }) {
  const h = arrowHead([{ x: 1, y: 8 }, { x: 31, y: 8 }], kind === 'uses' ? 'open' : 'tri');
  return (
    <svg className={'rel glyph ' + kind} width="32" height="16" viewBox="0 0 32 16" aria-hidden="true">
      <path className={lineClass(kind)} d={roundedPath(h.line)} />
      <path className={'head ' + h.type} d={h.d} />
    </svg>
  );
}

function Members({ info }) {
  const methods = [...info.ctors.map((c) => ({ ...c, ctor: true })), ...info.methods];
  const row = (m, i, isField) => {
    const text = isField ? `${m.name}: ${m.type}` : `${signature(m, false)}${m.ctor ? '' : ': ' + m.returnType}`;
    return (
      <button
        key={i}
        className={'member' + (m.static ? ' static' : '') + (m.abstract ? ' abstract' : '') + (m.visibility === 'private' ? ' priv' : '')}
        title={(m.doc && m.doc.text) || text}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          A.openClass(info.fileClass, m.line);
        }}
      >
        <span className="vis">{VIS[m.visibility] || '~'}</span>
        <span className="member-text">{text}</span>
      </button>
    );
  };
  const list = (items, isField) => (
    <>
      {items.slice(0, MAX_MEMBERS).map((m, i) => row(m, i, isField))}
      {items.length > MAX_MEMBERS && <div className="member-more">+ {items.length - MAX_MEMBERS}</div>}
    </>
  );
  if (info.kind === 'enum') {
    return info.constants.length ? <div className="class-members">{info.constants.slice(0, MAX_MEMBERS).map((c) => <div key={c} className="member enum-const">{c}</div>)}</div> : null;
  }
  return (
    <>
      {info.fields.length > 0 && <div className="class-members">{list(info.fields, true)}</div>}
      {methods.length > 0 && <div className="class-members">{list(methods, false)}</div>}
    </>
  );
}

async function classMenu(cls, x, y, t) {
  const s = getState();
  const info = A.modelOf(s.files).byName[cls];
  const compiled = s.compile.state === 'ok' && !A.isStale(A.fileOfClass(cls)) && s.bench.state !== 'off';
  const items = [];
  const simple = simpleName(cls);
  if (compiled) {
    const desc = await A.describe(cls);
    if (desc) {
      if (desc.kind === 'abstract') items.push({ type: 'note', text: t('menu.abstractNote') });
      else if (desc.kind === 'interface') items.push({ type: 'note', text: t('menu.interfaceNote') });
      else if (desc.kind === 'class') {
        if (!desc.constructors.length) items.push({ type: 'note', text: t('menu.noCtor') });
        for (const [i, c] of desc.constructors.entries()) {
          items.push({ tour: i === 0 ? 'new' : 'new:' + i, label: <span className="sig">new {simple}({c.params.map((p) => `${p.type} ${p.name}`).join(', ')})</span>, onClick: () => A.openDialogBox({ type: 'call', kind: 'new', cls, method: c }) });
        }
      }
      const statics = desc.methods.filter((m) => m.static && !(m.name === 'main' && m.params.length === 1) && m.declaringClass === desc.name);
      if (statics.length) items.push({ type: 'sep' });
      for (const m of statics) {
        items.push({ tour: 'static:' + m.name, label: <span className="sig"><span className="ret">static {m.returnType} </span>{m.name}({m.params.map((p) => `${p.type} ${p.name}`).join(', ')})</span>, onClick: () => A.openDialogBox({ type: 'call', kind: 'static', cls, method: m }) });
      }
      items.push({ type: 'sep' });
      if (info && info.hasMain) {
        items.push({ label: t('menu.runMain'), tour: 'runMain', icon: 'play', onClick: () => A.runMain(cls) });
        items.push({ label: t('menu.runMainArgs'), tour: 'runMainArgs', icon: 'play', onClick: () => A.openDialogBox({ type: 'call', kind: 'main', cls, method: { key: 'main', name: 'main', static: true, returnType: 'void', params: [{ name: 'args', type: 'String[]', category: 'array' }] } }) });
      }
      if (info && info.isTest) {
        items.push({ label: t('menu.runTests'), tour: 'runTests', icon: 'flask', onClick: () => A.runTests({ className: cls }) });
        items.push({ label: t('menu.record'), tour: 'record', icon: 'record', onClick: () => A.openDialogBox({ type: 'record', cls }) });
      }
      if (info && info.isTest && !s.project.readOnly) {
        items.push({ label: t('fixture.toBench'), tour: 'fixtureToBench', icon: 'insert', onClick: () => A.fixtureToBench(cls) });
        items.push({ label: t('fixture.fromBench'), tour: 'benchToFixture', icon: 'save', disabled: !s.bench.objects.length, onClick: () => A.benchToFixture(cls) });
      }
      items.push({ label: t('menu.inspectClass'), tour: 'inspectClass', icon: 'eye', onClick: () => A.showInspector(cls, simple, true) });
    }
  } else {
    items.push({ label: t('menu.compileFirst'), disabled: true });
    items.push({ label: t('menu.compileNow'), tour: 'compileNow', icon: 'build', onClick: A.compile });
  }
  items.push({ type: 'sep' });
  items.push({ label: t('menu.open'), tour: 'open', icon: 'file', onClick: () => A.openClass(cls) });
  if (info && !info.isTest && info.kind !== 'interface' && !s.project.readOnly) items.push({ label: t('menu.createTest'), tour: 'createTest', icon: 'flask', onClick: () => A.newClass(simple + 'Test', 'test') });
  if (!s.settings.aiOff) items.push({ label: t('menu.explain'), tour: 'explain', icon: 'tutor', onClick: () => { A.openClass(cls); setTimeout(() => A.askTutor(t('tutor.prompt.explainClass', { name: simple })), 50); } });
  if (!s.project.readOnly) {
    items.push({ type: 'sep' });
    const model = A.modelOf(s.files);
    for (const p of (info && info.parents) || []) {
      const parent = model.byName[p];
      if (parent) items.push({ label: t('relation.remove', { rel: parent.kind === 'interface' && info.kind !== 'interface' ? 'implements' : 'extends', name: parent.simple }), icon: 'close', onClick: () => A.removeRelation(cls, p) });
    }
    items.push({ label: t('menu.delete'), tour: 'delete', icon: 'trash', danger: true, onClick: () => A.openDialogBox({ type: 'delete', cls }) });
  }
  A.openMenu({ x, y, items });
}

async function quickNew(cls, t, anchor) {
  const desc = await A.describe(cls);
  if (!desc || desc.kind !== 'class' || !desc.constructors.length) return classMenu(cls, anchor.left, anchor.bottom + 4, t);
  if (desc.constructors.length === 1) return A.openDialogBox({ type: 'call', kind: 'new', cls, method: desc.constructors[0] });
  return classMenu(cls, anchor.left, anchor.bottom + 4, t);
}

export default function Diagram({ model }) {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const positions = useStore((s) => s.positions);
  const compile = useStore((s) => s.compile);
  const files = useStore((s) => s.files);
  const objects = useStore((s) => s.bench.objects);
  const benchState = useStore((s) => s.bench.state);
  const details = useStore((s) => s.settings.diagramDetails);
  const selected = useStore((s) => s.selectedClass);
  const highlight = useStore((s) => s.highlightClass);
  const pkg = useStore((s) => s.pkg);
  const extraPackages = useStore((s) => s.extraPackages || []);
  const readme = useStore((s) => s.readme);
  const tests = useStore((s) => s.tests);
  const projectDir = useStore((s) => s.project.dir);
  const readOnly = useStore((s) => s.project.readOnly);
  const showUses = useStore((s) => s.settings.showUses !== false);
  const arrangedAt = useStore((s) => s.arrangedAt);
  const hostRef = useRef(null);
  const cardRefs = useRef({});
  const noteRef = useRef(null);
  const [sizes, setSizes] = useState({});
  const [noteSize, setNoteSize] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  // The view as of the last change, ahead of React's render: pointer and wheel events that arrive
  // between two renders build on it, so no movement is lost.
  const live = useRef(view);
  const put = (v) => {
    live.current = v;
    setView(v);
  };
  // Zooming glides (180 ms, ease-out) unless the user asked for less motion; the wheel keeps
  // retargeting the glide, so a burst of wheel steps or a pinch reads as one smooth zoom.
  const anim = useRef({ raf: 0, to: null });
  const stopGlide = () => {
    cancelAnimationFrame(anim.current.raf);
    anim.current.to = null;
  };
  const glide = (to) => {
    stopGlide();
    if (reducedMotion()) {
      put(to);
      return;
    }
    const from = live.current;
    const t0 = performance.now();
    anim.current.to = to;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 180);
      const e = 1 - (1 - p) ** 3;
      put(p >= 1 ? to : { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (p < 1) anim.current.raf = requestAnimationFrame(tick);
      else anim.current.to = null;
    };
    anim.current.raf = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(anim.current.raf), []);
  // The grid moves with the canvas; below 50% zoom it steps up so it never turns into a mesh.
  const gridStep = 24 * view.k * (view.k < 0.5 ? 4 : 1);
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState(null);
  // The card under the pointer (its relations are drawn strong), the cards picked together (Shift-
  // drag a rectangle, Ctrl-click), the rectangle while it is drawn, and Space held for panning.
  const [hover, setHover] = useState(null);
  const [multi, setMulti] = useState([]);
  const [band, setBand] = useState(null);
  const [space, setSpace] = useState(false);
  const spaceRef = useRef(false);
  const overRef = useRef(false);
  useEffect(() => {
    setMulti([]);
    setHover(null);
  }, [projectDir, pkg]);
  useEffect(() => {
    // Space types or presses a button anywhere else; over the diagram (and with the focus on it or
    // on one of its own buttons) it pans.
    const typing = (el) => {
      if (!el || el.nodeType !== 1) return false;
      if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest('.monaco-editor')) return true;
      const own = hostRef.current && hostRef.current.closest('.panel');
      return el.tagName === 'BUTTON' && !(own && own.contains(el));
    };
    const down = (e) => {
      if (e.code !== 'Space' || e.ctrlKey || e.altKey || e.metaKey) return;
      if (!spaceRef.current && (!overRef.current || typing(document.activeElement) || typing(e.target))) return;
      e.preventDefault();
      if (!spaceRef.current) {
        spaceRef.current = true;
        setSpace(true);
      }
    };
    const up = (e) => {
      if (e.code !== 'Space' || !spaceRef.current) return;
      e.preventDefault();
      spaceRef.current = false;
      setSpace(false);
    };
    const reset = () => {
      spaceRef.current = false;
      setSpace(false);
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', reset);
    };
  }, []);
  // The width (in diagram units) the flow layout packs into and its row gap, set by fit().
  const [flowAt, setFlowAt] = useState(null);
  const [compact, setCompact] = useState(false);
  // BlueJ's "inherits" arrow: pick the subclass, then the superclass or interface.
  const [linking, setLinking] = useState(null);
  const [linkAt, setLinkAt] = useState(null);
  useEffect(() => {
    if (!linking) return undefined;
    const key = (e) => e.key === 'Escape' && setLinking(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [linking]);
  // Card sizes with their member lists, kept while compact hides them.
  const fullSizes = useRef({});
  const fitted = useRef(null);

  const classes = model.list.filter((c) => c.pkg === pkg);
  const subPkgs = [...new Set([...childPackages(model, pkg), ...extraPackages.filter((p) => (pkg ? p.startsWith(pkg + '.') && !p.slice(pkg.length + 1).includes('.') : !p.includes('.')))])];
  const keys = [...subPkgs.map((p) => 'pkg:' + p), ...classes.map((c) => c.fileClass)];

  useLayoutEffect(() => {
    const next = {};
    let changed = false;
    for (const k of keys) {
      const el = cardRefs.current[k];
      if (!el) continue;
      next[k] = { w: el.offsetWidth, h: el.offsetHeight };
      if (!compact) fullSizes.current[k] = next[k];
      if (!sizes[k] || sizes[k].w !== next[k].w || sizes[k].h !== next[k].h) changed = true;
    }
    if (changed || Object.keys(next).length !== Object.keys(sizes).length) setSizes(next);
    // The README note or the "parent package" card: the lines keep clear of it as well.
    const n = noteRef.current;
    const ns = n ? { w: n.offsetWidth, h: n.offsetHeight } : null;
    if ((ns && ns.w) !== (noteSize && noteSize.w) || (ns && ns.h) !== (noteSize && noteSize.h)) setNoteSize(ns);
  });

  // Until the user drags a card in this package, the cards follow the diagram's own flow layout,
  // packed for the panel's width; after that the stored positions count.
  const manual = !!positions['#moved:' + pkg];
  const sizeOf = (sz) => (k) => sz[k] || { w: 200, h: 90 };
  // Cards without member lists are short, so their rows sit closer together.
  const gapY = (short) => (short ? ROW_GAP : 56);
  const flow = !manual && flowAt ? flowLayout(model, keys, sizeOf(sizes), flowAt.w, 40, flowAt.gap) : null;
  const pos = (k) => (flow && flow[k]) || positions[k] || { x: 32, y: 32 };
  // The README note (root) or the "parent package" card sits above the top-left of the content.
  const minX0 = keys.length ? Math.min(...keys.map((k) => pos(k).x)) : 32;
  const minY0 = keys.length ? Math.min(...keys.map((k) => pos(k).y)) : 32;
  const noteAt = { x: minX0, y: minY0 - 96 };
  const hasNote = (readme && !pkg) || !!pkg;
  const bbox = (at, size) => {
    const minX = Math.min(...keys.map((k) => at[k].x));
    const minCard = Math.min(...keys.map((k) => at[k].y));
    const minY = hasNote ? minCard - 96 : minCard;
    const w = Math.max(...keys.map((k) => at[k].x + size(k).w)) - minX;
    const h = Math.max(...keys.map((k) => at[k].y + size(k).h)) - minY;
    return { minX, minY, w, h };
  };
  /** Arrows of a layout that run through another card or cross each other. */
  const crossings = (at, size) => layoutScore(model, keys, at, size).hard;
  const panelBox = () => {
    const host = hostRef.current;
    return { cw: Math.max(120, host.clientWidth - 48), ch: Math.max(120, host.clientHeight - 24 - 56) };
  };
  /**
   * The box of a layout with its relation lines: a detour that runs around the outside of all
   * cards is part of the picture too (8 for the arrowheads), or its arrow would come in from the
   * panel's edge with no visible source.
   */
  const withLines = (b, at, size) => {
    const es = diagramEdges(model, new Set(classes.map((c) => c.fileClass)), showUses);
    if (!es.length) return b;
    const rs = {};
    for (const k of keys) rs[k] = { ...at[k], ...size(k) };
    const pts = [];
    try {
      const r = routeDiagram(rs, es);
      for (const tr of r.trees) for (const p of Object.values(tr.routes || {})) pts.push(...p);
      for (const l of r.lines) pts.push(...(l.pts || []));
    } catch {
      return b;
    }
    if (!pts.length) return b;
    const minX = Math.min(b.minX, ...pts.map((p) => p.x - 8));
    const minY = Math.min(b.minY, ...pts.map((p) => p.y - 8));
    const maxX = Math.max(b.minX + b.w, ...pts.map((p) => p.x + 8));
    const maxY = Math.max(b.minY + b.h, ...pts.map((p) => p.y + 8));
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  };
  // Content taller than the panel starts at the top: the roots of the inheritance trees stay in
  // full view and the rows below scroll (cutting the top row through its cards looked broken).
  const viewFor = (b, k) => {
    const { cw } = panelBox();
    const x = b.w * k > cw ? 24 - b.minX * k : 24 + (cw - b.w * k) / 2 - b.minX * k;
    const y = 24 - b.minY * k;
    return { k, x: Math.round(x), y: Math.round(y) };
  };
  // Fits the content into the panel with 24px around it and a 56px band at the bottom for the
  // zoom tools, by width and by height. Small cards are hard to read, so the flow layout first
  // repacks the cards for the panel's width; if that is not enough the cards drop their member
  // lists (compact) for as long as the full cards would not fit at 85%, and compact cards are
  // never fitted below 90%: their rows move closer together first, then the canvas pans.
  const moved = useRef(false);
  // "Show all" (the button, Ctrl+0) really shows everything, smaller if need be; the automatic fit
  // keeps cards readable and pans instead. The choice holds until another project or package.
  const fitAll = useRef(false);
  const fit = (opts = {}) => {
    const host = hostRef.current;
    if (!host || !keys.length) return;
    moved.current = false;
    if (opts.all) fitAll.current = true;
    const { cw, ch } = panelBox();
    const scale = (b) => Math.min(1, cw / b.w, ch / b.h);
    const plan = (sz, c) => {
      const size = sizeOf(sz);
      if (manual) {
        const at = Object.fromEntries(keys.map((k) => [k, positions[k] || { x: 32, y: 32 }]));
        const b = bbox(at, size);
        return { w: null, b, k: scale(b), at };
      }
      const short = c || !details;
      const floor = short ? MIN_K : FULL_K;
      const pack = (gap) => [1, 0.95, MIN_K, FULL_K].map((t) => {
        const w = Math.floor(cw / t);
        const at = flowLayout(model, keys, size, w, 40, gap);
        const b = bbox(at, size);
        return { w, gap, b, k: scale(b), crossed: crossings(at, size), at };
      });
      let cands = pack(gapY(short));
      if (short && !cands.some((x) => x.k >= floor)) cands = cands.concat(pack(TIGHT_GAP));
      // A packing whose inheritance arrows run through other cards reads wrong (Katze would seem
      // to extend Hund): among the readable ones the fewest crossings win, then the zoom; at
      // (almost) the same zoom the wider packing.
      const readable = cands.filter((x) => x.k >= floor);
      const pool = readable.length ? readable.filter((x) => x.crossed === Math.min(...readable.map((y) => y.crossed))) : cands;
      const top = Math.max(...pool.map((x) => x.k));
      return pool.filter((x) => x.k >= top - 0.02).pop();
    };
    if (details) {
      if (compact && keys.some((k) => !fullSizes.current[k])) {
        setCompact(false);
        return;
      }
      const full = plan(compact ? fullSizes.current : sizes, false);
      const want = full.k < FULL_K;
      if (want !== compact) {
        setCompact(want);
        return;
      }
    } else if (compact) {
      setCompact(false);
      return;
    }
    const p = plan(sizes, compact);
    if (!manual) setFlowAt({ w: p.w, gap: p.gap });
    // The lines count too: a detour around all cards stays in view.
    const lb = withLines(p.b, p.at, sizeOf(sizes));
    const k = Math.min(p.k, scale(lb));
    // Full cards are never fitted below FULL_K (they turn compact first); compact ones stop at MIN_K.
    const target = viewFor(lb, fitAll.current ? Math.max(0.3, k) : Math.max(compact || !details ? MIN_K : 0.3, k));
    if (opts.animate) glide(target);
    else {
      stopGlide();
      put(target);
    }
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;
  // Until the user pans or zooms, the diagram keeps fitting the panel when it changes size
  // (splitters, window size, the side panel turning into a drawer).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let last = { w: host.clientWidth, h: host.clientHeight };
    let raf = 0;
    const ro = new ResizeObserver(() => {
      const now = { w: host.clientWidth, h: host.clientHeight };
      if (now.w === last.w && now.h === last.h) return;
      last = now;
      if (moved.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fitRef.current());
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  /** Saves the whole diagram as a PNG, e.g. for a project report: fitted, without the zoom tools. */
  const exportImage = () => captureDiagram((rect) => A.saveDiagramImage(rect));
  const printDiagram = () => captureDiagram((rect) => A.printDiagram(rect));
  /** Fits the whole diagram into the panel for a moment and hands its screen rectangle to `use`. */
  const captureDiagram = async (use) => {
    const host = hostRef.current;
    if (!host || !keys.length) return;
    stopGlide();
    const before = live.current;
    const wasMoved = moved.current;
    const wasMulti = multi;
    setState({ selectedClass: null, highlightClass: null });
    setHover(null);
    setMulti([]);
    const at = Object.fromEntries(keys.map((k) => [k, pos(k)]));
    // Cards and every routed line, with 16 more around: no line hugs the image's edge.
    const lb = withLines(bbox(at, sizeOf(sizes)), at, sizeOf(sizes));
    const content = { minX: lb.minX - 16, minY: lb.minY - 16, w: lb.w + 32, h: lb.h + 32 };
    const { cw, ch } = panelBox();
    put(viewFor(content, Math.max(0.3, Math.min(1, cw / content.w, ch / content.h))));
    host.classList.add('exporting');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 80));
    // Exactly the drawn content (cards and edges) plus 24px, clipped to the panel.
    const b = host.getBoundingClientRect();
    const parts = [...host.querySelectorAll('.world .dcard, .world .edges path')].map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
    const box = parts.length
      ? {
          left: Math.max(b.left, Math.min(...parts.map((r) => r.left)) - 24),
          top: Math.max(b.top, Math.min(...parts.map((r) => r.top)) - 24),
          right: Math.min(b.right, Math.max(...parts.map((r) => r.right)) + 24),
          bottom: Math.min(b.bottom, Math.max(...parts.map((r) => r.bottom)) + 24),
        }
      : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    try {
      await use({ x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top });
    } finally {
      host.classList.remove('exporting');
      put(before);
      setMulti(wasMulti);
      moved.current = wasMoved;
    }
  };

  /** A class added to a package the user has arranged goes into the first free spot of the
      existing rows that is on screen, never into a new column off to the right. */
  const freeSlot = (key, others, placed) => {
    const host = hostRef.current;
    const s = sizeOf(sizes)(key);
    const rs = others.map((k) => ({ ...(placed[k] || positions[k] || { x: 32, y: 32 }), ...sizeOf(sizes)(k) }));
    if (!rs.length) return { x: 32, y: 32 };
    const v = view;
    const onScreenX = (x) => x * v.k + v.x >= 0 && (x + s.w) * v.k + v.x <= host.clientWidth - 24;
    const onScreenY = (y) => y * v.k + v.y >= 0 && (y + s.h) * v.k + v.y <= host.clientHeight - 56;
    const clear = (x, y) => !rs.some((o) => x < o.x + o.w + 32 && x + s.w + 32 > o.x && y < o.y + o.h + 32 && y + s.h + 32 > o.y);
    const minX = Math.min(...rs.map((o) => o.x));
    const below = Math.max(...rs.map((o) => o.y + o.h)) + 56;
    const xs = [...new Set([minX, ...rs.map((o) => o.x + o.w + 40)])].sort((a, b) => a - b);
    const cands = [];
    for (const y of [...new Set(rs.map((o) => o.y))].sort((a, b) => a - b).concat(below)) for (const x of xs) cands.push({ x, y });
    const hit = cands.find((c) => clear(c.x, c.y) && onScreenX(c.x) && onScreenY(c.y)) || cands.find((c) => clear(c.x, c.y) && onScreenX(c.x)) || { x: minX, y: below };
    return { x: Math.round(hit.x / SNAP) * SNAP, y: Math.round(hit.y / SNAP) * SNAP };
  };

  // Fit once every card of the opened project or package has been measured, and again whenever
  // cards are added, removed or change size while the user has not panned or zoomed.
  const fittedSig = useRef(null);
  const seenKeys = useRef([]);
  const pendingFit = useRef(false);
  useEffect(() => {
    const id = projectDir + '|' + pkg + '|' + (arrangedAt || 0);
    if (!keys.length || !keys.every((k) => sizes[k])) return;
    const sig = keys.map((k) => k + ':' + sizes[k].w + 'x' + sizes[k].h).join(',') + '|' + compact + '|' + details;
    if (fitted.current !== id) {
      fitted.current = id;
      fittedSig.current = sig;
      seenKeys.current = keys;
      fitAll.current = false;
      fit();
      return;
    }
    if (pendingFit.current) {
      pendingFit.current = false;
      fittedSig.current = sig;
      if (!moved.current) fit();
      return;
    }
    if (sig === fittedSig.current) return;
    fittedSig.current = sig;
    const added = keys.filter((k) => !seenKeys.current.includes(k));
    seenKeys.current = keys;
    if (manual && added.length && !readOnly) {
      const others = keys.filter((k) => !added.includes(k));
      const at = {};
      for (const k of added) {
        at[k] = freeSlot(k, others, at);
        others.push(k);
      }
      for (const k of added) A.setPosition(k, at[k]);
      pendingFit.current = true;
      return;
    }
    if (!moved.current) fit();
  });

  const objectsOf = {};
  for (const o of objects) if (o.className) (objectsOf[o.className] = objectsOf[o.className] || []).push(o.name);
  const errorCount = {};
  if (compile.state === 'errors') for (const p of compile.problems) if (p.severity === 'error') errorCount[p.file] = (errorCount[p.file] || 0) + 1;
  const testResult = {};
  for (const r of (tests && tests.results) || []) {
    const e = (testResult[r.className] = testResult[r.className] || { passed: 0, total: 0 });
    e.total++;
    if (r.status === 'passed') e.passed++;
  }

  const rects = {};
  for (const k of keys) rects[k] = { ...pos(k), w: sizes[k]?.w || 200, h: sizes[k]?.h || 80 };
  const visible = new Set(classes.map((c) => c.fileClass));
  const edges = diagramEdges(model, visible, showUses);
  // Routed again only when a card moves or changes size or a relation changes; panning, zooming
  // and hovering reuse the routes.
  const noteRect = hasNote && noteSize && keys.length ? { x: noteAt.x, y: noteAt.y, w: noteSize.w, h: noteSize.h } : null;
  const geo = JSON.stringify([keys.map((k) => [k, rects[k].x, rects[k].y, rects[k].w, rects[k].h]), edges.map((e) => e.from + '>' + e.to + '>' + e.kind), noteRect]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const routes = useMemo(() => routeDiagram(rects, edges, noteRect ? [noteRect] : []), [geo]);
  const rectsRef = useRef(rects);
  rectsRef.current = rects;
  // Hovering a card, or an object of it on the bench, shows its relations.
  const active = [hover, highlight].find((k) => k && visible.has(k)) || null;
  const related = new Set();
  if (active) for (const e of edges) if (e.from === active || e.to === active) related.add(e.from === active ? e.to : e.from);

  /** Arrow keys move the selection to the nearest class card in that direction. */
  const moveSelection = (from, key) => {
    const a = rects[from];
    if (!a) return;
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    let best = null;
    for (const c of classes) {
      if (c.fileClass === from) continue;
      const b = rects[c.fileClass];
      const dx = b.x + b.w / 2 - cx;
      const dy = b.y + b.h / 2 - cy;
      const along = key === 'ArrowRight' ? dx : key === 'ArrowLeft' ? -dx : key === 'ArrowDown' ? dy : -dy;
      const across = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 4) continue;
      const score = along + across * 2;
      if (!best || score < best.score) best = { score, cls: c.fileClass };
    }
    if (best) {
      setState({ selectedClass: best.cls });
      const el = cardRefs.current[best.cls];
      if (el) el.focus();
    }
  };
  const kinds = new Set(edges.map((e) => e.kind));

  // The tutor (or a tutorial) points at a card: pan just enough to bring it into view. This is not
  // the user moving the canvas, so fitting on resize keeps working.
  const revealCard = useStore((s) => s.revealCard);
  useEffect(() => {
    const host = hostRef.current;
    const r = revealCard && rects[revealCard.key];
    if (!host || !r || !sizes[revealCard.key]) return;
    const m = 24;
    const left = r.x * view.k + view.x;
    const top = r.y * view.k + view.y;
    const w = r.w * view.k;
    const h = r.h * view.k;
    let dx = 0;
    let dy = 0;
    if (left < m) dx = m - left;
    else if (left + w > host.clientWidth - m) dx = Math.max(m - left, host.clientWidth - m - (left + w));
    if (top < m) dy = m - top;
    else if (top + h > host.clientHeight - 56) dy = Math.max(m - top, host.clientHeight - 56 - (top + h));
    if (dx || dy) glide({ ...live.current, x: Math.round(live.current.x + dx), y: Math.round(live.current.y + dy) });
  }, [revealCard && revealCard.at, !!(revealCard && sizes[revealCard.key])]);

  // The wheel scrolls the canvas (Shift: sideways); Ctrl+wheel and a trackpad pinch zoom at the
  // pointer. A native listener, because React's wheel listener is passive and cannot keep the
  // page from zooming or scrolling as well.
  const onWheel = (e) => {
    const host = hostRef.current;
    if (!host || e.target.closest('.diagram-tools, .diagram-legend, .link-hint')) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    moved.current = true;
    if (e.ctrlKey || e.metaKey) {
      const b = host.getBoundingClientRect();
      const from = anim.current.to || live.current;
      // A mouse wheel notch (100) zooms by about 15%; a pinch sends many small steps.
      const f = Math.exp(-dy * (Math.abs(dy) < 40 ? 0.01 : 0.0015));
      glide(zoomAround(from, e.clientX - b.left, e.clientY - b.top, clampK(from.k * Math.min(1.3, Math.max(0.77, f)))));
      return;
    }
    if (e.shiftKey && !dx) {
      dx = dy;
      dy = 0;
    }
    stopGlide();
    const v = live.current;
    put({ ...v, x: v.x - dx, y: v.y - dy });
  };
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const fn = (e) => wheelRef.current(e);
    host.addEventListener('wheel', fn, { passive: false });
    return () => host.removeEventListener('wheel', fn);
  }, []);
  const zoomBy = (f) => {
    moved.current = true;
    const host = hostRef.current;
    const from = anim.current.to || live.current;
    glide(zoomAround(from, host.clientWidth / 2, host.clientHeight / 2, clampK(from.k * f)));
  };
  const zoomTo = (k) => {
    moved.current = true;
    const host = hostRef.current;
    glide(zoomAround(live.current, host.clientWidth / 2, host.clientHeight / 2, k));
  };

  const pickForLink = (cls) => {
    if (!linking.from) {
      setLinking({ from: cls });
      return;
    }
    if (cls !== linking.from) A.addRelation(linking.from, cls);
    setLinking(null);
    setLinkAt(null);
  };
  const trackLink = (e) => {
    if (!linking || !linking.from) return;
    const host = hostRef.current.getBoundingClientRect();
    const v = live.current;
    setLinkAt({ x: (e.clientX - host.left - v.x) / v.k, y: (e.clientY - host.top - v.y) / v.k });
  };

  /** Follows one pointer until it lets go: on the window, so it keeps working outside the panel,
      and captured where the platform allows it (a synthetic pointer cannot be captured). */
  const follow = (e, el, move, end) => {
    try {
      el.setPointerCapture(e.pointerId);
    } catch { /* synthetic pointer */ }
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch { /* synthetic pointer */ }
      end(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  };

  /** Drags the whole diagram: the empty canvas with the left button, anywhere with the middle
      button or with Space held. A click on the empty canvas (no movement) clears the selection. */
  const startPan = (e, clickClears) => {
    const host = hostRef.current;
    e.preventDefault();
    stopGlide();
    if (linking) {
      setLinking(null);
      setLinkAt(null);
    }
    if (document.activeElement !== host && !host.contains(document.activeElement)) host.focus({ preventScroll: true });
    let lx = e.clientX;
    let ly = e.clientY;
    let travel = 0;
    setPanning(true);
    document.documentElement.classList.add('diagram-panning');
    follow(e, host, (ev) => {
      const dx = ev.clientX - lx;
      const dy = ev.clientY - ly;
      lx = ev.clientX;
      ly = ev.clientY;
      if (!dx && !dy) return;
      travel += Math.abs(dx) + Math.abs(dy);
      moved.current = true;
      const v = live.current;
      put({ ...v, x: v.x + dx, y: v.y + dy });
    }, (ev) => {
      setPanning(false);
      document.documentElement.classList.remove('diagram-panning');
      if (clickClears && travel < 4 && ev.type === 'pointerup') {
        setState({ selectedClass: null });
        setMulti([]);
      }
    });
  };

  /** Shift+drag on the empty canvas: a rectangle picks every card it touches (added to the cards
      picked before). */
  const startBand = (e) => {
    const host = hostRef.current;
    e.preventDefault();
    stopGlide();
    const b = host.getBoundingClientRect();
    const x0 = e.clientX - b.left;
    const y0 = e.clientY - b.top;
    const before = [...new Set([...multi, ...(selected && keys.includes(selected) ? [selected] : [])])];
    setBand({ x0, y0, x1: x0, y1: y0 });
    document.documentElement.classList.add('diagram-banding');
    follow(e, host, (ev) => {
      const x1 = ev.clientX - b.left;
      const y1 = ev.clientY - b.top;
      setBand({ x0, y0, x1, y1 });
      const v = live.current;
      const r = { x: (Math.min(x0, x1) - v.x) / v.k, y: (Math.min(y0, y1) - v.y) / v.k, w: Math.abs(x1 - x0) / v.k, h: Math.abs(y1 - y0) / v.k };
      const hit = Object.entries(rectsRef.current).filter(([, c]) => c.x < r.x + r.w && c.x + c.w > r.x && c.y < r.y + r.h && c.y + c.h > r.y).map(([k]) => k);
      setMulti([...new Set([...before, ...hit])]);
    }, () => {
      setBand(null);
      document.documentElement.classList.remove('diagram-banding');
    });
  };

  const onCanvasDown = (e) => {
    if (e.target.closest('.dcard, button, .diagram-tools, .diagram-legend, .link-hint')) return;
    if (e.button !== 0) return;
    if (e.shiftKey && !linking) startBand(e);
    else startPan(e, true);
  };
  // Middle button or Space: panning wins over everything, even over a card.
  const onCanvasDownCapture = (e) => {
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.stopPropagation();
      startPan(e, false);
    }
  };

  /** Ctrl- or Shift-click adds a card to the picked ones or takes it out again. */
  const pick = (key, ev) => {
    if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) {
      const base = multi.length ? multi : selected && keys.includes(selected) ? [selected] : [];
      const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
      setMulti(next);
      // Focusing the card selected it on the way; taking it out again means it is not selected.
      if (!next.includes(key) && getState().selectedClass === key) setState({ selectedClass: null });
      return;
    }
    setMulti([]);
    if (!key.startsWith('pkg:')) setState({ selectedClass: key });
  };

  /** Drags a card, or all picked cards together when it is one of them. They snap to an 8px grid
      as a group, so they keep their places relative to each other. */
  const startDrag = (e, key, onClick) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    stopGlide();
    const group = multi.length > 1 && multi.includes(key) ? multi.filter((k) => keys.includes(k)) : [key];
    const start = { x: e.clientX, y: e.clientY };
    const origin = Object.fromEntries(group.map((k) => [k, { ...pos(k) }]));
    const k0 = live.current.k;
    const all = Object.fromEntries(keys.map((k) => [k, { ...pos(k) }]));
    let dragged = false;
    follow(e, e.currentTarget, (ev) => {
      const dx = (ev.clientX - start.x) / k0;
      const dy = (ev.clientY - start.y) / k0;
      if (!dragged && Math.abs(dx) + Math.abs(dy) < 4) return;
      // The first card the user moves pins the whole flow layout of this package as it is shown.
      if (!dragged && flow) A.pinLayout(pkg, all);
      dragged = true;
      setDragging(group);
      A.pinLayout(pkg, Object.fromEntries(group.map((k) => [k, { x: Math.round(origin[k].x + dx), y: Math.round(origin[k].y + dy) }])));
    }, () => {
      setDragging(null);
      if (dragged) {
        const p = getState().positions[key];
        const sx = Math.round(p.x / SNAP) * SNAP - p.x;
        const sy = Math.round(p.y / SNAP) * SNAP - p.y;
        A.pinLayout(pkg, Object.fromEntries(group.map((k) => {
          const q = getState().positions[k];
          return [k, { x: q.x + sx, y: q.y + sy }];
        })));
      } else if (onClick) onClick(e);
    });
  };

  const onCanvasKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      setMulti([]);
      setBand(null);
    } else if (mod && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      zoomBy(1.2);
    } else if (mod && e.key === '-') {
      e.preventDefault();
      zoomBy(1 / 1.2);
    } else if (mod && e.key === '0') {
      e.preventDefault();
      fit({ animate: true, all: true });
    } else if (mod && e.key.toLowerCase() === 'a' && keys.length) {
      e.preventDefault();
      setMulti([...keys]);
    }
  };

  /** Right-click on the empty canvas. */
  const canvasMenu = (e) => {
    if (e.target.closest('.dcard, .diagram-tools, .diagram-legend, .link-hint')) return;
    e.preventDefault();
    A.openMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('ws.newClass'), icon: 'plus', disabled: readOnly, onClick: () => A.openDialogBox({ type: 'newClass' }) },
        { label: t('diagram.newPackage'), icon: 'folderPlus', disabled: readOnly, onClick: () => A.openDialogBox({ type: 'newPackage' }) },
        { type: 'sep' },
        { label: t('diagram.fit'), icon: 'fit', disabled: !keys.length, onClick: () => fit({ animate: true, all: true }) },
        { label: t('diagram.arrange'), icon: 'arrange', disabled: readOnly || !keys.length, onClick: A.arrange },
        { label: t('diagram.saveImage'), icon: 'image', disabled: !keys.length, onClick: exportImage },
      ],
    });
  };

  const compiledOk = compile.state === 'ok' && benchState !== 'off';
  const showMembers = details && !compact;

  return (
    <section className="panel" aria-label={t('diagram.title')}>
      <div className="panel-head">
        <h2>{t('diagram.title')}</h2>
        {pkg && <span className="head-pkg">{pkg}</span>}
        <span className="grow" />
        {!readOnly && (
          <>
            <button className="icon-btn" data-tour="new-class" aria-label={t('ws.newClass')} title={t('ws.newClass') + ' · ' + formatKeys(lang, 'ctrl N', '+')} onClick={() => A.openDialogBox({ type: 'newClass' })}>
              <Icon name="plus" />
            </button>
            <button className="icon-btn" data-tour="new-package" aria-label={t('diagram.newPackage')} title={t('diagram.newPackage')} onClick={() => A.openDialogBox({ type: 'newPackage' })}>
              <Icon name="folderPlus" />
            </button>
            <button className="icon-btn" data-tour="new-arrow" aria-pressed={!!linking} aria-label={t('relation.draw')} title={t('relation.draw')} disabled={classes.length < 2} onClick={() => { setLinking(linking ? null : { from: null }); setLinkAt(null); }}>
              <Icon name="inherit" />
            </button>
          </>
        )}
        <button className="icon-btn" aria-pressed={details} aria-label={t('diagram.details')} title={t('diagram.details')} onClick={() => A.updateSettings({ diagramDetails: !details })}>
          <Icon name="details" />
        </button>
        <button className="icon-btn" aria-pressed={showUses} aria-label={t('diagram.showUses')} title={t('diagram.showUses')} onClick={() => A.updateSettings({ showUses: !showUses })}>
          <Icon name="uses" />
        </button>
        {!readOnly && (
          <button className="icon-btn" data-tour="arrange" aria-label={t('diagram.arrange')} title={t('diagram.arrange')} onClick={A.arrange}>
            <Icon name="arrange" />
          </button>
        )}
        <button
          className="icon-btn diagram-more"
          data-tour="diagram-more"
          aria-label={t('diagram.more')}
          title={t('diagram.more')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            A.openMenu({
              x: r.left,
              y: r.bottom + 4,
              items: [
                { label: t('addFiles.title'), icon: 'file', disabled: readOnly, onClick: () => A.addClassesFromFiles() },
                { label: t('lib.title'), icon: 'book', onClick: () => A.openDialogBox({ type: 'library' }) },
                { type: 'sep' },
                { label: t('diagram.saveImage'), icon: 'image', disabled: !keys.length, onClick: exportImage },
                { label: t('print.diagram'), icon: 'printer', disabled: !keys.length, onClick: printDiagram },
                { label: t('javadoc.title'), icon: 'book', disabled: !model.list.length, onClick: A.generateJavadoc },
                { type: 'sep' },
                { label: t('saveAs.title'), icon: 'save', onClick: () => A.saveProjectAs() },
                { label: t('zip.export'), icon: 'save', onClick: () => A.exportZip() },
                { label: t('jar.title'), icon: 'save', onClick: () => A.openDialogBox({ type: 'jar' }) },
                { type: 'sep' },
                { label: t('ws.reveal'), icon: 'folderOpen', onClick: () => window.blackj.project.reveal() },
              ],
            });
          }}
        >
          <Icon name="more" />
        </button>
      </div>
      <div
        className={'diagram' + (panning ? ' panning' : '') + (space ? ' space' : '') + (compact ? ' compact' : '') + (linking ? ' linking' : '') + (active ? ' focusing' : '')}
        data-tour="diagram"
        ref={hostRef}
        tabIndex={-1}
        onPointerDownCapture={onCanvasDownCapture}
        onPointerDown={onCanvasDown}
        onPointerMove={(e) => {
          overRef.current = true;
          trackLink(e);
        }}
        onPointerLeave={() => {
          overRef.current = false;
        }}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onContextMenu={canvasMenu}
        onKeyDown={onCanvasKey}
        style={{ backgroundSize: `${gridStep}px ${gridStep}px`, backgroundPosition: `${Math.round(view.x)}px ${Math.round(view.y)}px` }}
      >
        {keys.length === 0 && !pkg ? (
          <div className="diagram-empty">
            <span>{t('diagram.empty')}</span>
            <button className="btn btn-sm" onClick={() => A.openDialogBox({ type: 'newClass' })}>
              <Icon name="plus" />
              {t('diagram.emptyAction')}
            </button>
          </div>
        ) : (
          // Whole pixels for the shift, so lines and text stay sharp at 100%.
          <div className="world" style={{ transform: `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px) scale(${view.k})` }}>
            <svg className="edges" width="1" height="1">
              <Relations routes={routes} active={active} />
              {linking && linking.from && linkAt && rects[linking.from] && (
                <path className="link-preview" d={`M${rects[linking.from].x + rects[linking.from].w / 2},${rects[linking.from].y + rects[linking.from].h / 2}L${linkAt.x},${linkAt.y}`} />
              )}
            </svg>

            {readme && !pkg && (
              <div ref={noteRef} className="dcard note-card" data-tour="readme" style={{ left: noteAt.x, top: noteAt.y }} onDoubleClick={A.openReadme} onClick={A.openReadme} role="button" tabIndex={0} title={readme.name}>
                <Icon name="file" />
                <span>{readme.name}</span>
              </div>
            )}

            {pkg && (
              <div ref={noteRef} className="dcard pkg-card up" style={{ left: noteAt.x, top: noteAt.y }} onDoubleClick={() => A.enterPackage(pkg.includes('.') ? pkg.slice(0, pkg.lastIndexOf('.')) : '')} onClick={() => A.enterPackage(pkg.includes('.') ? pkg.slice(0, pkg.lastIndexOf('.')) : '')} role="button" tabIndex={0}>
                <span className="pkg-tab" />
                <span className="pkg-name">{t('diagram.up')}</span>
              </div>
            )}

            {subPkgs.map((p) => {
              const k = 'pkg:' + p;
              const count = model.list.filter((c) => c.pkg === p || c.pkg.startsWith(p + '.')).length;
              return (
                <div
                  key={k}
                  ref={(el) => { cardRefs.current[k] = el; }}
                  className={'dcard pkg-card' + (dragging && dragging.includes(k) ? ' dragging' : '') + (multi.includes(k) ? ' selected' : '')}
                  data-tour={'package:' + p}
                  style={{ left: pos(k).x, top: pos(k).y }}
                  onPointerDown={(e) => startDrag(e, k, (ev) => (ev.ctrlKey || ev.metaKey || ev.shiftKey) && pick(k, ev))}
                  onDoubleClick={() => A.enterPackage(p)}
                  onKeyDown={(e) => e.key === 'Enter' && A.enterPackage(p)}
                  role="button"
                  tabIndex={0}
                  aria-label={p}
                >
                  <span className="pkg-tab" />
                  <span className="pkg-name">{simpleName(p)}</span>
                  <span className="pkg-meta">{count === 1 ? t('diagram.class1') : t('diagram.classes', { n: count })}</span>
                </div>
              );
            })}

            {classes.map((info) => {
              const cls = info.fileClass;
              const p = pos(cls);
              const file = files[info.file];
              const stale = compile.state !== 'ok' || compile.snapshot[info.file] !== file.content;
              const errors = errorCount[info.file] || 0;
              const objs = objectsOf[cls] || [];
              const tr = testResult[cls];
              const stereo = info.isTest ? 'Test' : info.kind === 'abstract' ? 'abstract' : info.kind === 'interface' ? 'interface' : info.kind === 'enum' ? 'enum' : null;
              const state = errors ? 'bad' : stale ? 'stale' : 'ok';
              const canNew = compiledOk && !stale && info.kind === 'class' && !info.isTest;
              return (
                <div
                  key={cls}
                  ref={(el) => { cardRefs.current[cls] = el; }}
                  className={['dcard', 'class-card', info.kind, info.isTest ? 'test' : '', stale ? 'uncompiled' : '', selected === cls || multi.includes(cls) || (linking && linking.from === cls) ? 'selected' : '', highlight === cls ? 'hl' : '', related.has(cls) ? 'related' : '', dragging && dragging.includes(cls) ? 'dragging' : ''].filter(Boolean).join(' ')}
                  data-tour={'class:' + cls}
                  style={{ left: p.x, top: p.y }}
                  onPointerEnter={() => setHover(cls)}
                  onPointerLeave={() => setHover((h) => (h === cls ? null : h))}
                  onPointerDown={(e) => {
                    if (!linking) return startDrag(e, cls, (ev) => pick(cls, ev));
                    if (e.button !== 0) return undefined;
                    e.stopPropagation();
                    return pickForLink(cls);
                  }}
                  onDoubleClick={() => A.openClass(cls)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setState({ selectedClass: cls });
                    classMenu(cls, e.clientX, e.clientY, t);
                  }}
                  onFocus={() => setState({ selectedClass: cls })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') A.openClass(cls);
                    if (e.key.startsWith('Arrow')) {
                      e.preventDefault();
                      moveSelection(cls, e.key);
                    }
                    if (e.key === 'Delete' && !readOnly) A.openDialogBox({ type: 'delete', cls });
                    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                      const r = e.currentTarget.getBoundingClientRect();
                      classMenu(cls, r.left + 16, r.top + 24, t);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={info.simple}
                >
                  <div className="class-top">
                    {stereo && <div className="stereo">«{stereo}»</div>}
                    <div className="class-name-row">
                      <span className="class-name">{info.simple}</span>
                      <span className={'state-dot ' + state} title={errors ? t('diagram.errors', { n: errors }) : stale ? t('diagram.notCompiled') : t('diagram.compiled')} />
                    </div>
                    {(errors > 0 || (!showMembers && (!!info.extends[0] || info.implements.length > 0))) && (
                      <div className="class-meta">
                        {errors > 0 ? <span className="pill pill-neg">{t('diagram.errors', { n: errors })}</span> : <span>{info.extends[0] ? `extends ${info.extends[0]}` : `implements ${info.implements.join(', ')}`}</span>}
                      </div>
                    )}
                  </div>
                  {showMembers && <Members info={info} />}
                  {(objs.length > 0 || tr) && (
                    <div className="class-foot">
                      {tr ? (
                        <span className={tr.passed === tr.total ? 'tests-ok' : 'tests-bad'}>{t('tests.cardResult', { passed: tr.passed, total: tr.total })}</span>
                      ) : (
                        objs.slice(0, 4).map((n) => (
                          <button key={n} className="obj-chip" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); A.showInspector(n, n); }}>{n}</button>
                        ))
                      )}
                      {!tr && objs.length > 4 && <span className="muted">+{objs.length - 4}</span>}
                    </div>
                  )}
                  {(canNew || (info.isTest && compiledOk && !stale)) && (
                    <button
                      className="card-quick"
                      data-tour={info.isTest ? undefined : 'class-new:' + cls}
                      title={info.isTest ? t('menu.runTests') : t('diagram.quickNew', { name: info.simple })}
                      aria-label={info.isTest ? t('menu.runTests') : t('diagram.quickNew', { name: info.simple })}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (info.isTest) A.runTests({ className: cls });
                        else quickNew(cls, t, e.currentTarget.getBoundingClientRect());
                      }}
                    >
                      <Icon name={info.isTest ? 'play' : 'plus'} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {linking && (
          <div className="link-hint" role="status">
            <span>{linking.from ? t('relation.pickTo', { name: simpleName(linking.from) }) : t('relation.pickFrom')}</span>
            <button className="link" onPointerDown={(e) => e.stopPropagation()} onClick={() => setLinking(null)}>{t('common.cancel')}</button>
          </div>
        )}
        {band && (
          <div
            className="band"
            aria-hidden="true"
            style={{ left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1), width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0) }}
          />
        )}
        <div className="diagram-tools" data-tour="zoom">
          <button className="icon-btn" aria-label={t('diagram.zoomOut')} title={t('diagram.zoomOut') + ' · ' + formatKeys(lang, 'ctrl') + ' −'} onClick={() => zoomBy(1 / 1.2)}><Icon name="minus" /></button>
          <button className="zoom-label" title={t('diagram.zoom100')} aria-label={t('diagram.zoom100')} onClick={() => zoomTo(1)}>{Math.round(view.k * 100)}%</button>
          <button className="icon-btn" aria-label={t('diagram.zoomIn')} title={t('diagram.zoomIn') + ' · ' + formatKeys(lang, 'ctrl') + ' +'} onClick={() => zoomBy(1.2)}><Icon name="plus" /></button>
          <span className="tools-rule" aria-hidden="true" />
          <button className="icon-btn" aria-label={t('diagram.fit')} title={t('diagram.fit') + ' · ' + formatKeys(lang, 'ctrl 0', '+')} onClick={() => fit({ animate: true, all: true })}><Icon name="fit" /></button>
        </div>
        {kinds.size > 0 && (
          <div className="diagram-legend" aria-hidden="true" title={t('diagram.panHint')}>
            {['extends', 'impl', 'uses'].filter((k) => kinds.has(k)).map((k) => (
              <span key={k} className="legend-item">
                <Glyph kind={k} />
                {t(k === 'impl' ? 'diagram.legend.implements' : 'diagram.legend.' + k)}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
