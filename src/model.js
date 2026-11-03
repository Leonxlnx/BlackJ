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
    for (const p of c.extends) {
      const q = resolve(c, p);
      if (q) { edges.push({ from: c.fileClass, to: q, kind: 'extends' }); c.parents.push(q); }
    }
    for (const p of c.implements) {
      const q = resolve(c, p);
      if (q) { edges.push({ from: c.fileClass, to: q, kind: 'impl' }); c.parents.push(q); }
    }
    const own = new Set([c.simple, ...c.extends, ...c.implements]);
    for (const n of Object.keys(bySimple)) {
      if (own.has(n)) continue;
      if (!new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b').test(c.masked)) continue;
      const q = resolve(c, n);
      if (q && q !== c.fileClass) edges.push({ from: c.fileClass, to: q, kind: 'uses' });
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
 * Gives "uses" arrows that leave or enter a card's side at the same point a port each, 8px apart,
 * so two relations never share a segment and read as one arrow with a fork. An arrow that turns
 * off sooner takes the port on the side it turns to, so the spread arrows never cross. The routes
 * ({ from, to, pts }) are moved in place.
 */
export function spreadPorts(routes, rects) {
  const groups = new Map();
  for (const r of routes) {
    const n = r.pts.length;
    for (const [key, i, j, l] of [[r.from, 0, 1, 2], [r.to, n - 1, n - 2, n - 3]]) {
      const c = rects[key];
      const e = r.pts[i];
      const side = Math.abs(e.x - c.x) < 1 ? 'l' : Math.abs(e.x - c.x - c.w) < 1 ? 'r' : Math.abs(e.y - c.y) < 1 ? 't' : 'b';
      // On the left or right edge a port moves along y, on the top or bottom edge along x.
      const ax = side === 'l' || side === 'r' ? 'y' : 'x';
      const other = ax === 'y' ? 'x' : 'y';
      const next = r.pts[l] && l !== i ? Math.sign(r.pts[l][ax] - r.pts[j][ax]) : 0;
      const run = Math.abs(r.pts[j][other] - e[other]);
      const id = key + side + Math.round(e[ax]);
      if (!groups.has(id)) groups.set(id, { len: ax === 'y' ? c.h : c.w, ends: [] });
      groups.get(id).ends.push({ pts: [r.pts[i], r.pts[j]], ax, order: next < 0 ? run - 1e6 : next > 0 ? 1e6 - run : 0 });
    }
  }
  for (const { len, ends } of groups.values()) {
    if (ends.length < 2) continue;
    const step = Math.min(8, (len - 16) / (ends.length - 1));
    ends.sort((a, b) => a.order - b.order);
    ends.forEach((end, i) => {
      const d = (i - (ends.length - 1) / 2) * step;
      for (const p of end.pts) p[end.ax] += d;
    });
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
