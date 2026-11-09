// Derived data about the project's classes, parsed from the editor buffers and cached by content.
// Class names are qualified ("tiere.Hund"); the default package has plain names ("Hund").
import { parseJava } from './lib/javaParse.js';

const cache = new Map();

export const simpleName = (q) => String(q).split('.').pop();
export const packageOfClass = (q) => (String(q).includes('.') ? String(q).slice(0, String(q).lastIndexOf('.')) : '');
export const fileOfClass = (q) => String(q).split('$')[0].split('.').join('/') + '.java';

export function infoFor(file) {
  const hit = cache.get(file.name);
  if (hit && hit.content === file.content) return hit.info;
  const simple = simpleName(file.className);
  const info = parseJava(file.content, simple);
  info.file = file.name;
  info.fileClass = file.className;
  info.simple = simple;
  info.pkg = file.pkg != null ? file.pkg : packageOfClass(file.className);
  info.isTest = /\bimport\s+(static\s+)?org\.junit\b/.test(file.content) || /@Test\b/.test(file.content);
  info.imports = [...file.content.matchAll(/^\s*import\s+(static\s+)?([\w.]+)(\.\*)?\s*;/gm)].map((m) => ({ name: m[2], star: !!m[3] }));
  cache.set(file.name, { content: file.content, info });
  return info;
}

/** All classes with their relations: extends / implements / uses edges between project classes. */
export function projectModel(files) {
  const list = Object.values(files).map(infoFor).sort((a, b) => a.fileClass.localeCompare(b.fileClass));
  const byName = Object.fromEntries(list.map((c) => [c.fileClass, c]));
  const bySimple = {};
  for (const c of list) (bySimple[c.simple] = bySimple[c.simple] || []).push(c.fileClass);
  // Resolve a simple name as javac would for this class: same package, explicit import, star import.
  const resolve = (from, n) => {
    if (byName[n]) return n;
    const same = from.pkg ? from.pkg + '.' + n : n;
    if (byName[same]) return same;
    for (const imp of from.imports) {
      if (!imp.star && simpleName(imp.name) === n && byName[imp.name]) return imp.name;
      if (imp.star && byName[imp.name + '.' + n]) return imp.name + '.' + n;
    }
    const all = bySimple[n] || [];
    return all.length === 1 ? all[0] : null;
  };
  const edges = [];
  for (const c of list) {
    c.parents = [];
    // Each relation once, never from a class to itself (half-typed code can say "extends" twice).
    for (const [names, kind] of [[c.extends, 'extends'], [c.implements, 'impl']]) {
      for (const p of names) {
        const q = resolve(c, p);
        if (!q || q === c.fileClass || c.parents.includes(q)) continue;
        edges.push({ from: c.fileClass, to: q, kind });
        c.parents.push(q);
      }
    }
    const own = new Set([c.simple, ...c.extends, ...c.implements]);
    for (const n of Object.keys(bySimple)) {
      if (own.has(n)) continue;
      if (!new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b').test(c.masked)) continue;
      const q = resolve(c, n);
      if (q && q !== c.fileClass && !c.parents.includes(q) && !edges.some((e) => e.from === c.fileClass && e.to === q)) edges.push({ from: c.fileClass, to: q, kind: 'uses' });
    }
  }
  const packages = [...new Set(list.flatMap((c) => {
    const parts = c.pkg ? c.pkg.split('.') : [];
    return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
  }))].sort();
  return { list, names: list.map((c) => c.fileClass), edges, byName, bySimple, packages, resolve };
}

/** Is class `sub` the same as, or a subclass/implementation of, type `sup` (simple or qualified)? */
export function isAssignable(model, sub, sup) {
  const target = String(sup).replace(/<.*>/, '');
  if (target === 'Object' || target === 'java.lang.Object') return true;
  const matches = (c) => c === target || simpleName(c) === simpleName(target);
  const seen = new Set();
  const stack = [sub];
  while (stack.length) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c);
    if (matches(c)) return true;
    const info = model.byName[c];
    if (info && info.parents) stack.push(...info.parents);
  }
  return false;
}

/** Direct sub-packages of pkg ('' is the default package). */
export function childPackages(model, pkg) {
  return model.packages.filter((p) => (pkg ? p.startsWith(pkg + '.') && !p.slice(pkg.length + 1).includes('.') : !p.includes('.')));
}

/**
 * Layered positions for the classes and sub-packages of one package that have none yet:
 * superclasses on top, their subclasses centred underneath, programs at the end of the first row.
 */
export function autoLayout(model, positions, pkg = '', pitchX = 272, pitchY = 300) {
  const inPkg = model.list.filter((c) => c.pkg === pkg).map((c) => c.fileClass);
  const parentOf = (c) => (model.byName[c]?.parents || []).filter((p) => inPkg.includes(p));
  const depth = {};
  const d = (c, guard = 0) => {
    if (depth[c] != null) return depth[c];
    if (guard > 20) return 0;
    const ps = parentOf(c);
    depth[c] = ps.length ? Math.max(...ps.map((p) => d(p, guard + 1))) + 1 : 0;
    return depth[c];
  };
  for (const c of inPkg) d(c);
  const hasChildren = new Set(inPkg.flatMap(parentOf));

  const next = { ...positions };
  const subPkgs = childPackages(model, pkg).map((p) => 'pkg:' + p);
  const missing = [...subPkgs, ...inPkg].filter((c) => !next[c]);
  if (!missing.length) return next;
  const scope = new Set([...subPkgs, ...inPkg]);
  // Each placed card blocks the area it really covers: package cards are short, class cards tall.
  const taken = Object.entries(next).filter(([k]) => scope.has(k)).map(([k, p]) => ({ ...p, h: k.startsWith('pkg:') ? 100 : pitchY - 40 }));
  const free = (x, y, h) => !taken.some((p) => Math.abs(p.x - x) < pitchX - 16 && (p.y <= y ? y - p.y < p.h : p.y - y < h));
  const place = (c, x, y) => {
    while (!free(x, y, pitchY - 40)) x += pitchX;
    next[c] = { x, y };
    taken.push({ x, y, h: pitchY - 40 });
  };
  // Packages first, in a row of their own (smaller cards).
  let px = 32;
  for (const p of missing.filter((m) => m.startsWith('pkg:'))) {
    while (!free(px, 32, 100)) px += 196;
    next[p] = { x: px, y: 32 };
    taken.push({ x: px, y: 32, h: 100 });
    px += 196;
  }
  const top = missing.some((m) => m.startsWith('pkg:')) || subPkgs.some((p) => positions[p]) ? 32 + 140 : 32;
  const classes = missing.filter((m) => !m.startsWith('pkg:'));
  const maxDepth = Math.max(0, ...classes.map((c) => depth[c]));
  for (let row = 0; row <= maxDepth; row++) {
    const names = classes.filter((c) => depth[c] === row);
    const y = top + row * pitchY;
    if (row === 0) {
      const rank = (c) => (hasChildren.has(c) ? 0 : model.byName[c]?.isTest ? 3 : model.byName[c]?.hasMain ? 2 : 1);
      names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      let x = 32;
      for (const c of names) {
        place(c, x, y);
        x = next[c].x + pitchX;
      }
      continue;
    }
    const groups = new Map();
    for (const c of names) {
      const parent = parentOf(c)[0];
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(c);
    }
    const ordered = [...groups.entries()].sort((a, b) => (next[a[0]]?.x ?? 0) - (next[b[0]]?.x ?? 0));
    for (const [parent, kids] of ordered) {
      const px0 = next[parent] ? next[parent].x : 32;
      const start = Math.max(32, px0 - ((kids.length - 1) * pitchX) / 2);
      kids.sort((a, b) => a.localeCompare(b)).forEach((c, i) => place(c, start + i * pitchX, y));
    }
  }
  return next;
}

