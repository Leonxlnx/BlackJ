// The workspace layout: a tree of splits (rows and columns) with the four panels as leaves.
// Sizes are fractions of their split. A hidden panel (the closed side panel, a pop-out window)
// keeps its place in the tree, so it comes back where it was.

export const PANELS = ['diagram', 'editor', 'dock', 'side'];
export const POPPABLE = ['editor', 'dock', 'side'];

/** The smallest size (px) at which a panel still works. */
export const MIN = {
  diagram: { w: 240, h: 160 },
  editor: { w: 320, h: 160 },
  dock: { w: 280, h: 120 },
  side: { w: 280, h: 200 },
};
export const GAP = 8;

export function defaultLayout() {
  return {
    id: 'root', dir: 'row', sizes: [0.73, 0.27], children: [
      { id: 'main', dir: 'col', sizes: [0.68, 0.32], children: [
        { id: 'top', dir: 'row', sizes: [0.42, 0.58], children: [{ panel: 'diagram' }, { panel: 'editor' }] },
        { panel: 'dock' },
      ] },
      { panel: 'side' },
    ],
  };
}

const uid = () => 's' + Math.random().toString(36).slice(2, 8);
const norm = (sizes) => {
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((s) => s / sum);
};

export function leaves(node) {
  return node.panel ? [node.panel] : node.children.flatMap(leaves);
}

/** A stored tree is used only if it still holds every panel exactly once, with numeric sizes and unique split ids. */
export function isValid(tree) {
  const ids = new Set();
  const ok = (n) => {
    if (!n || typeof n !== 'object') return false;
    if (n.panel) return PANELS.includes(n.panel);
    if (typeof n.id !== 'string' || !n.id || ids.has(n.id)) return false;
    ids.add(n.id);
    return (n.dir === 'row' || n.dir === 'col') && Array.isArray(n.children) && n.children.length >= 2 && Array.isArray(n.sizes) &&
      n.sizes.length === n.children.length && n.sizes.every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0) && n.children.every(ok);
  };
  return ok(tree) && [...leaves(tree)].sort().join() === [...PANELS].sort().join();
}

/** Splits with one child disappear, and a split inside a split of the same direction joins it. */
function tidy(node) {
  if (node.panel) return node;
  const children = [];
  const sizes = [];
  node.children.forEach((c, i) => {
    const t = tidy(c);
    if (!t.panel && t.dir === node.dir) {
      t.children.forEach((g, j) => {
        children.push(g);
        sizes.push(node.sizes[i] * t.sizes[j]);
      });
    } else {
      children.push(t);
      sizes.push(node.sizes[i]);
    }
  });
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: norm(sizes) };
}

export function removePanel(node, p) {
  const walk = (n) => {
    if (n.panel) return n.panel === p ? null : n;
    const children = [];
    const sizes = [];
    n.children.forEach((c, i) => {
      const r = walk(c);
      if (r) {
        children.push(r);
        sizes.push(n.sizes[i]);
      }
    });
    if (!children.length) return null;
    return { ...n, children, sizes: norm(sizes) };
  };
  return tidy(walk(node));
}

/** Puts panel p next to `target` (a panel, or 'root' for the whole workspace) on side `zone`. */
export function insertPanel(node, p, target, zone) {
  const dir = zone === 'left' || zone === 'right' ? 'row' : 'col';
  const before = zone === 'left' || zone === 'top';
  const leaf = { panel: p };
  if (target === 'root') {
    const share = 0.28;
    if (!node.panel && node.dir === dir) {
      const rest = node.sizes.map((s) => s * (1 - share));
      return tidy({ ...node, children: before ? [leaf, ...node.children] : [...node.children, leaf], sizes: before ? [share, ...rest] : [...rest, share] });
    }
    return tidy({ id: uid(), dir, children: before ? [leaf, node] : [node, leaf], sizes: before ? [share, 1 - share] : [1 - share, share] });
  }
  const walk = (n) => {
    if (n.panel) return n.panel === target ? { id: uid(), dir, children: before ? [leaf, n] : [n, leaf], sizes: [0.5, 0.5] } : n;
    const i = n.children.findIndex((c) => c.panel === target);
    if (i >= 0 && n.dir === dir) {
      const half = n.sizes[i] / 2;
      const children = [...n.children];
      const sizes = [...n.sizes];
      children.splice(before ? i : i + 1, 0, leaf);
      sizes.splice(i, 1, half, half);
      return { ...n, children, sizes };
    }
    return { ...n, children: n.children.map(walk) };
  };
  return tidy(walk(node));
}

export function movePanel(tree, p, target, zone) {
  if (p === target) return tree;
  return insertPanel(removePanel(tree, p), p, target, zone);
}

export function setSizes(tree, id, sizes) {
  const walk = (n) => (n.panel ? n : n.id === id ? { ...n, sizes: norm(sizes) } : { ...n, children: n.children.map(walk) });
  return walk(tree);
}

/** Double-click on a splitter: the split goes back to its first sizes (or equal parts). */
export function resetSizes(tree, id) {
  const find = (n) => (n.panel ? null : n.id === id ? n : n.children.map(find).find(Boolean) || null);
  const now = find(tree);
  if (!now) return tree;
  const orig = find(defaultLayout());
  const same = orig && orig.children.length === now.children.length && orig.children.every((c, i) => leaves(c).join() === leaves(now.children[i]).join());
  return setSizes(tree, id, same ? orig.sizes : now.children.map(() => 1));
}

/** The smallest size of a subtree with only the shown panels; null when nothing in it is shown. */
export function minSize(node, shown) {
  if (node.panel) return shown(node.panel) ? MIN[node.panel] : null;
  const kids = node.children.map((c) => minSize(c, shown)).filter(Boolean);
  if (!kids.length) return null;
  const gaps = GAP * (kids.length - 1);
  return node.dir === 'row'
    ? { w: kids.reduce((s, k) => s + k.w, 0) + gaps, h: Math.max(...kids.map((k) => k.h)) }
    : { w: Math.max(...kids.map((k) => k.w)), h: kids.reduce((s, k) => s + k.h, 0) + gaps };
}

/** Which side of a rectangle a point is closest to. */
export function zoneOf(rect, x, y) {
  const d = { left: (x - rect.left) / rect.width, right: (rect.right - x) / rect.width, top: (y - rect.top) / rect.height, bottom: (rect.bottom - y) / rect.height };
  return Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
}

/** The part of `rect` a panel dropped on `zone` would take. */
export function previewRect(rect, zone, share = 0.5) {
  const w = rect.width * share;
  const h = rect.height * share;
  if (zone === 'left') return { left: rect.left, top: rect.top, width: w, height: rect.height };
  if (zone === 'right') return { left: rect.right - w, top: rect.top, width: w, height: rect.height };
  if (zone === 'top') return { left: rect.left, top: rect.top, width: rect.width, height: h };
  return { left: rect.left, top: rect.bottom - h, width: rect.width, height: h };
}
