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
export function autoLayout(model, positions, pkg = '', pitchX = 236, pitchY = 300) {
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

/** autoLayout for every package of the project. */
export function layoutAll(model, positions) {
  let next = positions;
  for (const pkg of ['', ...model.packages]) next = autoLayout(model, next, pkg);
  return next;
}