/**
 * How well a diagram reads: `hard` counts arrows that run through another card or cross another
 * arrow, `soft` adds the length of the "uses" arrows (short arrows read better). Inheritance
 * between a card and one clearly below it is measured as the tree the diagram draws (up from
 * the subclass, along a bus, up into the superclass).
 */
export function layoutScore(model, keys, at, size) {
  const shown = new Set(keys);
  const box = (k) => ({ x: at[k].x, y: at[k].y, w: size(k).w, h: size(k).h });
  const centre = centreOf;
  let hard = 0;
  let soft = 0;
  const segs = [];
  const all = keys.filter((k) => at[k]);
  for (const e of model.edges) {
    if (!shown.has(e.from) || !shown.has(e.to) || !at[e.from] || !at[e.to]) continue;
    const a = box(e.from);
    const b = box(e.to);
    const own = [e.from, e.to];
    if (e.kind === 'uses') {
      // Measured along the path the diagram draws for it.
      const pts = routeEdge(a, b, all.filter((k) => k !== e.from && k !== e.to).map(box));
      for (let i = 0; i < pts.length - 1; i++) segs.push({ p: pts[i], q: pts[i + 1], own, kind: 'uses' });
      soft += (pts.length - 2) * 0.4;
    } else if (a.y > b.y + b.h + 8) {
      const cx = a.x + a.w / 2;
      const px = b.x + b.w / 2;
      const bus = a.y - Math.min(24, (a.y - b.y - b.h) / 2);
      segs.push({ p: { x: cx, y: a.y }, q: { x: cx, y: bus }, own, kind: 'tree' });
      if (Math.abs(cx - px) > 1) segs.push({ p: { x: cx, y: bus }, q: { x: px, y: bus }, own, kind: 'tree' });
      segs.push({ p: { x: px, y: bus }, q: { x: px, y: b.y + b.h }, own, kind: 'tree', trunk: e.to });
    } else {
      segs.push({ p: centre(a), q: centre(b), own, kind: e.kind });
    }
  }
  const rects = all.map((k) => ({ k, ...box(k) }));
  for (const s of segs) {
    if (s.kind === 'uses') soft += Math.hypot(s.q.x - s.p.x, s.q.y - s.p.y) / 160;
    for (const r of rects) {
      if (s.own.includes(r.k)) continue;
      if (segmentHitsRect(s.p, s.q, { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 })) hard += s.kind === 'uses' ? 2 : 3;
    }
  }
  // Crossing arrows (pieces of one inheritance tree never count against each other).
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const u = segs[j];
      if (s.own.some((k) => u.own.includes(k))) continue;
      if (s.kind === 'tree' && u.kind === 'tree' && s.own[1] === u.own[1]) continue;
      if (segmentsCross(s.p, s.q, u.p, u.q)) hard += 1;
    }
  }
  return { hard, soft };
}

const centreOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Where the line from the centre of r towards p leaves r. */
export function clipToRect(r, p) {
  const c = centreOf(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (!dx && !dy) return c;
  const s = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/**
 * The path of a "uses" arrow from card a to card b: straight when no other card is in the way,
 * else with right-angle bends through the free space between the cards (or around them).
 */
export function routeEdge(a, b, obstacles) {
  const ca = centreOf(a);
  const cb = centreOf(b);
  const inner = obstacles.map((o) => ({ x: o.x + 4, y: o.y + 4, w: o.w - 8, h: o.h - 8 }));
  const hits = (pts) => {
    let n = 0;
    for (let i = 0; i < pts.length - 1; i++) for (const o of inner) if (segmentHitsRect(pts[i], pts[i + 1], o)) n++;
    return n;
  };
  const length = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);
  const sideX = (r, toward) => (toward > r.x + r.w / 2 ? r.x + r.w : r.x);
  const sideY = (r, toward) => (toward > r.y + r.h / 2 ? r.y + r.h : r.y);
  const outX = (r, x) => x < r.x + 12 || x > r.x + r.w - 12;
  const outY = (r, y) => y < r.y + 12 || y > r.y + r.h - 12;
  // Every arrow is orthogonal (the diagram rounds its corners). On a top or bottom edge it never
  // uses the middle: that is where an inheritance branch leaves a subclass or the trunk enters a
  // superclass, and a dashed arrow there would merge with it.
  const port = (r, toward) => {
    const c = r.x + r.w / 2;
    return c + (toward < c ? -1 : 1) * Math.min(28, r.w / 4);
  };
  const clearOfMiddles = (x) => Math.abs(x - ca.x) >= 16 && Math.abs(x - cb.x) >= 16;
  const cands = [];
  // Straight, where the cards overlap: across (side to side) or down (top to bottom, off-centre).
  const oy0 = Math.max(a.y, b.y) + 8;
  const oy1 = Math.min(a.y + a.h, b.y + b.h) - 8;
  if (oy1 >= oy0 && (b.x > a.x + a.w || a.x > b.x + b.w)) {
    const y = (oy0 + oy1) / 2;
    cands.push([{ x: sideX(a, cb.x), y }, { x: sideX(b, ca.x), y }]);
  }
  const ox0 = Math.max(a.x, b.x) + 12;
  const ox1 = Math.min(a.x + a.w, b.x + b.w) - 12;
  if (ox1 >= ox0 && (b.y > a.y + a.h || a.y > b.y + b.h)) {
    const x = [(ox0 + ox1) / 2, ox0, ox1].find(clearOfMiddles);
    if (x != null) cands.push([{ x, y: sideY(a, cb.y) }, { x, y: sideY(b, ca.y) }]);
  }
  // One bend: out of a's side, into b's top or bottom (or the other way round).
  if (outX(a, cb.x) && outY(b, ca.y)) {
    const xb = port(b, ca.x);
    cands.push([{ x: sideX(a, xb), y: ca.y }, { x: xb, y: ca.y }, { x: xb, y: sideY(b, ca.y) }]);
  }
  if (outY(a, cb.y) && outX(b, ca.x)) {
    const xa = port(a, cb.x);
    cands.push([{ x: xa, y: sideY(a, cb.y) }, { x: xa, y: cb.y }, { x: sideX(b, xa), y: cb.y }]);
  }
  // Two bends through the gap between the rows (or the columns) of the two cards.
  if (b.y > a.y + a.h + 12 || a.y > b.y + b.h + 12) {
    const my = a.y + a.h < b.y ? (a.y + a.h + b.y) / 2 : (b.y + b.h + a.y) / 2;
    const ya = sideY(a, my);
    const yb = sideY(b, my);
    for (const [xa, xb] of [[port(a, cb.x), port(b, ca.x)], [a.x + a.w * 0.25, b.x + b.w * 0.25], [a.x + a.w * 0.75, b.x + b.w * 0.75]]) cands.push([{ x: xa, y: ya }, { x: xa, y: my }, { x: xb, y: my }, { x: xb, y: yb }]);
  }
  if (b.x > a.x + a.w + 12 || a.x > b.x + b.w + 12) {
    const mx = a.x + a.w < b.x ? (a.x + a.w + b.x) / 2 : (b.x + b.w + a.x) / 2;
    cands.push([{ x: sideX(a, mx), y: ca.y }, { x: mx, y: ca.y }, { x: mx, y: cb.y }, { x: sideX(b, mx), y: cb.y }]);
  }
  // Around everything in between, on the left or the right.
  const lo = Math.min(a.y, b.y);
  const hi = Math.max(a.y + a.h, b.y + b.h);
  const between = [a, b, ...obstacles.filter((o) => o.y < hi && o.y + o.h > lo)];
  const left = Math.min(...between.map((o) => o.x)) - 20;
  const right = Math.max(...between.map((o) => o.x + o.w)) + 20;
  cands.push([{ x: a.x, y: ca.y }, { x: left, y: ca.y }, { x: left, y: cb.y }, { x: b.x, y: cb.y }]);
  cands.push([{ x: a.x + a.w, y: ca.y }, { x: right, y: ca.y }, { x: right, y: cb.y }, { x: b.x + b.w, y: cb.y }]);
  let best = null;
  for (const pts of cands) {
    const cost = hits(pts) * 10000 + length(pts) + (pts.length - 2) * 40;
    if (!best || cost < best.cost) best = { cost, pts };
  }
  return best.pts;
}

/**
 * Gives lines that leave or enter a card's side at (nearly) the same point a port each, 8px apart
 * (16px where an arrowhead sits), so two relations never share a segment and read as one arrow
 * with a fork, and two heads never overlap. Ends closer than that on one side are spread around
 * their middle, at least 12px from the card's corners; of two ends at the same point the one that
 * turns off sooner takes the port on the side it turns to, so the spread lines never cross. The
 * routes ({ from, to, pts }) are moved in place.
 */
export function spreadPorts(routes, rects, fixed = {}) {
  const sides = new Map();
  for (const r of routes) {
    const n = r.pts.length;
    for (const [key, i, j, l, head] of [[r.from, 0, 1, 2, false], [r.to, n - 1, n - 2, n - 3, true]]) {
      const c = rects[key];
      const e = r.pts[i];
      const side = Math.abs(e.x - c.x) < 1 ? 'l' : Math.abs(e.x - c.x - c.w) < 1 ? 'r' : Math.abs(e.y - c.y) < 1 ? 't' : 'b';
      // On the left or right edge a port moves along y, on the top or bottom edge along x.
      const ax = side === 'l' || side === 'r' ? 'y' : 'x';
      const other = ax === 'y' ? 'x' : 'y';
      const next = r.pts[l] && l !== i ? Math.sign(r.pts[l][ax] - r.pts[j][ax]) : 0;
      const run = Math.abs(r.pts[j][other] - e[other]);
      const id = key + ':' + side;
      if (!sides.has(id)) sides.set(id, { id, lo: ax === 'y' ? c.y : c.x, hi: ax === 'y' ? c.y + c.h : c.x + c.w, ends: [] });
      sides.get(id).ends.push({ p: r.pts[i], q: r.pts[j], ax, head, order: next < 0 ? run - 1e6 : next > 0 ? 1e6 - run : 0 });
    }
  }
  for (const s of sides.values()) {
    if (s.ends.length < 2) continue;
    for (let pass = 0; pass < 4; pass++) {
      const at = (e) => e.p[e.ax];
      const sorted = s.ends.slice().sort((a, b) => Math.round(at(a)) - Math.round(at(b)) || a.order - b.order);
      const clusters = [];
      for (const e of sorted) {
        const last = clusters[clusters.length - 1];
        const prev = last && last[last.length - 1];
        if (prev && at(e) - at(prev) < (e.head || prev.head ? 16 : 8) - 0.01) last.push(e);
        else clusters.push([e]);
      }
      let moved = false;
      // Where an inheritance trunk or branch meets this side (fixed[side]), no line may come closer
      // than 16px.
      const pins = fixed[s.id] || [];
      for (const cl of clusters) {
        const crowded = pins.some((f) => cl.some((e) => Math.abs(at(e) - f) < 16 - 0.01));
        if (cl.length < 2 && !crowded) continue;
        const step = Math.max(2, Math.min(cl.some((e) => e.head) ? 16 : 8, (s.hi - s.lo - 24) / Math.max(1, cl.length - 1)));
        const centre = cl.reduce((t, e) => t + at(e), 0) / cl.length;
        let first = centre - ((cl.length - 1) / 2) * step;
        const span = (cl.length - 1) * step;
        for (const f of pins) {
          if (first > f + 16 || first + span < f - 16) continue;
          // Move the whole group off the pin, to the side its middle is on (or that has room).
          const right = f + 16;
          const left = f - 16 - span;
          first = (centre >= f && right + span <= s.hi - 12) || left < s.lo + 12 ? right : left;
        }
        first = Math.max(s.lo + 12, Math.min(s.hi - 12 - span, first));
        cl.forEach((e, i) => {
          const d = first + i * step - at(e);
          if (Math.abs(d) < 0.01) return;
          e.p[e.ax] += d;
          if (e.q !== e.p) e.q[e.ax] += d;
          moved = true;
        });
      }
      if (!moved) break;
    }
  }
  return routes;
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function segmentHitsRect(p, q, r) {
  if (r.w <= 0 || r.h <= 0) return false;
  // Liang-Barsky clipping: does any part of p→q lie inside r?
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  for (const [pp, qq] of [[-dx, p.x - r.x], [dx, r.x + r.w - p.x], [-dy, p.y - r.y], [dy, r.y + r.h - p.y]]) {
    if (pp === 0) {
      if (qq < 0) return false;
    } else {
      const t = qq / pp;
      if (pp < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return t1 - t0 > 0.001;
}

// ------------------------------------------------------------------ drawing the relations (UML)

/** The two arrowheads, in diagram units: the hollow triangle of "extends" and "implements" (at the
    superclass or interface) and the open head of "uses" (at the class that is used). */
export const HEADS = { tri: { len: 12, half: 7 }, open: { len: 10, half: 5.5 } };
// The free space a routed line keeps around every card; how far below its superclass a subclass
// has to sit to hang in the superclass's tree; what a bend costs against length.
const CLEAR = 12;
const DROP = 30;
const BEND = 28;

const grow = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const strictlyIn = (p, r) => p.x > r.x + 0.5 && p.x < r.x + r.w - 0.5 && p.y > r.y + 0.5 && p.y < r.y + r.h - 0.5;
const same = (a, b) => Math.abs(a - b) < 0.01;

/**
 * The relations the diagram shows between the classes in `shown`, each once: never from a class to
 * itself, and no "uses" arrow next to an "extends" or "implements" between the same two classes.
 */
export function diagramEdges(model, shown, withUses = true) {
  const inherit = new Set(model.edges.filter((e) => e.kind !== 'uses').map((e) => e.from + '>' + e.to));
  const seen = new Set();
  const out = [];
  for (const e of model.edges) {
    if (e.from === e.to || !shown.has(e.from) || !shown.has(e.to)) continue;
    if (e.kind === 'uses' && (!withUses || inherit.has(e.from + '>' + e.to))) continue;
    const id = e.from + '>' + e.to + '>' + e.kind;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

/** Drops repeated points and the middle one of three on a straight line. */
export function simplifyPath(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && same(q.x, p.x) && same(q.y, p.y)) continue;
    out.push({ x: p.x, y: p.y });
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      if (!((same(a.x, b.x) && same(b.x, c.x)) || (same(a.y, b.y) && same(b.y, c.y)))) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/**
 * The arrowhead at the end of a path. Its tip is the path's last point (on the target card's
 * border); `line` is the path to draw under it: a hollow triangle ends the line at its base, an open
 * head ends it at the tip.
 */
export function arrowHead(pts, type) {
  const tip = pts[pts.length - 1];
  const prev = pts[pts.length - 2] || { x: tip.x, y: tip.y + 1 };
  const l = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
  const ux = (tip.x - prev.x) / l;
  const uy = (tip.y - prev.y) / l;
  const { len, half } = HEADS[type];
  const base = { x: tip.x - ux * len, y: tip.y - uy * len };
  const w1 = { x: base.x - uy * half, y: base.y + ux * half };
  const w2 = { x: base.x + uy * half, y: base.y - ux * half };
  const f = (p) => `${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`;
  const xs = [tip.x, w1.x, w2.x];
  const ys = [tip.y, w1.y, w2.y];
  // The area the head covers, with 3px around it: other lines keep out of it.
  const box = { x: Math.min(...xs) - 3, y: Math.min(...ys) - 3, w: Math.max(...xs) - Math.min(...xs) + 6, h: Math.max(...ys) - Math.min(...ys) + 6 };
  if (type === 'tri') return { type, tip, base, box, d: `M${f(tip)} L${f(w1)} L${f(w2)} Z`, line: [...pts.slice(0, -1), base] };
  return { type, tip, base, box, d: `M${f(w1)} L${f(tip)} L${f(w2)}`, line: pts };
}

/**
 * Takes the tiny jogs (a few pixels sideways and on again) out of an orthogonal path: the segment
 * before or after a jog moves onto the other one's line (a port slides along its card's side,
 * keeping 12px from the corners), when the path then stays clear (ok(p, q) for every segment) and
 * the last run keeps room for the arrowhead.
 */
function straighten(pts, a, b, ok, headLen) {
  let out = simplifyPath(pts);
  const onSide = (p, r) => (same(p.x, r.x) || same(p.x, r.x + r.w) ? p.y >= r.y + 12 && p.y <= r.y + r.h - 12 : p.x >= r.x + 12 && p.x <= r.x + r.w - 12);
  for (let guard = 0; guard < 8; guard++) {
    let changed = false;
    for (let i = 1; i + 2 < out.length && !changed; i++) {
      const p = out[i];
      const q = out[i + 1];
      if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) >= 12) continue;
      const ax = Math.abs(p.x - q.x) > 0.01 ? 'x' : 'y';
      const d = q[ax] - p[ax];
      for (const [k0, k1, delta] of [[i - 1, i, d], [i + 1, i + 2, -d]]) {
        const t = out.map((v) => ({ x: v.x, y: v.y }));
        t[k0][ax] += delta;
        t[k1][ax] += delta;
        if (k0 === 0 && !onSide(t[0], a)) continue;
        if (k1 === t.length - 1 && !onSide(t[t.length - 1], b)) continue;
        const n = simplifyPath(t);
        const last = Math.abs(n[n.length - 1].x - n[n.length - 2].x) + Math.abs(n[n.length - 1].y - n[n.length - 2].y);
        if (n.length < 2 || last < headLen + 4 || n.some((v, j) => j && !ok(n[j - 1], v))) continue;
        out = n;
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return out;
}

class Heap {
  constructor() { this.c = []; this.s = []; }
  get size() { return this.c.length; }
  push(cost, state) {
    const { c, s } = this;
    let i = c.length;
    c.push(cost);
    s.push(state);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p]; s[i] = s[p]; i = p;
    }
    c[i] = cost;
    s[i] = state;
  }
  /** Takes the cheapest state off the heap; its cost is in `cost` afterwards. */
  pop() {
    const { c, s } = this;
    const top = s[0];
    this.cost = c[0];
    const lc = c.pop();
    const ls = s.pop();
    if (c.length) {
      let i = 0;
      for (;;) {
        let m = i * 2 + 1;
        if (m >= c.length) break;
        if (m + 1 < c.length && c[m + 1] < c[m]) m++;
        if (c[m] >= lc) break;
        c[i] = c[m]; s[i] = s[m]; i = m;
      }
      c[i] = lc;
      s[i] = ls;
    }
    return top;
  }
}

/**
 * An orthogonal path from card a to card b that keeps CLEAR away from every card: the cheapest one
 * (length, bends, running along lines already drawn, hugging cards) on a grid made of the cards'
 * clearance lines, the middles of the gaps between them and the ports. A port is where a line meets
 * a card: the middle of a side, or on the top and bottom edges off the middle (the middle belongs to
 * the inheritance trees and is never used by a "uses" arrow). The path ends perpendicular to b's
 * border with a straight run long enough for the arrowhead.
 */
function routeOrthogonal(a, b, obstacles, kind, { resA = {}, resB = {}, occupied = [], heads = [], aKey = null, bKey = null } = {}) {
  const type = kind === 'uses' ? 'open' : 'tri';
  const stubA = CLEAR;
  const stubB = HEADS[type].len + 10;
  const cards = [a, b, ...obstacles];
  // Cards keep CLEAR around them; arrowheads already drawn cannot be crossed either (a head on a
  // or b itself is taken care of when the ports are spread).
  const cardZones = cards.map((r) => grow(r, CLEAR));
  const solid = cardZones.concat(heads);
  const near = obstacles.map((r) => grow(r, 3)).concat(heads.filter((h) => h.card !== aKey && h.card !== bKey));
  const headIn = (h0, at, lo, hi) => heads.some((h) => {
    const [s0, s1, t0, t1] = h0 ? [h.x, h.x + h.w, h.y, h.y + h.h] : [h.y, h.y + h.h, h.x, h.x + h.w];
    return at > t0 + 0.5 && at < t1 - 0.5 && Math.min(hi, s1) - Math.max(lo, s0) > 0.5;
  });
  const fallback = () => [clipToRect(a, centreOf(b)), clipToRect(b, centreOf(a))];
  const portsOf = (r, o, res, stub) => {
    const c = centreOf(r);
    const out = [];
    const add = (x, y, dx, dy, cost) => {
      const p = { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2, dx, dy, cost };
      p.s = { x: p.x + dx * stub, y: p.y + dy * stub };
      if (out.some((q) => q.x === p.x && q.y === p.y && q.dx === dx && q.dy === dy)) return;
      if (solid.some((s) => strictlyIn(p.s, s)) || near.some((n) => segmentHitsRect(p, p.s, n))) return;
      out.push(p);
    };
    const ys = [c.y];
    const oy0 = Math.max(r.y, o.y) + 12;
    const oy1 = Math.min(r.y + r.h, o.y + o.h) - 12;
    if (oy1 >= oy0) ys.push((oy0 + oy1) / 2);
    for (const y of ys) {
      add(r.x, y, -1, 0, 0);
      add(r.x + r.w, y, 1, 0, 0);
    }
    // On the top and bottom edges: the middle (where a tree's branch or trunk goes, if there is
    // one), 40px either side of it, and the middle of the stretch the two cards share, which gives
    // a straight line. A "uses" line prefers to stay off the middle.
    const off = Math.min(40, r.w / 4);
    const xs = [[c.x, kind === 'uses' ? 6 : 0], [c.x - off, kind === 'uses' ? 0 : 8], [c.x + off, kind === 'uses' ? 0 : 8]];
    const ox0 = Math.max(r.x, o.x) + 16;
    const ox1 = Math.min(r.x + r.w, o.x + o.w) - 16;
    if (ox1 >= ox0) xs.push([(ox0 + ox1) / 2, 0]);
    for (const [side, y, dy] of [['top', r.y, -1], ['bottom', r.y + r.h, 1]]) {
      for (const [x0, cost] of xs) {
        const x = Math.max(r.x + 14, Math.min(r.x + r.w - 14, x0));
        if ((res[side] || []).some((v) => Math.abs(v - x) < 16)) continue;
        add(x, y, 0, dy, cost);
      }
    }
    return out;
  };
  const pa = portsOf(a, b, resA, stubA);
  const pb = portsOf(b, a, resB, stubB);
  if (!pa.length || !pb.length) return fallback();

  // Most lines need no search: straight, one bend, or two bends through the middle of the gap,
  // when that keeps clear of every card and of the lines already drawn.
  const crosses = (p, q) => {
    const h = same(p.y, q.y);
    const lo = h ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
    const hi = h ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
    const at = h ? p.y : p.x;
    for (const s of solid) {
      const [s0, s1, t0, t1] = h ? [s.x, s.x + s.w, s.y, s.y + s.h] : [s.y, s.y + s.h, s.x, s.x + s.w];
      if (at > t0 + 0.5 && at < t1 - 0.5 && Math.min(hi, s1) - Math.max(lo, s0) > 0.5) return true;
    }
    for (const o of occupied) {
      if (h ? !same(o.y1, o.y2) : !same(o.x1, o.x2)) continue;
      const oat = h ? o.y1 : o.x1;
      const olo = h ? Math.min(o.x1, o.x2) : Math.min(o.y1, o.y2);
      const ohi = h ? Math.max(o.x1, o.x2) : Math.max(o.y1, o.y2);
      if (Math.abs(oat - at) < 7 && Math.min(hi, ohi) - Math.max(lo, olo) > 1) return true;
    }
    return false;
  };
  let quick = null;
  for (const p of pa) {
    for (const q of pb) {
      const A = p.s;
      const B = q.s;
      const vp = p.dx === 0;
      const vq = q.dx === 0;
      const tries = [];
      const ahead = (from, to, d) => (to - from) * d >= -0.01;
      if (vp && vq) {
        if (same(p.x, q.x) && ahead(p.y, q.y, p.dy) && ahead(q.y, p.y, q.dy)) tries.push([]);
        const my = Math.round(p.y + q.y) / 2;
        if (ahead(A.y, my, p.dy) && ahead(my, B.y, -q.dy)) tries.push([{ x: A.x, y: my }, { x: B.x, y: my }]);
      } else if (!vp && !vq) {
        if (same(p.y, q.y) && ahead(p.x, q.x, p.dx) && ahead(q.x, p.x, q.dx)) tries.push([]);
        const mx = Math.round(p.x + q.x) / 2;
        if (ahead(A.x, mx, p.dx) && ahead(mx, B.x, -q.dx)) tries.push([{ x: mx, y: A.y }, { x: mx, y: B.y }]);
      } else if (vp) {
        if (ahead(A.y, B.y, p.dy) && ahead(A.x, B.x, -q.dx)) tries.push([{ x: A.x, y: B.y }]);
      } else if (ahead(A.x, B.x, p.dx) && ahead(A.y, B.y, -q.dy)) tries.push([{ x: B.x, y: A.y }]);
      for (const corners of tries) {
        const inner = simplifyPath([A, ...corners, B]);
        if (inner.length >= 2 && inner.some((v, i) => i && crosses(inner[i - 1], v))) continue;
        const pts = simplifyPath([{ x: p.x, y: p.y }, ...inner, { x: q.x, y: q.y }]);
        if (pts.some((v, i) => i && !same(pts[i - 1].x, v.x) && !same(pts[i - 1].y, v.y))) continue;
        const len = pts.slice(1).reduce((s, v, i) => s + Math.abs(v.x - pts[i].x) + Math.abs(v.y - pts[i].y), 0);
        // A tiny jog in an otherwise straight line looks like a mistake.
        const jog = pts.slice(2, -1).some((v, i) => Math.abs(v.x - pts[i + 1].x) + Math.abs(v.y - pts[i + 1].y) < 16);
        const cost = len + (pts.length - 2) * BEND + p.cost + q.cost + (jog ? 80 : 0);
        if (!quick || cost < quick.cost) quick = { cost, pts };
      }
    }
  }
  if (quick) return quick.pts;
  // Search near the two cards first (most detours are short); the whole canvas only when that
  // finds no way.
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  const hi = { x: Math.max(a.x + a.w, b.x + b.w), y: Math.max(a.y + a.h, b.y + b.h) };
  return search({ x: lo.x - 160, y: lo.y - 160, w: hi.x - lo.x + 320, h: hi.y - lo.y + 320 }) || search(null) || fallback();

  function search(win) {
  const meets = (r) => !win || (r.x < win.x + win.w && r.x + r.w > win.x && r.y < win.y + win.h && r.y + r.h > win.y);
  const inWin = (v, axis) => !win || (axis === 'x' ? v >= win.x && v <= win.x + win.w : v >= win.y && v <= win.y + win.h);
  const local = cards.filter((r) => meets(grow(r, CLEAR)));
  const cardZones = local.map((r) => grow(r, CLEAR));
  const X = new Set();
  const Y = new Set();
  const ex = [];
  const ey = [];
  for (const r of local) {
    X.add(r.x - CLEAR); X.add(r.x + r.w + CLEAR);
    Y.add(r.y - CLEAR); Y.add(r.y + r.h + CLEAR);
    ex.push(r.x, r.x + r.w);
    ey.push(r.y, r.y + r.h);
  }
  const mids = (list, set) => {
    list.sort((p, q) => p - q);
    for (let i = 0; i + 1 < list.length; i++) if (list[i + 1] - list[i] > 2 * CLEAR) set.add(Math.round(list[i] + list[i + 1]) / 2);
  };
  mids(ex, X);
  mids(ey, Y);
  if (win) {
    X.add(win.x); X.add(win.x + win.w);
    Y.add(win.y); Y.add(win.y + win.h);
  }
  for (const p of [...pa, ...pb]) {
    X.add(p.s.x);
    Y.add(p.s.y);
  }
  // Inside the window the grid stays inside it, so only the cards that reach into it count.
  const xs = [...X].filter((v) => inWin(v, 'x')).sort((p, q) => p - q);
  const ys = [...Y].filter((v) => inWin(v, 'y')).sort((p, q) => p - q);
  const nx = xs.length;
  const ny = ys.length;
  const ix = new Map(xs.map((v, i) => [v, i]));
  const iy = new Map(ys.map((v, i) => [v, i]));
  // Per grid segment: blocked (runs through a card's clearance), and its extra cost.
  const hBlock = new Uint8Array(nx * ny);
  const vBlock = new Uint8Array(nx * ny);
  const hCost = new Float64Array(nx * ny);
  const vCost = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i + 1 < nx) {
        const m = { x: (xs[i] + xs[i + 1]) / 2, y: ys[j] };
        if (cardZones.some((s) => strictlyIn(m, s)) || headIn(true, ys[j], xs[i], xs[i + 1])) hBlock[k] = 1;
        else {
          // Hugging a card costs a little: lines keep to the middle of the gaps.
          let gap = 40;
          for (const r of local) if (r.x < xs[i + 1] && r.x + r.w > xs[i]) gap =Math.min(gap, Math.abs(ys[j] - r.y), Math.abs(ys[j] - r.y - r.h));
          hCost[k] = ((xs[i + 1] - xs[i]) * Math.max(0, 40 - gap)) / 40 * 0.5;
        }
      }
      if (j + 1 < ny) {
        const m = { x: xs[i], y: (ys[j] + ys[j + 1]) / 2 };
        if (cardZones.some((s) => strictlyIn(m, s)) || headIn(false, xs[i], ys[j], ys[j + 1])) vBlock[k] = 1;
        else {
          let gap = 40;
          for (const r of local) if (r.y < ys[j + 1] && r.y + r.h > ys[j]) gap =Math.min(gap, Math.abs(xs[i] - r.x), Math.abs(xs[i] - r.x - r.w));
          vCost[k] = ((ys[j + 1] - ys[j]) * Math.max(0, 40 - gap)) / 40 * 0.5;
        }
      }
    }
  }
  // Running along (or right next to) a line that is already drawn reads as one arrow: expensive.
  for (const o of occupied) {
    if (same(o.y1, o.y2)) {
      const lo = Math.min(o.x1, o.x2);
      const hi = Math.max(o.x1, o.x2);
      for (let j = 0; j < ny; j++) {
        const dy = Math.abs(ys[j] - o.y1);
        if (dy >= 7) continue;
        for (let i = 0; i + 1 < nx; i++) {
          const ov = Math.min(hi, xs[i + 1]) - Math.max(lo, xs[i]);
          if (ov > 0) hCost[j * nx + i] += ov * (dy < 3 ? 12 : 3);
        }
      }
    } else if (same(o.x1, o.x2)) {
      const lo = Math.min(o.y1, o.y2);
      const hi = Math.max(o.y1, o.y2);
      for (let i = 0; i < nx; i++) {
        const dx = Math.abs(xs[i] - o.x1);
        if (dx >= 7) continue;
        for (let j = 0; j + 1 < ny; j++) {
          const ov = Math.min(hi, ys[j + 1]) - Math.max(lo, ys[j]);
          if (ov > 0) vCost[j * nx + i] += ov * (dx < 3 ? 12 : 3);
        }
      }
    }
  }

  // Dijkstra over (grid point, direction of travel): 0 +x, 1 -x, 2 +y, 3 -y.
  const dirOf = (dx, dy) => (dx > 0 ? 0 : dx < 0 ? 1 : dy > 0 ? 2 : 3);
  const DX = [1, -1, 0, 0];
  const DY = [0, 0, 1, -1];
  const dist = new Float64Array(nx * ny * 4).fill(Infinity);
  const prev = new Int32Array(nx * ny * 4).fill(-1);
  const startPort = new Map();
  const heap = new Heap();
  // A*: the distance to the nearest end of the line never overestimates what is left.
  const toGoal = (n) => {
    const x = xs[n % nx];
    const y = ys[Math.floor(n / nx)];
    let m = Infinity;
    for (const q of pb) m = Math.min(m, Math.abs(q.s.x - x) + Math.abs(q.s.y - y));
    return m;
  };
  for (const p of pa) {
    const n = iy.get(p.s.y) * nx + ix.get(p.s.x);
    const s = n * 4 + dirOf(p.dx, p.dy);
    const c = stubA + p.cost;
    if (c < dist[s]) {
      dist[s] = c;
      startPort.set(s, p);
      heap.push(c + toGoal(n), s);
    }
  }
  const goals = new Map();
  for (const p of pb) {
    const n = iy.get(p.s.y) * nx + ix.get(p.s.x);
    if (!goals.has(n)) goals.set(n, []);
    goals.get(n).push(p);
  }
  let best = null;
  while (heap.size) {
    const s = heap.pop();
    const f = heap.cost;
    const c = dist[s];
    if (best && f >= best.cost) break;
    if (f - toGoal(s >> 2) > c + 1e-6) continue;
    const n = s >> 2;
    const d = s & 3;
    for (const p of goals.get(n) || []) {
      const need = dirOf(-p.dx, -p.dy);
      if (d === (need ^ 1)) continue;
      const total = c + stubB + p.cost + (d === need ? 0 : BEND);
      if (!best || total < best.cost) best = { cost: total, s, p };
    }
    const i = n % nx;
    const j = (n - i) / nx;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d ^ 1)) continue;
      const ni = i + DX[nd];
      const nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      let step;
      if (nd < 2) {
        const k = j * nx + Math.min(i, ni);
        if (hBlock[k]) continue;
        step = xs[Math.min(i, ni) + 1] - xs[Math.min(i, ni)] + hCost[k];
      } else {
        const k = Math.min(j, nj) * nx + i;
        if (vBlock[k]) continue;
        step = ys[Math.min(j, nj) + 1] - ys[Math.min(j, nj)] + vCost[k];
      }
      const nc = c + step + (nd === d ? 0 : BEND);
      const ns = (nj * nx + ni) * 4 + nd;
      if (nc < dist[ns]) {
        dist[ns] = nc;
        prev[ns] = s;
        heap.push(nc + toGoal(nj * nx + ni), ns);
      }
    }
  }
  if (!best) return null;
  const chain = [];
  let first = best.s;
  for (let s = best.s; s >= 0; s = prev[s]) {
    const n = s >> 2;
    chain.push({ x: xs[n % nx], y: ys[Math.floor(n / nx)] });
    first = s;
  }
  chain.reverse();
  const from = startPort.get(first);
  return simplifyPath([{ x: from.x, y: from.y }, ...chain, { x: best.p.x, y: best.p.y }]);
  }
}

