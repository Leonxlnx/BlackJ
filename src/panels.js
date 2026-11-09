// Pop-out windows: the editor, the dock or the side panel in an OS window of their own.
// The main window stays the one owner of the state (file contents, compile results, the bench).
// A pop-out mirrors the slices its panel shows, runs every action in the main window, and sends
// its own changes (typing, a tab switch, a dialog it opens) back as patches. The main process
// only relays the messages (electron/main.cjs, "panel:send").
import * as real from './actions.js';
import { getState, setState, onPatch } from './store.js';
import { api } from './api.js';

export const PANEL = new URLSearchParams(window.location.search).get('panel');
/** Which window this is: 'main' or the panel it shows. Dialogs and toasts appear in the active one. */
export const WIN = PANEL || 'main';

const COMMON = [
  'info', 'settings', 'project', 'files', 'readme', 'pkg', 'compile', 'exception', 'tabs', 'activeTab', 'breakpoints', 'debug',
  'agent', 'aiBusy', 'editorSelection', 'cursor', 'editorMode', 'selectedClass', 'highlightClass', 'tutorOpen', 'side', 'dock',
  'dockCollapsed', 'dialog', 'toast', 'activeWin', 'bench', 'classInfo', 'inspect',
];
const KEYS = {
  editor: [...COMMON, 'reveal', 'insertRequest', 'agentHighlight'],
  dock: [...COMMON, 'console', 'pad', 'tests', 'recording'],
  side: [...COMMON, 'chat', 'lastTour', 'tutorDraft', 'tour', 'agentShots'],
};

// These run in the pop-out itself: helpers that only read, and the window's own menus and dialogs.
// Typing (editFile) runs here too, so the editor never waits for the main window.
const LOCAL = new Set([
  'modelOf', 'simpleName', 'fileOfClass', 'packageOfClass', 'isDirty', 'isStale', 'aiOn', 'contextChips', 'statementFor',
  'errorText', 'dropText', 'editFile', 'describe', 'openMenu', 'closeMenu', 'openDialogBox', 'closeDialog', 'panelTitle',
]);

/** A copy that survives IPC: functions (menu callbacks) and other uncloneable values drop out. */
function plain(v) {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v ?? null));
  }
}
const pick = (s, keys) => Object.fromEntries(keys.filter((k) => k in s).map((k) => [k, s[k]]));
const send = (msg) => api.panel.send(msg);

let seq = 0;
const calls = new Map();
function call(name, args) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    calls.set(id, { resolve, reject });
    send({ type: 'call', id, seq: id, name, args: plain(args) });
  });
}

/**
 * The actions as components use them. In the main window these are the actions themselves; in a
 * pop-out every action that changes something is carried out by the main window. (Looked up on
 * each use: actions.js imports this module too, so its exports may not exist yet at load time.)
 */
const A = new Proxy({}, {
  get(_t, name) {
    const fn = real[name];
    if (!PANEL || typeof fn !== 'function' || LOCAL.has(name)) return fn;
    if (name === 'openPalette') return (...args) => { api.panel.focusMain(); return call(name, args); };
    return (...args) => call(name, args);
  },
});
export default A;

// ------------------------------------------------------------------ main window: the owner

const mirrors = new Map(); // panel -> { ack: last message seq applied }
let dirty = new Set();
let queued = false;

export function startOwner() {
  if (PANEL || !api.panel) return;
  onPatch((patch, prev) => {
    if (!mirrors.size) return;
    for (const k of Object.keys(patch)) if (patch[k] !== prev[k]) dirty.add(k);
    if (!queued) {
      queued = true;
      Promise.resolve().then(flush);
    }
  });
  api.panel.onMessage(fromMirror);
  window.addEventListener('focus', () => {
    if (getState().activeWin !== 'main') setState({ activeWin: 'main' });
  });
}

export const openPanels = () => [...mirrors.keys()];

function flush() {
  queued = false;
  const s = getState();
  for (const [p, m] of mirrors) {
    const keys = KEYS[p].filter((k) => dirty.has(k));
    if (keys.length || m.unacked) send({ to: p, type: 'state', ack: m.ack, patch: plain(pick(s, keys)) });
    m.unacked = false;
  }
  dirty = new Set();
}

