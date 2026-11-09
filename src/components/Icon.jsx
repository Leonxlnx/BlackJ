import { useT } from '../i18n.js';
import '../styles/design.css';

/*
 * BlackJ's own icon family: 24px grid, 1.6 stroke, round caps and joins. Each icon carries one
 * small idea of its own (a spark struck by the hammer, motion ticks behind "run", a bug-shaped
 * breakpoint, a knob for settings) and at most one soft tinted area that gives it some depth.
 */
const r2 = (n) => Math.round(n * 100) / 100;
/** A four-point spark, the family's accent. */
export function sparkPath(cx, cy, r) {
  const k = r * 0.2;
  const p = (x, y) => r2(x) + ' ' + r2(y);
  return `M${p(cx, cy - r)}Q${p(cx + k, cy - k)} ${p(cx + r, cy)}Q${p(cx + k, cy + k)} ${p(cx, cy + r)}Q${p(cx - k, cy + k)} ${p(cx - r, cy)}Q${p(cx - k, cy - k)} ${p(cx, cy - r)}Z`;
}
// A soft fill under part of an icon (its strength comes from --ico-tint, set per theme).
const tint = { fill: 'currentColor', stroke: 'none', style: { opacity: 'var(--ico-tint, 0.2)' } };
// Solid marks keep a thin stroke so their corners stay round like the lines.
const solid = { fill: 'currentColor', strokeWidth: 0.8 };
const Dot = ({ x, y, r = 1.15, o }) => <circle cx={x} cy={y} r={r} fill="currentColor" stroke="none" opacity={o} />;
const FOLDER = 'M3.5 17.5v-11a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8l1.3 1.7h6.9a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z';
const FOLDER_TAB = 'M3.5 10V6.5a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8l1.3 1.7h6.9a2 2 0 0 1 2 2V10z';
const BUBBLE = 'M12 4.5c4.7 0 8 2.9 8 6.75S16.7 18 12 18c-.9 0-1.8-.1-2.6-.3L5.5 19.5l1.1-3.1C5 15.1 4 13.3 4 11.25 4 7.4 7.3 4.5 12 4.5z';
const PLAY = 'M9 6.9v10.2a1.2 1.2 0 0 0 1.8 1l8.3-5.1a1.2 1.2 0 0 0 0-2L10.8 5.9A1.2 1.2 0 0 0 9 6.9z';
const BACK_ARC = 'M5.94 9A7 7 0 1 1 5.24 14.31M5.9 4.6V9h4.4';
const OPEN_FRONT = 'M4 19.5l2.7-7.9a1.6 1.6 0 0 1 1.5-1.1h12.1a1 1 0 0 1 .9 1.3l-2.5 6.6a1.6 1.6 0 0 1-1.5 1.1z';
const HAMMER = { x: 10, y: 7.3, width: 8, height: 4.4, rx: 1.3, transform: 'rotate(45 14 9.5)' };
// Five petals: arcs that bulge out between five points close to the centre.
const BLOSSOM = 'M13.88 9.41A3 3 0 1 1 15.04 12.99A3 3 0 1 1 12 15.2A3 3 0 1 1 8.96 12.99A3 3 0 1 1 10.12 9.41A3 3 0 1 1 13.88 9.41z';