/**
 * Everything the diagram draws for its relations, in diagram units.
 *
 * Inheritance as BlueJ and UML draw it: the subclasses that sit below their superclass hang in one
 * tree per superclass and kind (a branch up from each subclass to a shared bus, one trunk up to a
 * single hollow triangle on the superclass's bottom edge). A superclass with an "extends" and an
 * "implements" tree gets two trunks side by side; a class in two trees two branches. Every other
 * relation is an orthogonal line around the cards (routeOrthogonal) with its own port where it meets
 * a card. Lines never run through a card; the arrowhead's tip lies on the target card's border.
 *
 * rects: { key: { x, y, w, h } } of the cards; edges: from diagramEdges; extra: other rectangles the
 * lines keep clear of (the README note). Returns { trees, lines }:
 * trees: [{ id, to, kind, kids, px, bus, base, paths, routes: { kid: pts }, head }]
 * lines: [{ from, to, kind, pts, line, head }]
 */
export function routeDiagram(rects, edges, extra = []) {
  const boxes = Object.entries(rects).map(([k, r]) => ({ k, x: r.x, y: r.y, w: r.w, h: r.h })).concat(extra.map((r, i) => ({ k: '#extra' + i, x: r.x, y: r.y, w: r.w, h: r.h })));
  const except = (...ks) => boxes.filter((b) => !ks.includes(b.k));
  const blocked = (pts, obs) => {
    for (let i = 0; i + 1 < pts.length; i++) for (const o of obs) if (segmentHitsRect(pts[i], pts[i + 1], grow(o, 3))) return true;
    return false;
  };
  const mid = (k) => rects[k].x + rects[k].w / 2;

  // 1. Inheritance trees.
  const groups = new Map();
  for (const e of edges) {
    if (e.kind === 'uses') continue;
    const P = rects[e.to];
    const K = rects[e.from];
    if (!P || !K || K.y < P.y + P.h + DROP) continue;
    const id = e.to + '|' + e.kind;
    if (!groups.has(id)) groups.set(id, { id, to: e.to, kind: e.kind, kids: [] });
    groups.get(id).kids.push(e.from);
  }
  let trees = [...groups.values()];
  const shape = () => {
    const byParent = new Map();
    const byKid = new Map();
    for (const t of trees) {
      if (!byParent.has(t.to)) byParent.set(t.to, []);
      byParent.get(t.to).push(t);
      t.kx = {};
      for (const k of t.kids) {
        if (!byKid.has(k)) byKid.set(k, []);
        byKid.get(k).push(t);
      }
    }
    for (const [p, ts] of byParent) {
      const avg = (t) => t.kids.reduce((s, k) => s + mid(k), 0) / t.kids.length;
      ts.sort((a, b) => avg(a) - avg(b) || (a.kind < b.kind ? -1 : 1));
      ts.forEach((t, i) => { t.px = Math.round(mid(p) + (i - (ts.length - 1) / 2) * 28); });
    }
    for (const [k, ts] of byKid) {
      ts.sort((a, b) => a.px - b.px);
      ts.forEach((t, i) => { t.kx[k] = Math.round(mid(k) + (i - (ts.length - 1) / 2) * 16); });
    }
    for (const t of trees) {
      const P = rects[t.to];
      t.tip = { x: t.px, y: P.y + P.h };
      t.base = t.tip.y + HEADS.tri.len;
      t.top = Math.min(...t.kids.map((k) => rects[k].y));
      t.bus = Math.round(Math.max(t.base + 8, t.top - Math.min(24, (t.top - t.base) / 2)));
      const xs = [t.px, ...t.kids.map((k) => t.kx[k])];
      t.l = Math.min(...xs);
      t.r = Math.max(...xs);
    }
    // Two buses on one height that overlap would read as one: the later one moves.
    const placed = [];
    for (const t of [...trees].sort((a, b) => a.bus - b.bus || a.l - b.l)) {
      const clash = (y) => placed.some((o) => Math.abs(o.bus - y) < 6 && Math.min(t.r, o.r) - Math.max(t.l, o.l) > 1);
      const tries = [t.bus, t.bus - 10, t.bus + 10, t.bus - 20, t.bus + 20].filter((y) => y >= t.base + 6 && y <= t.top - 6);
      t.bus = tries.find((y) => !clash(y)) ?? t.bus;
      placed.push(t);
    }
  };
  // A subclass whose branch would cross another card is drawn as a line of its own; a tree whose
  // trunk would, too.
  for (let pass = 0; pass < 8 && trees.length; pass++) {
    shape();
    let changed = false;
    for (const t of trees) {
      if (blocked([{ x: t.px, y: t.bus }, { x: t.px, y: t.base }], except(t.to, ...t.kids))) {
        t.kids = [];
        changed = true;
        continue;
      }
      const keep = t.kids.filter((k) => !blocked([{ x: t.kx[k], y: rects[k].y }, { x: t.kx[k], y: t.bus }, { x: t.px, y: t.bus }], except(t.to, k)));
      if (keep.length !== t.kids.length) {
        t.kids = keep;
        changed = true;
      }
    }
    trees = trees.filter((t) => t.kids.length);
    if (!changed) break;
  }
  if (trees.length) shape();

  const reserved = {};
  const reserve = (k, side, x) => {
    if (!reserved[k]) reserved[k] = { top: [], bottom: [] };
    reserved[k][side].push(x);
  };
  const occupied = [];
  const occupy = (pts) => {
    for (let i = 0; i + 1 < pts.length; i++) occupied.push({ x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y });
  };
  const treeOut = trees.map((t) => {
    reserve(t.to, 'bottom', t.px);
    const items = t.kids.map((k) => ({ x: t.kx[k], y: rects[k].y })).concat([{ x: t.px, y: t.base }]);
    const paths = [];
    if (t.r - t.l < 1) {
      paths.push([{ x: t.px, y: Math.max(...items.map((i) => i.y)) }, { x: t.px, y: t.base }]);
    } else {
      const atL = items.filter((i) => Math.abs(i.x - t.l) < 1);
      const atR = items.filter((i) => Math.abs(i.x - t.r) < 1);
      const main = [];
      if (atL.length === 1) main.push({ x: t.l, y: atL[0].y });
      main.push({ x: t.l, y: t.bus }, { x: t.r, y: t.bus });
      if (atR.length === 1) main.push({ x: t.r, y: atR[0].y });
      paths.push(main);
      for (const i of items) {
        if ((atL.length === 1 && atL[0] === i) || (atR.length === 1 && atR[0] === i)) continue;
        paths.push([{ x: i.x, y: i.y }, { x: i.x, y: t.bus }]);
      }
    }
    for (const p of paths) occupy(p);
    const routes = {};
    for (const k of t.kids) {
      reserve(k, 'top', t.kx[k]);
      routes[k] = simplifyPath([{ x: t.kx[k], y: rects[k].y }, { x: t.kx[k], y: t.bus }, { x: t.px, y: t.bus }, { x: t.px, y: t.base }]);
    }
    const head = arrowHead([{ x: t.px, y: t.base }, t.tip], 'tri');
    return { id: t.id, to: t.to, kind: t.kind, kids: [...t.kids], px: t.px, bus: t.bus, base: t.base, paths, routes, head };
  });

  // 2. Everything else: inheritance first, then "uses", the short ones first.
  const inTree = new Set(treeOut.flatMap((t) => t.kids.map((k) => k + '>' + t.to + '>' + t.kind)));
  const span = (e) => Math.abs(mid(e.from) - mid(e.to)) + Math.abs(rects[e.from].y - rects[e.to].y);
  const rest = edges
    .filter((e) => rects[e.from] && rects[e.to] && e.from !== e.to && !inTree.has(e.from + '>' + e.to + '>' + e.kind))
    .sort((a, b) => (a.kind === 'uses') - (b.kind === 'uses') || span(a) - span(b));
  // No line runs through an arrowhead: the trees' triangles are known before the lines are routed;
  // a line that still crosses the head of another line is routed again with those heads in the way.
  const idOf = (e) => e.from + '>' + e.to + '>' + e.kind;
  const treeHeads = treeOut.map((t) => ({ ...t.head.box, card: t.to }));
  const route = (e, heads) => simplifyPath(routeOrthogonal(rects[e.from], rects[e.to], except(e.from, e.to), e.kind, { resA: reserved[e.from], resB: reserved[e.to], occupied, heads, aKey: e.from, bKey: e.to }));
  const raw = new Map();
  for (const e of rest) {
    const pts = route(e, treeHeads);
    occupy(pts);
    raw.set(idOf(e), pts);
  }
  // Spread copies of the routes, so a second pass can start again from the raw ones. The trunks
  // and branches of the trees stay where they are; lines keep 16px away from them.
  const pins = {};
  const pin = (id, v) => (pins[id] = pins[id] || []).push(v);
  for (const t of treeOut) {
    pin(t.to + ':b', t.px);
    for (const k of t.kids) pin(k + ':t', t.routes[k][0].x);
  }
  const finish = () => {
    const out = rest.map((e) => ({ from: e.from, to: e.to, kind: e.kind, pts: raw.get(idOf(e)).map((p) => ({ ...p })) }));
    spreadPorts(out.filter((l) => l.pts.length >= 2), rects, pins);
    const draw = (l) => {
      l.head = arrowHead(l.pts, l.kind === 'uses' ? 'open' : 'tri');
      l.line = l.head.line;
    };
    const treeBoxes = treeOut.map((t) => inner(t.head.box));
    for (const l of out) {
      const others = except(l.from, l.to).map((o) => grow(o, 6));
      const own = [grow(rects[l.from], -1), grow(rects[l.to], -1)];
      const ok = (p, q) => !others.some((o) => segmentHitsRect(p, q, o)) && !own.some((o) => segmentHitsRect(p, q, o)) && !treeBoxes.some((o) => segmentHitsRect(p, q, o));
      l.pts = straighten(l.pts, rects[l.from], rects[l.to], ok, HEADS[l.kind === 'uses' ? 'open' : 'tri'].len);
      draw(l);
    }
    // A port moved sideways must not push a long run of its line against a card or through an
    // arrowhead next to it; such a line keeps its own route.
    for (const l of out) {
      const others = except(l.from, l.to);
      const heads = out.filter((m) => m !== l).map((m) => m.head.box).concat(treeOut.map((t) => t.head.box));
      const hit = l.line.some((p, i) => i && (others.some((o) => segmentHitsRect(l.line[i - 1], p, grow(o, 2))) || heads.some((h) => segmentHitsRect(l.line[i - 1], p, inner(h)))));
      if (!hit) continue;
      l.pts = raw.get(idOf(l)).map((p) => ({ ...p }));
      draw(l);
    }
    return out;
  };
  const inner = (b) => ({ x: b.x + 2, y: b.y + 2, w: b.w - 4, h: b.h - 4 });
  let lines = finish();
  const crossing = (ls) => {
    const heads = ls.map((l) => ({ id: idOf(l), box: l.head.box })).concat(treeOut.map((t) => ({ id: t.id, box: t.head.box })));
    return ls.filter((l) => heads.some((h) => h.id !== idOf(l) && l.line.some((p, i) => i && segmentHitsRect(l.line[i - 1], p, inner(h.box)))));
  };
  for (let round = 0; round < 2; round++) {
    const bad = crossing(lines);
    if (!bad.length) break;
    const heads = treeHeads.concat(lines.map((l) => ({ ...l.head.box, card: l.to, id: idOf(l) })));
    for (const l of bad) {
      const id = idOf(l);
      const own = raw.get(id);
      // Its own segments do not count against it.
      occupied.splice(0, occupied.length, ...occupied.filter((o) => !own.some((p, i) => i && same(o.x1, own[i - 1].x) && same(o.y1, own[i - 1].y) && same(o.x2, p.x) && same(o.y2, p.y))));
      const pts = route(l, heads.filter((h) => h.id !== id));
      occupy(pts);
      raw.set(id, pts);
    }
    lines = finish();
  }
  return { trees: treeOut, lines };
}