function fromMirror(msg) {
  const p = msg.from;
  if (!KEYS[p]) return;
  if (msg.type === 'hello') {
    mirrors.set(p, { ack: 0, unacked: false });
    send({ to: p, type: 'state', ack: 0, patch: plain(pick(getState(), KEYS[p])) });
    return;
  }
  if (msg.type === 'closed') {
    mirrors.delete(p);
    real.panelClosed(p);
    return;
  }
  const m = mirrors.get(p);
  if (!m) return;
  if (msg.seq) {
    m.ack = Math.max(m.ack, msg.seq);
    m.unacked = true;
    if (!queued) {
      queued = true;
      Promise.resolve().then(flush);
    }
  }
  if (msg.type === 'set') {
    const patch = { ...msg.patch };
    const now = getState();
    if (msg.files) {
      // Only the text comes from the pop-out, and only onto the text it was typed into. When this
      // window moved on meanwhile (the tutor applied a change, a file was reloaded), its version
      // wins and goes back to the pop-out. `saved` is never taken from a mirror.
      const files = { ...now.files };
      for (const [n, f] of Object.entries(msg.files)) {
        const cur = now.files[n];
        if (cur && cur.content === f.base) files[n] = { ...cur, content: f.content };
        else dirty.add('files');
      }
      for (const n of msg.removed || []) delete files[n];
      patch.files = files;
    }
    if (patch.readme && now.readme) patch.readme = { ...now.readme, content: patch.readme.content };
    setState(patch);
  } else if (msg.type === 'call') {
    const fn = real[msg.name];
    Promise.resolve()
      .then(() => (typeof fn === 'function' ? fn(...(msg.args || [])) : undefined))
      .then(
        (value) => send({ to: p, type: 'result', id: msg.id, ok: true, value: plain(value === undefined ? null : value) }),
        (err) => send({ to: p, type: 'result', id: msg.id, ok: false, error: String((err && err.message) || err) }),
      );
  }
}

// ------------------------------------------------------------------ pop-out: the mirror

let applying = false;
// The last message that changed a key (or one file) here. Until the main window has applied it,
// what it sends for that key is older than what this window shows, and is not taken over.
const pending = {};
const pendingFiles = {};

export function startMirror() {
  onPatch(forward);
  api.panel.onMessage(fromOwner);
  window.addEventListener('focus', () => setState({ activeWin: WIN }));
  send({ type: 'hello' });
}

function forward(patch, prev) {
  if (applying) return;
  const keys = Object.keys(patch).filter((k) => KEYS[PANEL].includes(k) && patch[k] !== prev[k]);
  if (!keys.length) return;
  const id = ++seq;
  const out = {};
  let files = null;
  let removed = null;
  for (const k of keys) {
    if (k === 'files') {
      // Only the files that changed: the main window may have saved another one meanwhile.
      files = {};
      removed = Object.keys(prev.files || {}).filter((n) => !(n in patch.files));
      for (const [n, f] of Object.entries(patch.files)) {
        const was = (prev.files || {})[n];
        if (was === f) continue;
        files[n] = { content: f.content, base: was ? was.content : null };
        pendingFiles[n] = id;
      }
    } else {
      out[k] = patch[k];
      pending[k] = id;
    }
  }
  send({ type: 'set', seq: id, patch: plain(out), files: files && plain(files), removed });
}

function fromOwner(msg) {
  if (msg.type === 'result') {
    const c = calls.get(msg.id);
    calls.delete(msg.id);
    if (c) (msg.ok ? c.resolve(msg.value) : c.reject(new Error(msg.error)));
    return;
  }
  if (msg.type !== 'state') return;
  const local = getState();
  const next = {};
  for (const [k, v] of Object.entries(msg.patch || {})) {
    if (k === 'files') {
      const merged = { ...v };
      for (const [n, s] of Object.entries(pendingFiles)) {
        if (s > msg.ack) {
          if (local.files[n]) merged[n] = local.files[n];
        } else delete pendingFiles[n];
      }
      next.files = merged;
    } else if (pending[k] > msg.ack) {
      continue;
    } else {
      delete pending[k];
      next[k] = v;
    }
  }
  applying = true;
  try {
    setState(local.ready ? next : { ...next, ready: true });
  } finally {
    applying = false;
  }
}
