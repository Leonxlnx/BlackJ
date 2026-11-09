// How the editor looks for this person: minimap, word wrap, parameter names, sticky headers.
// Kept in the browser's storage (shared by the main window and a popped-out editor, which follow
// each other through the storage event), so no setting of the app has to know about them.
import { useSyncExternalStore } from 'react';

const KEY = 'blackj.editor';
const DEFAULTS = { minimap: false, wordWrap: false, inlayHints: true, stickyScroll: true, whitespace: false };

function read() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs = read();
const subs = new Set();
const emit = () => subs.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    prefs = read();
    emit();
  });
}

export function editorPrefs() {
  return prefs;
}

export function setEditorPref(key, value) {
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage blocked: this window keeps it until it closes */
  }
  emit();
}

export function onEditorPrefs(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useEditorPrefs() {
  return useSyncExternalStore(onEditorPrefs, () => prefs);
}

/** The app language last used, so Monaco's own words can be loaded in it before Monaco starts. */
export function rememberLang(lang) {
  try {
    localStorage.setItem('blackj.lang', lang);
  } catch {
    /* ignore */
  }
}