const flowCache = new Map();

/**
 * The diagram's own layout while the user has not moved cards in a package, BlueJ style: every
 * inheritance tree is drawn tidy (a superclass centred above its subclasses, a level per row),
 * and the trees and the other classes are packed, in reading order, into bands no wider than
 * maxW. The order is the one that reads best (layoutScore): no arrow through a card, few
 * crossings, short "uses" arrows. A class that only uses others (a program with main) always sits
 * in a band of its own below the classes it uses: supertypes on top, users at the bottom, so the
 * picture keeps its direction when the panel changes size.
 */
export function flowLayout(model, keys, size, maxW, gapX = 40, gapY = 56) {
  const sig = [maxW, gapX, gapY, keys.map((k) => k + ':' + size(k).w + 'x' + size(k).h).join(','), model.edges.map((e) => e.from + '>' + e.to + e.kind).join(',')].join('|');
  if (flowCache.has(sig)) return flowCache.get(sig);
  const out = computeFlow(model, keys, size, maxW, gapX, gapY);
  if (flowCache.size > 60) flowCache.delete(flowCache.keys().next().value);
  flowCache.set(sig, out);
  return out;
}

function computeFlow(model, keys, size, maxW, gapX, gapY) {
  const left = 32;
  const right = left + maxW;
  const pkgKeys = keys.filter((k) => k.startsWith('pkg:')).sort();
  const inPkg = keys.filter((k) => !k.startsWith('pkg:'));
  const inSet = new Set(inPkg);
  // Each class hangs below one superclass of this package (the one it extends, else the first
  // interface it implements); a cycle in half-typed code just ends the chain.
  const primary = {};
  for (const c of inPkg) {
    const p = (model.byName[c]?.parents || []).find((q) => inSet.has(q) && q !== c);
    if (!p) continue;
    let up = p;
    let guard = 0;
    while (up && up !== c && guard++ < 30) up = primary[up];
    if (up !== c) primary[c] = p;
  }
  const kidsOf = {};
  for (const c of inPkg) if (primary[c]) (kidsOf[primary[c]] = kidsOf[primary[c]] || []).push(c);
  for (const k of Object.keys(kidsOf)) kidsOf[k].sort((a, b) => a.localeCompare(b));

  // A tidy tree, laid out on its own from (0, 0).
  const tree = (root) => {
    const rowH = [];
    const depthOf = {};
    const walk = (c, d) => {
      depthOf[c] = d;
      rowH[d] = Math.max(rowH[d] || 0, size(c).h);
      for (const k of kidsOf[c] || []) walk(k, d + 1);
    };
    walk(root, 0);
    const rowY = [0];
    for (let d = 1; d < rowH.length; d++) rowY[d] = rowY[d - 1] + rowH[d - 1] + gapY;
    const width = {};
    const span = (c) => {
      const kids = kidsOf[c] || [];
      const inner = kids.reduce((s, k) => s + span(k), 0) + gapX * Math.max(0, kids.length - 1);
      width[c] = Math.max(size(c).w, inner);
      return width[c];
    };
    span(root);
    const at = {};
    const place = (c, x0) => {
      const kids = kidsOf[c] || [];
      const w = size(c).w;
      if (!kids.length) {
        at[c] = { x: x0 + (width[c] - w) / 2, y: rowY[depthOf[c]] };
        return;
      }
      const inner = kids.reduce((s, k) => s + width[k], 0) + gapX * (kids.length - 1);
      let x = x0 + (width[c] - inner) / 2;
      for (const k of kids) {
        place(k, x);
        x += width[k] + gapX;
      }
      // Centred above the first and the last subclass.
      const a = at[kids[0]].x + size(kids[0]).w / 2;
      const b = at[kids[kids.length - 1]].x + size(kids[kids.length - 1]).w / 2;
      at[c] = { x: (a + b) / 2 - w / 2, y: rowY[depthOf[c]] };
    };
    place(root, 0);
    const minX = Math.min(...Object.keys(at).map((k) => at[k].x));
    for (const k of Object.keys(at)) at[k].x -= minX;
    return { keys: Object.keys(at), at, w: width[root], h: rowY[rowY.length - 1] + rowH[rowH.length - 1] };
  };
  const units = {};
  for (const c of inPkg) if (!primary[c]) units[c] = tree(c);

  const usedBy = {};
  for (const e of model.edges) if (e.kind === 'uses' && inSet.has(e.from) && inSet.has(e.to)) (usedBy[e.to] = usedBy[e.to] || new Set()).add(e.from);
  const usesCount = (c) => model.edges.filter((e) => e.kind === 'uses' && e.from === c && inSet.has(e.to)).length;
  const info = (c) => model.byName[c] || {};
  // Reading order when nothing else decides: trees first, then classes, programs, tests.
  const rank = (c) => (kidsOf[c] ? 0 : info(c).isTest ? 3 : info(c).hasMain ? 2 : 1);
  const roots = Object.keys(units).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  // Programs: classes nobody here uses that use several others; they get the band at the bottom.
  const drivers = roots.filter((c) => !kidsOf[c] && !usedBy[c] && !info(c).isTest && (info(c).hasMain || usesCount(c) >= 2));

  const pack = (bands) => {
    const at = {};
    let y = 32;
    const band = (list) => {
      let x = left;
      let h = 0;
      let any = false;
      for (const u of list) {
        const unit = units[u] || { keys: [u], at: { [u]: { x: 0, y: 0 } }, w: size(u).w, h: size(u).h };
        if (x > left && x + unit.w > right) {
          y += h + gapY;
          x = left;
          h = 0;
        }
        for (const k of unit.keys) at[k] = { x: Math.round(x + unit.at[k].x), y: Math.round(y + unit.at[k].y) };
        x += unit.w + gapX;
        h = Math.max(h, unit.h);
        any = true;
      }
      if (any) y += h + gapY;
    };
    if (pkgKeys.length) band(pkgKeys);
    for (const b of bands) band(b);
    return at;
  };

  // Every order of up to six units is tried; larger packages keep the reading order.
  const orders = (list) => (list.length > 6 ? [list] : list.length <= 1 ? [list] : list.flatMap((u, i) => orders([...list.slice(0, i), ...list.slice(i + 1)]).map((o) => [u, ...o])));
  const plans = drivers.length && drivers.length < roots.length
    ? orders(roots.filter((c) => !drivers.includes(c))).map((o) => [o, drivers])
    : orders(roots).map((o) => [o]);
  let best = null;
  plans.forEach((bands, i) => {
    const at = pack(bands);
    const sc = layoutScore(model, keys, at, size);
    const bottom = Math.max(0, ...keys.map((k) => at[k].y + size(k).h));
    const far = Math.max(0, ...keys.map((k) => at[k].x + size(k).w));
    // Tie-breaks: a compact picture, then the usual reading order.
    const cost = sc.hard * 100 + sc.soft + (bottom + far) / 4000 + i * 1e-6;
    if (!best || cost < best.cost) best = { cost, at };
  });
  return best ? best.at : pack([]);
}

/** autoLayout for every package of the project. */
export function layoutAll(model, positions) {
  let next = positions;
  for (const pkg of ['', ...model.packages]) next = autoLayout(model, next, pkg);
  return next;
}
