// The editor's own small glyphs, drawn like the app's icon family (24px grid, 1.6 stroke, round
// caps, one soft tinted area). File tabs show what a class is the way the diagram draws it: a UML
// card with its name compartment, dashed for an interface, a check for a test, stacked values
// for an enum; a folded page for the README.
import { createElement as h } from 'react';

const tint = { fill: 'currentColor', stroke: 'none', style: { opacity: 'var(--ico-tint, 0.2)' } };
const CARD = { x: 4, y: 4.5, width: 16, height: 15, rx: 3.2 };
const TOP = 'M4 9.6V7.7a3.2 3.2 0 0 1 3.2-3.2h9.6A3.2 3.2 0 0 1 20 7.7v1.9z';

const GLYPHS = {
  class: () => [h('path', { key: 't', ...tint, d: TOP }), h('rect', { key: 'c', ...CARD }), h('path', { key: 'l', d: 'M4 9.6h16M8 13.4h8M8 16.2h5' })],
  abstract: () => [h('path', { key: 't', ...tint, d: TOP, style: { opacity: 'calc(var(--ico-tint, 0.2) * 0.6)' } }), h('rect', { key: 'c', ...CARD }), h('path', { key: 'l', d: 'M4 9.6h16M9 16.5l3.5-4.5M12 16.5l3.5-4.5' })],
  interface: () => [h('path', { key: 't', ...tint, d: TOP }), h('rect', { key: 'c', ...CARD, strokeDasharray: '2.6 2.4' }), h('path', { key: 'l', d: 'M4 9.6h16' }), h('circle', { key: 'o', cx: 12, cy: 14.6, r: 2 })],
  enum: () => [h('path', { key: 't', ...tint, d: TOP }), h('rect', { key: 'c', ...CARD }), h('path', { key: 'l', d: 'M4 9.6h16' }), ...[12.6, 16].map((y, i) => h('circle', { key: 'd' + i, cx: 8.4, cy: y, r: 0.9, fill: 'currentColor', stroke: 'none' })), h('path', { key: 'm', d: 'M11 12.6h5M11 16h4' })],
  test: () => [h('path', { key: 't', ...tint, d: TOP }), h('rect', { key: 'c', ...CARD }), h('path', { key: 'l', d: 'M4 9.6h16M8.6 14.6l2.3 2.2 4.5-4.6' })],
  readme: () => [h('path', { key: 't', ...tint, d: 'M14 3.8v3.6a1.4 1.4 0 0 0 1.4 1.4H19z' }), h('path', { key: 'p', d: 'M14 3.8H7.4A2.4 2.4 0 0 0 5 6.2v11.6a2.4 2.4 0 0 0 2.4 2.4h9.2a2.4 2.4 0 0 0 2.4-2.4V8.8z' }), h('path', { key: 'l', d: 'M8.5 12.6h7M8.5 15.8h4.5' })],
  method: () => [h('path', { key: 'b', d: 'M8.5 5.5C6.3 7.4 5.2 9.6 5.2 12s1.1 4.6 3.3 6.5M15.5 5.5c2.2 1.9 3.3 4.1 3.3 6.5s-1.1 4.6-3.3 6.5' }), h('circle', { key: 'd', cx: 12, cy: 12, r: 1.7, fill: 'currentColor', stroke: 'none' })],
  ctor: () => [h('path', { key: 'b', d: 'M8.5 5.5C6.3 7.4 5.2 9.6 5.2 12s1.1 4.6 3.3 6.5M15.5 5.5c2.2 1.9 3.3 4.1 3.3 6.5s-1.1 4.6-3.3 6.5' }), h('path', { key: 'p', d: 'M12 9.3v5.4M9.3 12h5.4' })],
  field: () => [h('rect', { key: 't', ...tint, x: 7.5, y: 7.5, width: 9, height: 9, rx: 2, transform: 'rotate(45 12 12)' }), h('rect', { key: 'r', x: 7.5, y: 7.5, width: 9, height: 9, rx: 2, transform: 'rotate(45 12 12)' })],
  // The view menu: a page with its minimap strip.
  view: () => [h('path', { key: 't', ...tint, d: 'M15.5 4.5h1.3a3.2 3.2 0 0 1 3.2 3.2v8.6a3.2 3.2 0 0 1-3.2 3.2h-1.3z' }), h('rect', { key: 'c', x: 4, y: 4.5, width: 16, height: 15, rx: 3.2 }), h('path', { key: 'l', d: 'M15.5 4.5v15M7.5 9h4.5M7.5 12h5.5M7.5 15h3' })],
  chevron: () => [h('path', { key: 'c', d: 'M10 7.5l4.5 4.5-4.5 4.5' })],
  // Problems in this file: a small stop sign with a bar.
  problem: () => [h('path', { key: 't', ...tint, d: 'M9.1 4h5.8L20 9.1v5.8L14.9 20H9.1L4 14.9V9.1z' }), h('path', { key: 'o', d: 'M9.1 4h5.8L20 9.1v5.8L14.9 20H9.1L4 14.9V9.1z' }), h('path', { key: 'l', d: 'M12 8.2v4.6' }), h('circle', { key: 'd', cx: 12, cy: 15.8, r: 1.05, fill: 'currentColor', stroke: 'none' })],
};

export function EditorGlyph({ name, size = 14, className }) {
  const draw = GLYPHS[name] || GLYPHS.class;
  return h(
    'svg',
    { className: 'eg ' + (className || ''), width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' },
    ...draw(),
  );
}

/** Which card a file's tab shows. */
export function fileGlyph(info, name) {
  if (name === '#readme') return 'readme';
  if (!info) return 'class';
  if (info.isTest) return 'test';
  if (info.kind === 'interface') return 'interface';
  if (info.kind === 'enum') return 'enum';
  if (info.abstract || info.kind === 'abstract') return 'abstract';
  return 'class';
}