const P = {
  folder: <><path {...tint} d={FOLDER_TAB} /><path d={FOLDER} /><path d="M3.5 10h17" /></>,
  folderOpen: <><path {...tint} d={OPEN_FRONT} /><path d="M4 19.5v-13a2 2 0 0 1 2-2h2.7a2 2 0 0 1 1.6.8L11.5 7H17a2 2 0 0 1 2 2v1.5" /><path d={OPEN_FRONT} /></>,
  folderPlus: <><path {...tint} d={FOLDER_TAB} /><path d={FOLDER} /><path d="M3.5 10h17M12 12.25v5M9.5 14.75h5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  // run: play with two motion ticks behind it
  play: <><path {...tint} d={PLAY} /><path d={PLAY} /><path d="M3.75 9.5H6M3.75 14.5H6" /></>,
  stop: <><rect {...tint} x="6" y="6" width="12" height="12" rx="3" /><rect x="6" y="6" width="12" height="12" rx="3" /></>,
  pause: <><rect {...tint} x="6.5" y="5.5" width="3.75" height="13" rx="1.5" /><rect {...tint} x="13.75" y="5.5" width="3.75" height="13" rx="1.5" /><rect x="6.5" y="5.5" width="3.75" height="13" rx="1.5" /><rect x="13.75" y="5.5" width="3.75" height="13" rx="1.5" /></>,
  // compile: a hammer striking a spark
  build: <><rect {...tint} {...HAMMER} /><rect {...HAMMER} /><path d="M12.4 11.1L5.2 18.3" /><path {...solid} d={sparkPath(18.7, 16.7, 2.7)} /></>,
  // back to the start: the arrow returns to a dot
  reset: <><path d={BACK_ARC} /><Dot x={12} y={12.5} r={1.5} /></>,
  history: <><path d={BACK_ARC} /><path d="M12 9v3.5l2.5 1.5" /></>,
  // the tutor: a speech bubble with a spark
  tutor: <><path d={BUBBLE} /><path {...solid} d={sparkPath(12, 11.25, 3.4)} /></>,
  chat: <><path d={BUBBLE} /><path d="M9 10h6M9 13h3.5" /></>,
  explain: <><path d="M12 3.75a8.25 8.25 0 0 1 0 16.5c-1.4 0-2.7-.35-3.85-.95L4.5 20.25l.95-3.6A8.25 8.25 0 0 1 12 3.75z" /><path d="M9.6 9.7a2.45 2.45 0 1 1 3.5 2.2c-.7.35-1.1.95-1.1 1.7v.4" /><Dot x={12} y={16.4} r={1.1} /></>,
  // learn: an open book with a ribbon
  book: <><path d="M12 6.8C10.3 5.6 7.9 5 4.5 5v12.8c3.4 0 5.8.6 7.5 1.8 1.7-1.2 4.1-1.8 7.5-1.8V5c-3.4 0-5.8.6-7.5 1.8zM12 6.8v12.8" /><path {...solid} d="M15.2 5.4h2.8v5.4l-1.4-1.1-1.4 1.1z" /></>,
  // settings: a knob turned up, a 120° scale above it lit up to the pointer (no ring of dots:
  // at 16px that read as a sun)
  gear: <><circle {...tint} cx="12" cy="14.5" r="5.25" /><circle cx="12" cy="14.5" r="5.25" /><path d="M13.13 13.37l1.42-1.42" /><path d="M4.42 10.13A8.75 8.75 0 0 1 18.19 8.31" /><path d="M18.19 8.31A8.75 8.75 0 0 1 19.58 10.13" strokeOpacity="0.35" /></>,
  // the class diagram: two linked cards, the parent above the child
  grid: <><rect {...tint} x="3.5" y="3.5" width="11" height="5.5" rx="2" /><rect x="3.5" y="3.5" width="11" height="5.5" rx="2" /><rect x="9.5" y="15" width="11" height="5.5" rx="2" /><path d="M12 9l2.1 2.8H9.9zM12 11.8V15" /></>,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  more: <><Dot x={5.5} y={12} r={1.5} /><Dot x={12} y={12} r={1.5} /><Dot x={18.5} y={12} r={1.5} /></>,
  send: <path d="M5 12h13M13 7l5 5-5 5" />,
  arrowUp: <path d="M12 19V5.5M6.5 11L12 5.5l5.5 5.5" />,
  pencil: <><path d="M5 19l.8-3.6L15.5 5.7a1.9 1.9 0 0 1 2.7 0l.1.1a1.9 1.9 0 0 1 0 2.7L8.6 18.2z" /><path d="M13.6 7.6l2.8 2.8" /><path {...solid} d="M5 19l.8-3.6 2.8 2.8z" /></>,
  copy: <><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /><rect {...tint} x="8.5" y="8.5" width="11" height="11" rx="2.2" /><rect x="8.5" y="8.5" width="11" height="11" rx="2.2" /></>,
  insert: <><rect {...tint} x="3.5" y="8" width="11" height="11.5" rx="2" /><path d="M14.5 10.5V10a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V16" /><path d="M20.5 4.5v5.75a3 3 0 0 1-3 3H9M11.75 10.5L9 13.25 11.75 16" /></>,
  eye: <><path d="M2.75 12C4.6 8.1 8 5.75 12 5.75S19.4 8.1 21.25 12C19.4 15.9 16 18.25 12 18.25S4.6 15.9 2.75 12z" /><circle {...tint} cx="12" cy="12" r="3.1" /><circle cx="12" cy="12" r="3.1" /><Dot x={12} y={12} r={1.15} /></>,
  // the lid is lifted
  trash: <><path transform="rotate(-12 5 8.5)" d="M5 8.5h14M9.8 8.5V7a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1v1.5" /><path {...tint} d="M6.3 11h11.4l-.85 7.6a2 2 0 0 1-2 1.9h-5.7a2 2 0 0 1-2-1.9z" /><path d="M6.3 11l.85 7.6a2 2 0 0 0 2 1.9h5.7a2 2 0 0 0 2-1.9l.85-7.6M10.2 13.8v3.4M13.8 13.8v3.4" /></>,
  chevron: <path d="M7 10l5 5 5-5" />,
  chevronUp: <path d="M7 14l5-5 5 5" />,
  external: <path d="M10.5 4.5h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4M14.5 4.5h5v5M19.5 4.5L12 12" />,
  fit: <><path d="M4.5 9V6.5a2 2 0 0 1 2-2H9M15 4.5h2.5a2 2 0 0 1 2 2V9M19.5 15v2.5a2 2 0 0 1-2 2H15M9 19.5H6.5a2 2 0 0 1-2-2V15" /><Dot x={12} y={12} r={1.6} /></>,
  layers: <><path {...tint} d="M12 4l8.5 4.3L12 12.6 3.5 8.3z" /><path d="M12 4l8.5 4.3L12 12.6 3.5 8.3zM3.5 12.2L12 16.5l8.5-4.3M3.5 16.1L12 20.4l8.5-4.3" /></>,
  save: <><path d="M6.5 4.5h9.1l3.9 3.9v9.6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2zM8.5 4.5V8a1 1 0 0 0 1 1h4.5a1 1 0 0 0 1-1V4.5" /><path {...tint} d="M8 20v-5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V20z" /><path d="M8 19.5v-5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v5" /></>,
  indent: <path d="M4 5.5h16M10.5 10h9.5M10.5 14h9.5M4 18.5h16M4.5 9.5L7 12l-2.5 2.5" />,
  file: <><path d="M7.5 3.5H14l4.5 4.5v10.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" /><path {...tint} d="M14 3.5V7a1 1 0 0 0 1 1h3.5z" /><path d="M14 3.5V7a1 1 0 0 0 1 1h3.5M9 12.5h6M9 16h3.5" /></>,
  // a glint on the lens
  search: <><circle cx="10.75" cy="10.75" r="6.25" /><path d="M15.4 15.4L20 20M7.37 9.52a3.6 3.6 0 0 1 2.15-2.15" /></>,
  check: <path d="M4.5 12.75l4.75 4.75L19.5 7" />,
  // a block cursor waits after the prompt
  terminal: <><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M7 9.5l2.75 2.5L7 14.5" /><rect {...solid} x="12.4" y="10.6" width="2.8" height="3.8" rx=".5" /></>,
  code: <path d="M8 7.5L3.75 12 8 16.5M16 7.5l4.25 4.5L16 16.5M13.5 5.5l-3 13" />,
  // light and dark: the sun is half night
  sun: <><circle cx="12" cy="12" r="4.25" /><path {...solid} d="M12 7.75a4.25 4.25 0 0 0 0 8.5z" /><path d="M12 2.75v1.5M12 19.75v1.5M2.75 12h1.5M19.75 12h1.5M5.45 5.45l1.06 1.06M17.49 17.49l1.06 1.06M5.45 18.55l1.06-1.06M17.49 6.51l1.06-1.06" /></>,
  moon: <><path {...tint} d="M19.5 14.6A7.75 7.75 0 1 1 9.4 4.5a6.25 6.25 0 0 0 10.1 10.1z" /><path d="M19.5 14.6A7.75 7.75 0 1 1 9.4 4.5a6.25 6.25 0 0 0 10.1 10.1z" /><path {...solid} d={sparkPath(16.6, 7, 2.1)} /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path {...tint} d="M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5z" /><path d="M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5zM3.5 12h17" /></>,
  record: <><circle cx="12" cy="12" r="7.5" /><Dot x={12} y={12} r={3.5} /></>,
  sidebar: <><path {...tint} d="M14.5 4.5H18a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-3.5z" /><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M14.5 4.5v15" /></>,
  layout: <><path {...tint} d="M3 13.5h18v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" /><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M3 13.5h18M10.5 4.5v9" /></>,
  window: <><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M3 9h18" /><Dot x={6} y={6.75} r={0.8} /><Dot x={8.5} y={6.75} r={0.8} /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="3" /><Dot x={6.5} y={10} r={0.95} /><Dot x={10.17} y={10} r={0.95} /><Dot x={13.83} y={10} r={0.95} /><Dot x={17.5} y={10} r={0.95} /><path d="M8 14.25h8" /></>,
  image: <><rect x="3" y="4.5" width="18" height="15" rx="3" /><Dot x={8.5} y={9.5} r={1.6} /><path d="M3.5 17.5l4.6-4.6a1.2 1.2 0 0 1 1.7 0l3.7 3.7 1.6-1.6a1.2 1.2 0 0 1 1.7 0l3 3" /></>,
  // tidy up: a parent card above two children
  arrange: <><rect {...tint} x="8.5" y="3.5" width="7" height="5" rx="1.6" /><rect x="8.5" y="3.5" width="7" height="5" rx="1.6" /><rect x="3.5" y="15.5" width="7" height="5" rx="1.6" /><rect x="13.5" y="15.5" width="7" height="5" rx="1.6" /><path d="M12 8.5V12M7 15.5V13a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2.5" /></>,
  // a dashed relation between two classes
  link: <><circle cx="6" cy="18" r="2.5" /><circle {...tint} cx="18" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M7.9 16.1l8.2-8.2" strokeDasharray="1.2 4" /></>,
  uses: <><path d="M5 19L16.6 7.4" strokeDasharray="1.2 3.85" /><path d="M11.5 6h6.5v6.5" /></>,
  // a class card: name, attributes, methods
  details: <><path {...tint} d="M4.5 8.5V6A2.5 2.5 0 0 1 7 3.5h10A2.5 2.5 0 0 1 19.5 6v2.5z" /><rect x="4.5" y="3.5" width="15" height="17" rx="2.5" /><path d="M4.5 8.5h15M4.5 14h15M7.5 11.25h6M7.5 17.25h8" /></>,
  stepOver: <><path d="M5 14.5C5.6 10.3 8.5 7.5 12 7.5s6.4 2.8 7 7M16.7 12.7l2.3 1.8 1.9-2.2" /><Dot x={12} y={16} r={1.7} /></>,
  stepInto: <><path d="M12 3.5V13M8 9l4 4 4-4" /><Dot x={12} y={18.5} r={1.9} /></>,
  stepOut: <><path d="M12 13V3.5M8 7.5l4-4 4 4" /><Dot x={12} y={18.5} r={1.9} /></>,
  // UML: the hollow triangle points from the child to its parent
  inherit: <><path d="M12 18.9v-7.4M12 4l5 7.5H7z" /><Dot x={12} y={20.3} r={1.6} /></>,
  printer: <><path d="M7 8.5v-4h10v4M7 17.5H5.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H17" /><path {...tint} d="M7 14h10v6H7z" /><path d="M7 14h10v6H7z" /><Dot x={17.25} y={11.5} r={0.95} /></>,
  download: <path d="M12 4v10.5M7.5 10l4.5 4.5 4.5-4.5M4.5 16.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1.5" />,
  // the object bench: a little table with things on it
  bench: <><rect {...tint} x="4.75" y="8" width="6.5" height="7" rx="1.6" /><rect x="4.75" y="8" width="6.5" height="7" rx="1.6" /><circle cx="16.25" cy="11.75" r="3.25" /><path d="M3 15h18M6.5 15v3.5M17.5 15v3.5" /></>,
  // the debugger: a breakpoint dot that grew legs
  bug: <><circle {...tint} cx="12" cy="13.5" r="5" /><circle cx="12" cy="13.5" r="5" /><path d="M12 8.5v10M10.3 8.8L8.6 5.6M13.7 8.8l1.7-3.2M7.1 11.6L4.6 10.4M7.1 15.4l-2.5 1.2M16.9 11.6l2.5-1.2M16.9 15.4l2.5 1.2" /></>,
  spark: <><path d={sparkPath(10.5, 13, 7)} /><path {...solid} d={sparkPath(18.5, 5.5, 2.4)} /></>,
  bulb: <><path d="M9.2 16c0-1.3-.5-2.1-1.3-3A5.6 5.6 0 1 1 16.1 13c-.8.9-1.3 1.7-1.3 3zM9.6 18.75h4.8M10.6 21.25h2.8" /><path {...solid} d={sparkPath(12, 9.2, 2.5)} /></>,
  blocks: <><rect x="3.5" y="13" width="7.5" height="7" rx="1.6" /><rect x="13" y="13" width="7.5" height="7" rx="1.6" /><rect {...tint} x="8.25" y="4" width="7.5" height="7" rx="1.6" /><rect x="8.25" y="4" width="7.5" height="7" rx="1.6" /></>,
  wand: <><path d="M4.5 19.5l9-9" /><path {...solid} d={sparkPath(17.25, 6.75, 3.3)} /><Dot x={11.5} y={4.5} r={0.95} /><Dot x={19.5} y={12.5} r={0.95} /></>,
  cube: <><path {...tint} d="M12 3.5l7.5 4.25L12 12 4.5 7.75z" /><path d="M12 3.5l7.5 4.25v8.5L12 20.5l-7.5-4.25v-8.5zM4.5 7.75L12 12l7.5-4.25M12 12v8.5" /></>,
  flask: <><path {...tint} d="M7.27 14.5h9.46l2 3.4a1.7 1.7 0 0 1-1.48 2.6H6.75a1.7 1.7 0 0 1-1.45-2.6z" /><path d="M9.5 3.5h5M10.5 3.5v5.4l-5.2 9a1.7 1.7 0 0 0 1.45 2.6h10.5a1.7 1.7 0 0 0 1.45-2.6l-5.2-9V3.5" /></>,
  undo: <path d="M8.5 6.5l-4 4 4 4M4.5 10.5h10.25a4.75 4.75 0 0 1 0 9.5H11.5" />,
  redo: <path d="M15.5 6.5l4 4-4 4M19.5 10.5H9.25a4.75 4.75 0 0 0 0 9.5h3.25" />,
  maximize: <path d="M13.5 4.5h6v6M10.5 19.5h-6v-6M19.5 4.5L14 10M4.5 19.5L10 14" />,
  minimize: <path d="M14 4.5V10h5.5M10 19.5V14H4.5M14 10l5.5-5.5M10 14l-5.5 5.5" />,
  resize: <path d="M19.5 13.5l-6 6M19.5 8.5l-11 11" />,
  grip: <><Dot x={9} y={6} r={1.4} /><Dot x={15} y={6} r={1.4} /><Dot x={9} y={12} r={1.4} /><Dot x={15} y={12} r={1.4} /><Dot x={9} y={18} r={1.4} /><Dot x={15} y={18} r={1.4} /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><Dot x={12} y={7.9} r={1.1} /></>,
  warning: <><path {...tint} d="M10.27 4.9a2 2 0 0 1 3.46 0l6.9 12a2 2 0 0 1-1.73 3H5.1a2 2 0 0 1-1.73-3z" /><path d="M10.27 4.9a2 2 0 0 1 3.46 0l6.9 12a2 2 0 0 1-1.73 3H5.1a2 2 0 0 1-1.73-3zM12 9.5v4" /><Dot x={12} y={16.6} r={1.05} /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  bolt: <><path {...tint} d="M13.5 3L5.5 13.5h6L10.5 21l8-10.5h-6z" /><path d="M13.5 3L5.5 13.5h6L10.5 21l8-10.5h-6z" /></>,
  sliders: <><path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20" /><circle {...tint} cx="15" cy="7.5" r="2.5" /><circle cx="15" cy="7.5" r="2.5" /><circle {...tint} cx="9" cy="16.5" r="2.5" /><circle cx="9" cy="16.5" r="2.5" /></>,
  // Java: a cup with steam
  cup: <><path {...tint} d="M4.5 9.5h12v5a4.5 4.5 0 0 1-4.5 4.5h-3a4.5 4.5 0 0 1-4.5-4.5z" /><path d="M4.5 9.5h12v5a4.5 4.5 0 0 1-4.5 4.5h-3a4.5 4.5 0 0 1-4.5-4.5zM16.5 11h1.25a2.25 2.25 0 0 1 0 4.5H16.3M8.5 3.5c-.9 1.1.9 2.1 0 3.2M12.5 3.5c-.9 1.1.9 2.1 0 3.2" /></>,
  // the three Claude models: a gem (Opus), a quill (Sonnet), a blossom (Haiku)
  gem: <><path {...tint} d="M7 4.5h10l3.5 4.5h-17z" /><path d="M7 4.5h10l3.5 4.5L12 20 3.5 9zM3.5 9h17M9 9l3 11 3-11" /></>,
  feather: <><path {...tint} d="M19.5 4.5c-6.8.4-11.4 4.6-12 11.4l-.1 1.3 1.3-.1C15.5 16.5 19.1 12 19.5 4.5z" /><path d="M19.5 4.5c-6.8.4-11.4 4.6-12 11.4l-.1 1.3 1.3-.1C15.5 16.5 19.1 12 19.5 4.5zM4.5 19.5L15 9M10.75 13.25h3" /></>,
  blossom: <><path {...tint} d={BLOSSOM} /><path d={BLOSSOM} /><Dot x={12} y={12} r={1.35} /></>,
};

// Other names for the same drawings, so code can say what it means.
const ALIAS = { compile: 'build', run: 'play', diagram: 'grid', settings: 'gear', learn: 'book', debug: 'bug', debugger: 'bug', console: 'terminal', hints: 'bulb', arrowRight: 'send', object: 'cube', tests: 'flask', java: 'cup', opus: 'gem', sonnet: 'feather', haiku: 'blossom', leaf: 'blossom' };
export const ICON_NAMES = Object.keys(P);
export const ICON_ALIASES = ALIAS;

export default function Icon({ name, className, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className ? 'ico ' + className : 'ico'} {...rest}>
      {P[name] || P[ALIAS[name]] || null}
    </svg>
  );
}

/** A quiet "Why?" disclosure: the explanation stays folded until someone wants it. */
export function Why({ children }) {
  const t = useT();
  return (
    <details className="why">
      <summary>
        {t('common.why')}
        <Icon name="chevron" />
      </summary>
      <div className="why-body">{children}</div>
    </details>
  );
}

export function Select({ value, onChange, children, ...rest }) {
  return (
    <span className="select-wrap">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
        {children}
      </select>
      <Icon name="chevron" />
    </span>
  );
}
