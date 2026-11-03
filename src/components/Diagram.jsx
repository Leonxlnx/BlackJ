import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, setState, getState } from '../store.js';
import { useT, formatKeys } from '../i18n.js';
import * as A from '../actions.js';
import { childPackages, simpleName, flowLayout, layoutScore, routeEdge, spreadPorts } from '../model.js';
import { signature } from '../lib/javaParse.js';
import Icon from './Icon.jsx';

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

function clip(a, p) {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** A path through points with its corners rounded. */
function roundedPath(pts, r = 6) {
  let d = `M${pts[0].x} ${pts[0].y}`;
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
    d += ` L${a.x} ${a.y} Q${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x} ${last.y}`;
}

/** An edge drawn as a line: "uses" (dashed, open head, routed around cards in the way), or
    inheritance between cards that sit side by side. */
function Edge({ from, to, kind, hl, points }) {
  const cls = (kind === 'uses' ? 'uses' : kind === 'impl' ? 'impl' : '') + (hl ? ' hl' : '');
  const head = (b, ang, len = 11, spread = 0.5) => {
    const p1 = { x: b.x - len * Math.cos(ang - spread), y: b.y - len * Math.sin(ang - spread) };
    const p2 = { x: b.x - len * Math.cos(ang + spread), y: b.y - len * Math.sin(ang + spread) };
    return { p1, p2, base: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  };
  if (points && points.length >= 2) {
    const b = points[points.length - 1];
    const p = points[points.length - 2];
    const h = head(b, Math.atan2(b.y - p.y, b.x - p.x), 9, 0.45);
    return (
      <g>
        <path className={cls} d={roundedPath(points)} />
        <path className={'open' + (hl ? ' hl' : '')} d={`M${h.p1.x} ${h.p1.y} L${b.x} ${b.y} L${h.p2.x} ${h.p2.y}`} />
      </g>
    );
  }
  const c1 = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const c2 = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const a = clip(from, c2);
  const b = clip(to, c1);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const h = head(b, ang, kind === 'uses' ? 9 : 11, kind === 'uses' ? 0.45 : 0.5);
  return (
    <g>
      <path className={cls} d={`M${a.x} ${a.y} L${kind === 'uses' ? b.x : h.base.x} ${kind === 'uses' ? b.y : h.base.y}`} />
      {kind === 'uses' ? (
        <path className={'open' + (hl ? ' hl' : '')} d={`M${h.p1.x} ${h.p1.y} L${b.x} ${b.y} L${h.p2.x} ${h.p2.y}`} />
      ) : (
        <path className={'head' + (hl ? ' hl' : '')} d={`M${b.x} ${b.y} L${h.p1.x} ${h.p1.y} L${h.p2.x} ${h.p2.y} Z`} />
      )}
    </g>
  );
}

/** Inheritance as a tree: every child below its parent rises to one shared bus just above the
    highest child, one trunk runs up from there, and a single hollow triangle sits on the parent's
    bottom edge. */
function InheritTree({ parent, kids, kind, hl }) {
  const cls = kind === 'impl' ? 'impl' : '';
  const px = Math.round(parent.x + parent.w / 2);
  const tip = parent.y + parent.h;
  const base = tip + 10;
  const top = Math.min(...kids.map((k) => k.rect.y));
  const bus = Math.round(Math.max(base + 10, top - Math.min(24, (top - base) / 2)));
  const anyHl = hl || kids.some((k) => k.hl);
  const branch = ({ rect }) => {
    const cx = Math.round(rect.x + rect.w / 2);
    const dx = px - cx;
    if (Math.abs(dx) < 1) return `M${cx} ${rect.y} V${bus}`;
    const r = Math.min(6, Math.abs(dx) / 2, (rect.y - bus) / 2);
    const sx = Math.sign(dx);
    return `M${cx} ${rect.y} V${bus + r} Q${cx} ${bus} ${cx + sx * r} ${bus} H${px}`;
  };
  return (
    <g>
      {kids.map((k) => (
        <path key={k.key} className={cls + (hl || k.hl ? ' hl' : '')} d={branch(k)} />
      ))}
      <path className={cls + (anyHl ? ' hl' : '')} d={`M${px} ${bus} V${base}`} />
      <path className={'head' + (anyHl ? ' hl' : '')} d={`M${px} ${tip} L${px - 6} ${base} L${px + 6} ${base} Z`} />
    </g>
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
      if (info && info.hasMain) items.push({ label: t('menu.runMain'), tour: 'runMain', icon: 'play', onClick: () => A.runMain(cls) });
      if (info && info.isTest) {
        items.push({ label: t('menu.runTests'), tour: 'runTests', icon: 'check', onClick: () => A.runTests({ className: cls }) });
        items.push({ label: t('menu.record'), tour: 'record', icon: 'record', onClick: () => A.openDialogBox({ type: 'record', cls }) });
      }
      items.push({ label: t('menu.inspectClass'), tour: 'inspectClass', icon: 'eye', onClick: () => A.showInspector(cls, simple, true) });
    }
  } else {
    items.push({ label: t('menu.compileFirst'), disabled: true });
    items.push({ label: t('menu.compileNow'), tour: 'compileNow', icon: 'build', onClick: A.compile });
  }
  items.push({ type: 'sep' });
  items.push({ label: t('menu.open'), tour: 'open', icon: 'file', onClick: () => A.openClass(cls) });
  if (info && !info.isTest && info.kind !== 'interface' && !s.project.readOnly) items.push({ label: t('menu.createTest'), tour: 'createTest', icon: 'check', onClick: () => A.newClass(simple + 'Test', 'test') });
  if (!s.settings.aiOff) items.push({ label: t('menu.explain'), tour: 'explain', icon: 'tutor', onClick: () => { A.openClass(cls); setTimeout(() => A.askTutor(t('tutor.prompt.explainClass', { name: simple })), 50); } });
  if (!s.project.readOnly) {
    items.push({ type: 'sep' });
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
  const [sizes, setSizes] = useState({});
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  // The grid moves with the canvas; below 50% zoom it steps up so it never turns into a mesh.
  const gridStep = 24 * view.k * (view.k < 0.5 ? 4 : 1);
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState(null);
  // The width (in diagram units) the flow layout packs into and its row gap, set by fit().
  const [flowAt, setFlowAt] = useState(null);
  const [compact, setCompact] = useState(false);
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
  // Content taller than the panel ends above the zoom tools, so the lowest row (often the class
  // with main) stays in full view and the rows above it scroll.
  const viewFor = (b, k) => {
    const { cw, ch } = panelBox();
    const x = b.w * k > cw ? 24 - b.minX * k : 24 + (cw - b.w * k) / 2 - b.minX * k;
    const y = b.h * k > ch ? 24 + ch - (b.minY + b.h) * k : 24 - b.minY * k;
    return { k, x: Math.round(x), y: Math.round(y) };
  };
  // Fits the content into the panel with 24px around it and a 56px band at the bottom for the
  // zoom tools, by width and by height. Small cards are hard to read, so the flow layout first
  // repacks the cards for the panel's width; if that is not enough the cards drop their member
  // lists (compact) for as long as the full cards would not fit at 85%, and compact cards are
  // never fitted below 90%: their rows move closer together first, then the canvas pans.
  const moved = useRef(false);
  const fit = (override) => {
    const host = hostRef.current;
    if (!host || !keys.length) return;
    moved.current = false;
    const { cw, ch } = panelBox();
    const scale = (b) => Math.min(1, cw / b.w, ch / b.h);
    const plan = (sz, c) => {
      const size = sizeOf(sz);
      if (manual) {
        const at = Object.fromEntries(keys.map((k) => [k, (override && override[k]) || positions[k] || { x: 32, y: 32 }]));
        const b = bbox(at, size);
        return { w: null, b, k: scale(b) };
      }
      const short = c || !details;
      const floor = short ? MIN_K : FULL_K;
      const pack = (gap) => [1, 0.95, MIN_K, FULL_K].map((t) => {
        const w = Math.floor(cw / t);
        const at = flowLayout(model, keys, size, w, 40, gap);
        const b = bbox(at, size);
        return { w, gap, b, k: scale(b), crossed: crossings(at, size) };
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
    // Full cards are never fitted below FULL_K (they turn compact first); compact ones stop at MIN_K.
    setView(viewFor(p.b, Math.max(compact || !details ? MIN_K : 0.3, p.k)));
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
  const exportImage = async () => {
    const host = hostRef.current;
    if (!host || !keys.length) return;
    const before = view;
    const wasMoved = moved.current;
    setState({ selectedClass: null, highlightClass: null });
    const at = Object.fromEntries(keys.map((k) => [k, pos(k)]));
    const content = bbox(at, sizeOf(sizes));
    const { cw, ch } = panelBox();
    setView(viewFor(content, Math.max(0.3, Math.min(1, cw / content.w, ch / content.h))));
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
      await A.saveDiagramImage({ x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top });
    } finally {
      host.classList.remove('exporting');
      setView(before);
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
  const edges = model.edges.filter((e) => visible.has(e.from) && visible.has(e.to) && (showUses || e.kind !== 'uses'));
  // Children that sit clearly below their parent join that parent's tree; the rest stay straight lines.
  const trees = new Map();
  const straight = [];
  for (const e of edges) {
    const a = rects[e.from];
    const b = rects[e.to];
    if (e.kind !== 'uses' && a.y > b.y + b.h + 24) {
      const id = e.to + '|' + e.kind;
      if (!trees.has(id)) trees.set(id, { parent: e.to, kind: e.kind, kids: [] });
      trees.get(id).kids.push({ key: e.from, rect: a, hl: highlight === e.from });
    } else straight.push(e);
  }
  // "Uses" arrows are routed around the cards in the way, each with its own port on a card's side.
  const routes = new Map(straight.filter((e) => e.kind === 'uses').map((e) => [e, { from: e.from, to: e.to, pts: routeEdge(rects[e.from], rects[e.to], keys.filter((k) => k !== e.from && k !== e.to).map((k) => rects[k])) }]));
  spreadPorts([...routes.values()], rects);

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
    if (dx || dy) setView((v) => ({ ...v, x: Math.round(v.x + dx), y: Math.round(v.y + dy) }));
  }, [revealCard && revealCard.at, !!(revealCard && sizes[revealCard.key])]);

  const onWheel = (e) => {
    moved.current = true;
    if (e.ctrlKey) {
      const host = hostRef.current.getBoundingClientRect();
      const mx = e.clientX - host.left;
      const my = e.clientY - host.top;
      setView((v) => {
        const k = Math.min(1.6, Math.max(0.4, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
      });
    } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };
  const zoomBy = (f) => {
    moved.current = true;
    const host = hostRef.current;
    const mx = host.clientWidth / 2;
    const my = host.clientHeight / 2;
    setView((v) => {
      const k = Math.min(1.6, Math.max(0.4, v.k * f));
      return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
    });
  };

  const startPan = (e) => {
    if (e.button !== 0 || e.target.closest('.dcard') || e.target.closest('button')) return;
    setState({ selectedClass: null });
    setPanning(true);
    let lx = e.clientX;
    let ly = e.clientY;
    const move = (ev) => {
      moved.current = true;
      setView((v) => ({ ...v, x: v.x + ev.clientX - lx, y: v.y + ev.clientY - ly }));
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startDrag = (e, key, onClick) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    const origin = { ...pos(key) };
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / view.k;
      const dy = (ev.clientY - start.y) / view.k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      // The first card the user moves pins the whole flow layout of this package as it is shown.
      if (!moved && flow) A.pinLayout(pkg, Object.fromEntries(keys.map((k) => [k, { ...pos(k) }])));
      moved = true;
      setDragging(key);
      A.setPosition(key, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(null);
      if (moved) {
        const p = getState().positions[key];
        A.setPosition(key, { x: Math.round(p.x / SNAP) * SNAP, y: Math.round(p.y / SNAP) * SNAP });
      } else onClick && onClick();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
          </>
        )}
        <button className="icon-btn" aria-pressed={details} aria-label={t('diagram.details')} title={t('diagram.details')} onClick={() => A.updateSettings({ diagramDetails: !details })}>
          <Icon name="layers" />
        </button>
        <button className="icon-btn" aria-pressed={showUses} aria-label={t('diagram.showUses')} title={t('diagram.showUses')} onClick={() => A.updateSettings({ showUses: !showUses })}>
          <Icon name="link" />
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
      <div className={'diagram' + (panning ? ' panning' : '') + (compact ? ' compact' : '')} data-tour="diagram" ref={hostRef} onPointerDown={startPan} onWheel={onWheel} style={{ backgroundSize: `${gridStep}px ${gridStep}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
        {keys.length === 0 && !pkg ? (
          <div className="diagram-empty">
            <span>{t('diagram.empty')}</span>
            <button className="btn btn-sm" onClick={() => A.openDialogBox({ type: 'newClass' })}>
              <Icon name="plus" />
              {t('diagram.emptyAction')}
            </button>
          </div>
        ) : (
          <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            <svg className="edges" width="1" height="1">
              {straight.map((e, i) => (
                <Edge
                  key={i}
                  from={rects[e.from]}
                  to={rects[e.to]}
                  kind={e.kind}
                  points={routes.has(e) ? routes.get(e).pts : null}
                  hl={highlight && (e.from === highlight || e.to === highlight) && e.kind !== 'uses'}
                />
              ))}
              {[...trees.entries()].map(([id, tr]) => (
                <InheritTree key={id} parent={rects[tr.parent]} kids={tr.kids} kind={tr.kind} hl={highlight === tr.parent} />
              ))}
            </svg>

            {readme && !pkg && (
              <div className="dcard note-card" data-tour="readme" style={{ left: noteAt.x, top: noteAt.y }} onDoubleClick={A.openReadme} onClick={A.openReadme} role="button" tabIndex={0} title={readme.name}>
                <Icon name="file" />
                <span>{readme.name}</span>
              </div>
            )}

            {pkg && (
              <div className="dcard pkg-card up" style={{ left: noteAt.x, top: noteAt.y }} onDoubleClick={() => A.enterPackage(pkg.includes('.') ? pkg.slice(0, pkg.lastIndexOf('.')) : '')} onClick={() => A.enterPackage(pkg.includes('.') ? pkg.slice(0, pkg.lastIndexOf('.')) : '')} role="button" tabIndex={0}>
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
                  className={'dcard pkg-card' + (dragging === k ? ' dragging' : '')}
                  data-tour={'package:' + p}
                  style={{ left: pos(k).x, top: pos(k).y }}
                  onPointerDown={(e) => startDrag(e, k)}
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
                  className={['dcard', 'class-card', info.kind, info.isTest ? 'test' : '', stale ? 'uncompiled' : '', selected === cls ? 'selected' : '', highlight === cls ? 'hl' : '', dragging === cls ? 'dragging' : ''].join(' ')}
                  data-tour={'class:' + cls}
                  style={{ left: p.x, top: p.y }}
                  onPointerDown={(e) => startDrag(e, cls, () => setState({ selectedClass: cls }))}
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
        <div className="diagram-tools" data-tour="zoom">
          <button className="icon-btn" aria-label={t('diagram.zoomOut')} title={t('diagram.zoomOut')} onClick={() => zoomBy(0.85)}><Icon name="minus" /></button>
          <span className="zoom-label">{Math.round(view.k * 100)}%</span>
          <button className="icon-btn" aria-label={t('diagram.zoomIn')} title={t('diagram.zoomIn')} onClick={() => zoomBy(1.15)}><Icon name="plus" /></button>
          <button className="icon-btn" aria-label={t('diagram.fit')} title={t('diagram.fit')} onClick={() => fit()}><Icon name="fit" /></button>
        </div>
        {kinds.size > 0 && (
          <div className="diagram-legend" aria-hidden="true">
            {kinds.has('extends') && (
              <span>
                <svg viewBox="0 0 26 10"><path d="M1 5h16" stroke="var(--edge)" /><path d="M24 5l-7 -4v8z" fill="var(--surface)" stroke="var(--edge)" /></svg>
                {t('diagram.legend.extends')}
              </span>
            )}
            {kinds.has('impl') && (
              <span>
                <svg viewBox="0 0 26 10"><path d="M1 5h16" stroke="var(--edge)" strokeDasharray="4 3" /><path d="M24 5l-7 -4v8z" fill="var(--surface)" stroke="var(--edge)" /></svg>
                {t('diagram.legend.implements')}
              </span>
            )}
            {kinds.has('uses') && (
              <span>
                <svg viewBox="0 0 26 10"><path d="M1 5h22" stroke="var(--edge)" strokeDasharray="3 3" /><path d="M18 1l6 4-6 4" fill="none" stroke="var(--edge)" /></svg>
                {t('diagram.legend.uses')}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
