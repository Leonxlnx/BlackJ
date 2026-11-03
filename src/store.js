// One small global store. Components read slices with useStore(selector).
import { useSyncExternalStore } from 'react';
import { defaultLayout } from './lib/layout.js';

let state = {
  ready: false,
  info: null,
  settings: { lang: 'de', theme: 'dark', fontSize: 14, hoverHelp: true, autosave: true, diagramDetails: true, scopeColors: true, aiInline: true, model: 'claude-opus-5-5', tutorMode: 'hints', sendContext: true, agentWrite: false, showCosts: false, rememberKey: true, recent: [] },
  pkg: '',
  pad: { entries: [], vars: [], busy: false },
  tests: { running: false, summary: null, results: [] },
  recording: null,
  breakpoints: {},
  debug: { attached: false, paused: null },
  inspect: null,
  side: 'tutor',
  palette: null,
  view: 'home',
  project: null,
  files: {},
  positions: {},
  compile: { state: 'never', problems: [], snapshot: {}, ms: 0 },
  bench: { state: 'off', objects: [], java: null },
  classInfo: {},
  console: [],
  exception: null,
  tabs: [],
  activeTab: null,
  reveal: null,
  dock: 'objects',
  tutorOpen: true,
  layout: { tree: defaultLayout(), detached: [] },
  activeWin: 'main',
  chat: { turns: [], busy: false, mode: 'hints', notes: [], hiddenChips: {} },
  agent: { proposals: {} },
  tour: null,
  lastTour: null,
  dialog: null,
  menu: null,
  toast: null,
  selectedClass: null,
  highlightClass: null,
};

const listeners = new Set();
// One observer of every change with the patch and the state before it (panels.js keeps pop-out
// windows in step through it).
let patchHook = null;

export function getState() {
  return state;
}

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  const prev = state;
  state = { ...state, ...next };
  if (patchHook && next) patchHook(next, prev);
  for (const l of listeners) l();
}

export function onPatch(fn) {
  patchHook = fn;
}

export function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore(selector) {
  return useSyncExternalStore(subscribe, () => selector(state));
}

let toastTimer = null;
export function toast(text, kind = 'info') {
  clearTimeout(toastTimer);
  setState({ toast: { text, kind, id: Date.now() } });
  toastTimer = setTimeout(() => setState({ toast: null }), 4200);
}
