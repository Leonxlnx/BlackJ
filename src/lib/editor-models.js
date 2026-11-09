// One Monaco model per project file (and the README), shared by the editor and by the features
// that reach into other files (rename, find references, go to definition, quick fixes).
import monaco from './monaco.js';
import A from '../panels.js';
import { getState } from '../store.js';

export const models = new Map(); // "dir|name" → model
let active = null;
let quiet = 0;

/** The model the editor shows: its changes reach the store through the editor itself. */
export function setActiveModel(m) {
  active = m;
}

/** Runs fn without passing the model changes it makes back to the store. */
export function quietly(fn) {
  quiet++;
  try {
    return fn();
  } finally {
    quiet--;
  }
}

/** "inmemory://blackj/Tiere/Hund.java": short, so the reference list says "Hund.java · Tiere", not a disk path. */
export function uriFor(dir, name) {
  const project = String(dir).split(/[\\/]/).filter(Boolean).pop() || 'Projekt';
  return monaco.Uri.from({ scheme: 'inmemory', authority: 'blackj', path: '/' + project + '/' + name });
}

/** The project file a model belongs to ("Hund.java", "medien/Buch.java", "#readme"), or null. */
export function nameOfModel(m) {
  if (!m) return null;
  for (const [k, v] of models) if (v === m) return k.slice(k.indexOf('|') + 1);
  return null;
}

export function modelFor(dir, name, content) {
  const key = dir + '|' + name;
  let m = models.get(key);
  if (!m || m.isDisposed()) {
    const isText = name === '#readme';
    const uri = uriFor(dir, name);
    // A model left by another project of the same name is not ours: replace it.
    const stale = monaco.editor.getModel(uri);
    if (stale) {
      for (const [k, v] of models) if (v === stale) models.delete(k);
      stale.dispose();
    }
    m = monaco.editor.createModel(content, isText ? 'plaintext' : 'java', uri);
    m.updateOptions({ tabSize: 4, insertSpaces: true });
    models.set(key, m);
    const model = m;
    // A change made while the file is not on screen (rename, a fix in another file) goes to the store.
    model.onDidChangeContent(() => {
      if (quiet || model === active || model.isDisposed()) return;
      A.editFile(name, model.getValue());
    });
  }
  return m;
}

/** The model of a project file, created if needed and brought up to date with the store. */
export function ensureModel(name) {
  const s = getState();
  if (!s.project) return null;
  const f = name === '#readme' ? s.readme : s.files[name];
  if (!f) return null;
  const m = modelFor(s.project.dir, name, f.content);
  if (m !== active && m.getValue() !== f.content) quietly(() => m.pushEditOperations([], [{ range: m.getFullModelRange(), text: f.content }], () => null));
  return m;
}

/** The current text of a project file: the model's when there is one (it may be newer), else the store's. */
export function textOf(name) {
  const s = getState();
  if (!s.project) return null;
  const m = models.get(s.project.dir + '|' + name);
  if (m && !m.isDisposed() && m === active) return m.getValue();
  const f = s.files[name];
  return f ? f.content : null;
}

export function disposeOthers(dir) {
  for (const [k, m] of models) {
    if (!k.startsWith(dir + '|')) {
      m.dispose();
      models.delete(k);
    }
  }
}
