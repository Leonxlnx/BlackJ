// The Java language features of BlackJ's editor, registered once per window: completion, go to
// definition (F12 / Strg+Klick) across the project, find references (Umschalt+F12), rename (F2),
// highlights of the name under the caret, outline and sticky headers, folding, quick fixes and
// generators (Strg+.), "Ausführen" above main(), parameter names at calls, formatting while typing
// and pasting, compiler errors as squiggles that clear on the line you fix.
import monaco from './monaco.js';
import A from '../panels.js';
import { getState, subscribe } from '../store.js';
import { translate } from '../i18n.js';
import { explainProblem } from './errors.js';
import { analyze, posAt, rangeOf, declAt, classAt, JAVA_KEYWORDS } from './editor-symbols.js';
import { makeCtx, symbolAt, locate, referencesOf, signatureOf, argRanges } from './editor-resolve.js';
import { indentEdits, formatJava } from './editor-format.js';
import { ensureModel, nameOfModel, textOf, models } from './editor-models.js';
import { provideCompletion } from './editor-completion.js';
import { quickFixes } from './editor-quickfix.js';
import { editorPrefs, onEditorPrefs } from './editor-prefs.js';

const lang = () => getState().settings.lang;
const tr = (k, p) => translate(lang(), k, p);
const none = { actions: [], dispose() {} };

function ctxOf(model) {
  const s = getState();
  const name = nameOfModel(model);
  if (!s.project || !name || name === '#readme') return null;
  return makeCtx(A.modelOf(s.files), name, model.getValue());
}
const projectTexts = () => Object.keys(getState().files).map((n) => [n, textOf(n)]);
const toRange = (a, start, end) => {
  const r = rangeOf(a, start, end);
  return new monaco.Range(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn);
};
function locationOf(loc) {
  const m = ensureModel(loc.file);
  if (!m) return null;
  return { uri: m.uri, range: toRange(analyze(m.getValue()), loc.start, loc.end) };
}

// ------------------------------------------------------------------ opening another file

let pending = null;
/** A selection to show once the editor has switched to `name` (go to definition into another file). */
export function takePendingReveal(name) {
  if (!pending || pending.name !== name || Date.now() - pending.at > 4000) return null;
  const p = pending;
  pending = null;
  return p.sel;
}

// ------------------------------------------------------------------ compiler errors

const tracked = new Map(); // model → [{ id, problem, marker }]
const stamps = new WeakMap(); // model → which compile (and language) its squiggles come from

function markerFor(p, m) {
  const ex = explainProblem(p, lang());
  const line = Math.min(Math.max(1, p.line), m.getLineCount());
  const col = Math.min(Math.max(1, p.column), m.getLineMaxColumn(line));
  const lineText = m.getLineContent(line);
  // The squiggle covers the word at javac's column, or the rest of the line.
  const word = m.getWordAtPosition({ lineNumber: line, column: col });
  const end = word && word.startColumn <= col ? word.endColumn : Math.max(col + 1, lineText.replace(/\s+$/, '').length + 1);
  return {
    severity: p.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: `${ex.title}\n\n${ex.explain}\n\n→ ${ex.fix}\n\njavac: ${p.message}${p.details.length ? '\n' + p.details.join('\n') : ''}`,
    startLineNumber: line,
    endLineNumber: line,
    startColumn: word && word.startColumn <= col ? word.startColumn : col,
    endColumn: Math.min(end, m.getLineMaxColumn(line)),
    source: 'BlackJ',
  };
}

/** The javac problems of the last compile as squiggles in every open model. */
export function setCompileMarkers() {
  const s = getState();
  if (!s.project) return;
  const stamp = `${s.compile.state}|${s.compile.at || 0}|${s.settings.lang}`;
  for (const [key, m] of models) {
    if (m.isDisposed() || !key.startsWith(s.project.dir + '|')) continue;
    // A model keeps the squiggles of this compile as they are (some may be fixed already).
    if (stamps.get(m) === stamp) continue;
    stamps.set(m, stamp);
    const name = key.slice(s.project.dir.length + 1);
    const problems = s.compile.state === 'errors' ? s.compile.problems.filter((p) => p.file === name) : [];
    const markers = problems.map((p) => markerFor(p, m));
    const old = tracked.get(m) || [];
    const ids = m.deltaDecorations(old.map((t) => t.id), markers.map((mk) => ({ range: new monaco.Range(mk.startLineNumber, mk.startColumn, mk.endLineNumber, mk.endColumn), options: { stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } })));
    tracked.set(m, markers.map((mk, i) => ({ id: ids[i], problem: problems[i], marker: mk })));
    monaco.editor.setModelMarkers(m, 'javac', markers);
  }
}

// Like BlueJ: an error disappears from the line you change; the others move with the text. The
// marker service keeps the positions it was given (quick fixes look markers up there), so the
// moved ones are handed to it again, right after the edit.
const resync = new Map(); // model → touched line ranges waiting for the next turn
function onModelEdit(m, e) {
  const list = tracked.get(m);
  if (!list || !list.length) return;
  const touched = resync.get(m) || [];
  for (const c of e.changes) touched.push([c.range.startLineNumber, c.range.startLineNumber + (c.text.match(/\n/g) || []).length]);
  if (resync.has(m)) return;
  resync.set(m, touched);
  setTimeout(() => {
    resync.delete(m);
    if (m.isDisposed()) return;
    const now = tracked.get(m) || [];
    const keep = [];
    const drop = [];
    let moved = false;
    for (const t of now) {
      const r = m.getDecorationRange(t.id);
      if (!r || touched.some(([a, b]) => r.startLineNumber >= a && r.startLineNumber <= b)) {
        drop.push(t.id);
        continue;
      }
      const marker = { ...t.marker, startLineNumber: r.startLineNumber, endLineNumber: r.endLineNumber, startColumn: r.startColumn, endColumn: Math.max(r.endColumn, r.startColumn + 1) };
      if (marker.startLineNumber !== t.marker.startLineNumber || marker.startColumn !== t.marker.startColumn || marker.endColumn !== t.marker.endColumn) moved = true;
      keep.push({ ...t, marker });
    }
    if (!drop.length && !moved) return;
    if (drop.length) m.deltaDecorations(drop, []);
    tracked.set(m, keep);
    monaco.editor.setModelMarkers(m, 'javac', keep.map((t) => t.marker));
  }, 0);
}

function problemFor(model, marker) {
  const list = tracked.get(model) || [];
  let bestT = null;
  for (const t of list) {
    const r = model.getDecorationRange(t.id);
    if (!r || t.marker.message !== marker.message || t.marker.startLineNumber !== marker.startLineNumber) continue;
    if (!bestT || Math.abs(r.startLineNumber - marker.startLineNumber) < Math.abs(bestT.r.startLineNumber - marker.startLineNumber)) bestT = { t, r };
  }
  if (!bestT) return null;
  // The fix works on where the problem is now (lines above may have changed), not where it was.
  return { ...bestT.t.problem, line: bestT.r.startLineNumber };
}

// ------------------------------------------------------------------ generators

function generators(model, range, ctx) {
  const out = [];
  const { a } = ctx;
  const offset = model.getOffsetAt(range.getStartPosition());
  const cls = classAt(a, offset);
  if (!cls || !cls.name || /\binterface\b/.test(cls.head)) return out;
  const de = lang() !== 'en';
  const line = range.startLineNumber;
  const fields = a.decls.filter((d) => d.kind === 'field' && d.owner === cls);
  const members = a.members.filter((m) => m.owner === cls);
  const has = (name, n) => members.some((m) => m.kind === 'method' && m.name === name && (n == null || (m.params ? (argRanges(a, m.end) || []).length : 0) === n));
  const indent = (model.getLineContent(posAt(a, cls.open).lineNumber).match(/^\s*/) || [''])[0] + '    ';
  const closeLine = posAt(a, cls.close).lineNumber;
  const insertAt = new monaco.Range(closeLine, 1, closeLine, 1);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const isStatic = (f) => /\bstatic\b/.test(model.getLineContent(posAt(a, f.start).lineNumber));
  const isFinal = (f) => /\bfinal\b/.test(model.getLineContent(posAt(a, f.start).lineNumber));
  const getter = (f) => {
    const name = (f.type === 'boolean' ? 'is' : 'get') + cap(f.name);
    return has(name, 0) ? '' : `\n${indent}/** ${de ? `Gibt ${f.name} zurück.` : `Returns ${f.name}.`} */\n${indent}public ${isStatic(f) ? 'static ' : ''}${f.type} ${name}() {\n${indent}    return ${f.name};\n${indent}}\n`;
  };
  const setter = (f) => {
    const name = 'set' + cap(f.name);
    if (isFinal(f) || has(name, 1)) return '';
    const target = isStatic(f) ? cls.name : 'this';
    return `\n${indent}/** ${de ? `Setzt ${f.name} auf einen neuen Wert.` : `Sets ${f.name} to a new value.`} */\n${indent}public ${isStatic(f) ? 'static ' : ''}void ${name}(${f.type} ${f.name}) {\n${indent}    ${target}.${f.name} = ${f.name};\n${indent}}\n`;
  };
  const action = (title, text, at = insertAt) => out.push({ title, kind: 'refactor.generate', edit: { edits: [{ resource: model.uri, textEdit: { range: at, text }, versionId: undefined }] } });

  const here = fields.filter((f) => posAt(a, f.start).lineNumber === line);
  for (const f of here) {
    const g = getter(f);
    const s = setter(f);
    if (g && s) action(tr('editor.gen.both', { name: f.name }), g + s);
    if (g) action(tr('editor.gen.getter', { name: f.name }), g);
    if (s) action(tr('editor.gen.setter', { name: f.name }), s);
  }
  const headerLine = posAt(a, cls.open).lineNumber;
  const onHeader = line === headerLine || (a.classes.find((c) => c.block === cls) && posAt(a, a.classes.find((c) => c.block === cls).start).lineNumber === line);
  if (onHeader || (!model.getLineContent(line).trim() && a.innermostBlock(offset) === cls)) {
    const inst = fields.filter((f) => !isStatic(f));
    if (inst.length && !members.some((m) => m.kind === 'ctor' && (argRanges(a, m.end) || []).length === inst.length)) {
      const ctor = `\n${indent}/** ${de ? `Erzeugt ein neues ${cls.name}-Objekt.` : `Creates a new ${cls.name} object.`} */\n${indent}public ${cls.name}(${inst.map((f) => `${f.type} ${f.name}`).join(', ')}) {\n${inst.map((f) => `${indent}    this.${f.name} = ${f.name};\n`).join('')}${indent}}\n`;
      // After the fields, so the class reads top to bottom.
      const lastField = inst[inst.length - 1];
      const afterLine = posAt(a, lastField.end).lineNumber + 1;
      action(tr('editor.gen.ctor'), ctor, new monaco.Range(afterLine, 1, afterLine, 1));
    }
    const allGs = fields.map((f) => getter(f) + setter(f)).join('');
    if (fields.length > 1 && allGs) action(tr('editor.gen.all'), allGs);
    if (!has('toString', 0) && fields.length) {
      const parts = fields.filter((f) => !isStatic(f)).map((f, i) => `${i ? '", ' : '"'}${f.name}=" + ${f.name}`).join(' + ');
      action(tr('editor.gen.toString'), `\n${indent}@Override\n${indent}public String toString() {\n${indent}    return "${cls.name}[" + ${parts || '""'} + "]";\n${indent}}\n`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ registration

let ready = false;
const inlayChanged = new monaco.Emitter();
const lensChanged = new monaco.Emitter();

/**
 * Asks for the code lenses again. An editor created anew (docked back, popped out) first shows
 * Monaco's cached lenses, which are plain text without their command: "Ausführen" would not click.
 */
export function refreshLenses() {
  lensChanged.fire();
}

export function registerEditorFeatures() {
  if (ready) return;
  ready = true;

  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      const name = nameOfModel(monaco.editor.getModel(resource));
      if (!name) return false;
      pending = { name, sel: selectionOrPosition, at: Date.now() };
      A.openFile(name);
      return true;
    },
  });
  monaco.editor.registerCommand('blackj.runMain', (_acc, cls) => A.runMain(cls));
  monaco.editor.registerCommand('blackj.runTest', (_acc, cls, method) => A.runTests(method ? { className: cls, method } : { className: cls }));
  monaco.editor.registerCommand('blackj.appAction', (_acc, name, ...args) => A[name](...args));

  // Errors leave the line you are fixing.
  const watch = (m) => m.onDidChangeContent((e) => onModelEdit(m, e));
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
  onEditorPrefs(() => inlayChanged.fire());

  monaco.languages.registerCompletionItemProvider('java', {
    triggerCharacters: ['.', '@', '*'],
    provideCompletionItems(model, position, context) {
      const s = getState();
      const name = nameOfModel(model);
      if (!name || name === '#readme') return { suggestions: [] };
      if (context.triggerCharacter === '*' && !/^\s*\/\*\*\s*$/.test(model.getLineContent(position.lineNumber).slice(0, position.column - 1))) return { suggestions: [] };
      try {
        return provideCompletion(model, position, { pm: A.modelOf(s.files), fileName: name, lang: s.settings.lang });
      } catch {
        return { suggestions: [] };
      }
    },
  });

  monaco.languages.registerDefinitionProvider('java', {
    provideDefinition(model, position) {
      const ctx = ctxOf(model);
      if (!ctx) return null;
      const sym = symbolAt(ctx, model.getOffsetAt(position));
      if (!sym) return null;
      const loc = locate(ctx, sym, textOf);
      return loc ? locationOf(loc) : null;
    },
  });

  monaco.languages.registerReferenceProvider('java', {
    provideReferences(model, position, context) {
      const ctx = ctxOf(model);
      if (!ctx) return [];
      const sym = symbolAt(ctx, model.getOffsetAt(position));
      if (!sym || sym.kind === 'lib' || sym.kind === 'libClass') return [];
      return referencesOf(ctx, sym, projectTexts())
        .filter((r) => context.includeDeclaration || !r.decl)
        .map((r) => locationOf(r))
        .filter(Boolean);
    },
  });

  monaco.languages.registerDocumentHighlightProvider('java', {
    provideDocumentHighlights(model, position) {
      const ctx = ctxOf(model);
      if (!ctx) return [];
      const sym = symbolAt(ctx, model.getOffsetAt(position));
      if (!sym || sym.kind === 'libClass') return [];
      const K = monaco.languages.DocumentHighlightKind;
      return referencesOf(ctx, sym, [[ctx.name, ctx.text]], ctx.name).filter((r) => r.file === ctx.name).map((r) => ({ range: toRange(ctx.a, r.start, r.end), kind: r.write ? K.Write : K.Read }));
    },
  });

  monaco.languages.registerRenameProvider('java', {
    resolveRenameLocation(model, position) {
      const ctx = ctxOf(model);
      const sym = ctx && symbolAt(ctx, model.getOffsetAt(position));
      const word = model.getWordAtPosition(position);
      const range = word ? new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn) : new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
      if (!sym) return { range, text: word ? word.word : '', rejectReason: tr('editor.rename.none') };
      if (sym.kind === 'lib' || sym.kind === 'libClass') return { range, text: sym.name, rejectReason: tr('editor.rename.lib') };
      if (getState().project.readOnly) return { range, text: sym.name, rejectReason: tr('editor.rename.readOnly') };
      return { range: toRange(ctx.a, sym.tok.start, sym.tok.end), text: sym.name };
    },
    provideRenameEdits(model, position, newName) {
      const ctx = ctxOf(model);
      const sym = ctx && symbolAt(ctx, model.getOffsetAt(position));
      if (!sym) return { edits: [], rejectReason: tr('editor.rename.none') };
      newName = String(newName).trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(newName) || JAVA_KEYWORDS.has(newName)) return { edits: [], rejectReason: tr('editor.rename.invalid', { name: newName }) };
      if (sym.kind === 'class' && ctx.pm.list.some((c) => c.simple === newName)) return { edits: [], rejectReason: tr('editor.rename.exists', { name: newName }) };
      const refs = referencesOf(ctx, sym, projectTexts());
      const edits = [];
      for (const r of refs) {
        const m = ensureModel(r.file);
        if (!m) continue;
        edits.push({ resource: m.uri, textEdit: { range: toRange(analyze(m.getValue()), r.start, r.end), text: newName }, versionId: undefined });
      }
      // A public class lives in a file of its name: the file follows once the text has changed.
      if (sym.kind === 'class' && sym.cls && sym.cls.simple === sym.name) {
        const file = sym.cls.file;
        setTimeout(() => A.renameToClass(file, newName), 300);
      }
      return { edits };
    },
  });

  monaco.languages.registerHoverProvider('java', {
    provideHover(model, position) {
      if (!getState().settings.hoverHelp) return null;
      const ctx = ctxOf(model);
      if (!ctx) return null;
      const sym = symbolAt(ctx, model.getOffsetAt(position));
      if (!sym || sym.kind === 'lib' || sym.kind === 'libClass') return null;
      const sig = signatureOf(sym);
      if (!sig) return null;
      let what = '';
      let doc = null;
      if (sym.kind === 'local') what = tr(sym.decl.kind === 'param' ? 'editor.hover.param' : 'editor.hover.local');
      else if (sym.kind === 'field') {
        what = tr('editor.hover.field', { cls: sym.owner ? sym.owner.simple : '' });
        doc = sym.member && sym.member.doc ? sym.member.doc.text : null;
      } else if (sym.kind === 'method') {
        what = tr('editor.hover.method', { cls: sym.owner ? sym.owner.simple : '' });
        const d = sym.member && sym.member.doc;
        if (d) doc = [d.text, ...Object.entries(d.params || {}).map(([k, v]) => `*${k}* — ${v}`), d.returns ? `*${tr('editor.hover.returns')}* — ${d.returns}` : ''].filter(Boolean).join('  \n');
      } else if (sym.kind === 'class') {
        what = tr('editor.hover.class');
        doc = sym.cls && sym.cls.doc ? sym.cls.doc.text : null;
      }
      return { range: toRange(ctx.a, sym.tok.start, sym.tok.end), contents: [{ value: '```java\n' + sig + '\n```' }, { value: what + (doc ? '\n\n' + doc : '') }] };
    },
  });

  monaco.languages.registerDocumentSymbolProvider('java', {
    displayName: 'BlackJ',
    provideDocumentSymbols(model) {
      const a = analyze(model.getValue());
      const SK = monaco.languages.SymbolKind;
      const lineStart = (off) => posAt(a, off).lineNumber;
      const full = (startOff, endOff) => new monaco.Range(lineStart(startOff), 1, posAt(a, Math.min(endOff, a.src.length)).lineNumber, posAt(a, Math.min(endOff, a.src.length)).column + 1);
      const memberSym = (m) => {
        const end = m.body ? m.body.close : m.params ? m.params[1] : m.end;
        return {
          name: m.name,
          detail: m.kind === 'field' ? m.type || '' : '(' + (m.params ? a.src.slice(m.params[0] + 1, m.params[1]).replace(/\s+/g, ' ').trim() : '') + ')',
          kind: m.kind === 'field' ? SK.Field : m.kind === 'ctor' ? SK.Constructor : SK.Method,
          tags: [],
          range: full(m.start, end),
          selectionRange: toRange(a, m.start, m.end),
          children: [],
        };
      };
      const classSym = (c) => {
        const children = [...a.members.filter((m) => m.owner === c.block).map(memberSym), ...a.classes.filter((x) => x.owner === c.block).map(classSym)];
        children.sort((x, y) => x.range.startLineNumber - y.range.startLineNumber);
        const head = c.block.head;
        return {
          name: c.name,
          detail: '',
          kind: /\binterface\b/.test(head) ? SK.Interface : /\benum\b/.test(head) ? SK.Enum : SK.Class,
          tags: [],
          range: full(c.start, c.block.close),
          selectionRange: toRange(a, c.start, c.end),
          children,
        };
      };
      return a.classes.filter((c) => !c.owner).map(classSym);
    },
  });

  monaco.languages.registerFoldingRangeProvider('java', {
    provideFoldingRanges(model) {
      const a = analyze(model.getValue());
      const out = [];
      for (const b of a.blocks) {
        const s = posAt(a, b.open).lineNumber;
        const e = posAt(a, Math.min(b.close, a.src.length)).lineNumber;
        if (e - 1 > s) out.push({ start: s, end: e - 1 });
      }
      const K = monaco.languages.FoldingRangeKind;
      const re = /\/\*[\s\S]*?\*\//g;
      let m;
      while ((m = re.exec(a.src))) {
        if (a.masked[m.index] !== ' ') continue; // inside a string
        const s = posAt(a, m.index).lineNumber;
        const e = posAt(a, m.index + m[0].length).lineNumber;
        if (e > s) out.push({ start: s, end: e, kind: K.Comment });
      }
      const lines = model.getLinesContent();
      let first = -1;
      lines.forEach((l, i) => {
        if (/^\s*import\s/.test(l)) {
          if (first < 0) first = i + 1;
          if (!/^\s*import\s/.test(lines[i + 1] || '') && i + 1 > first) out.push({ start: first, end: i + 1, kind: K.Imports });
        } else if (l.trim()) first = -1;
      });
      return out;
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider('java', {
    displayName: 'BlackJ',
    provideDocumentFormattingEdits(model) {
      const text = model.getValue();
      const out = formatJava(text);
      return out === text ? [] : [{ range: model.getFullModelRange(), text: out }];
    },
  });
  monaco.languages.registerDocumentRangeFormattingEditProvider('java', {
    displayName: 'BlackJ',
    provideDocumentRangeFormattingEdits(model, range) {
      return indentEdits(model.getValue(), range.startLineNumber, range.endLineNumber).map((e) => ({ range: new monaco.Range(e.line, e.from, e.line, e.to), text: e.text }));
    },
  });
  monaco.languages.registerOnTypeFormattingEditProvider('java', {
    autoFormatTriggerCharacters: ['}', ';'],
    provideOnTypeFormattingEdits(model, position, ch) {
      const line = model.getLineContent(position.lineNumber);
      // A } typed first on its line lines up with its block; a ; ends a statement that may have been mis-indented.
      if (ch === '}' && !/^\s*\}/.test(line)) return [];
      if (ch === ';' && !/^\s*[\w$]/.test(line)) return [];
      return indentEdits(model.getValue(), position.lineNumber, position.lineNumber).map((e) => ({ range: new monaco.Range(e.line, e.from, e.line, e.to), text: e.text }));
    },
  });

  // The lens titles are BlackJ's own words: asked for again when the language changes.
  let lensLang = lang();
  subscribe(() => {
    if (lang() === lensLang) return;
    lensLang = lang();
    lensChanged.fire();
  });
  monaco.languages.registerCodeLensProvider('java', {
    onDidChange: lensChanged.event,
    provideCodeLenses(model) {
      const ctx = ctxOf(model);
      if (!ctx || !ctx.cur) return { lenses: [], dispose() {} };
      const { a, cur } = ctx;
      const lenses = [];
      const top = a.classes.find((c) => !c.owner && c.name === cur.simple);
      for (const m of a.members) {
        if (m.kind !== 'method' || !top || m.owner !== top.block) continue;
        const line = posAt(a, m.start).lineNumber;
        const text = model.getLineContent(line);
        if (m.name === 'main' && /\bstatic\b/.test(text) && /String/.test(a.src.slice(m.params ? m.params[0] : m.end, m.params ? m.params[1] : m.end))) {
          lenses.push({ range: new monaco.Range(line, 1, line, 1), id: 'main:' + line, command: { id: 'blackj.runMain', title: tr('editor.lens.run'), arguments: [cur.fileClass] } });
        }
        const before = a.src.slice(Math.max(0, a.lineStarts[line - 1] - 300), a.lineStarts[line - 1]);
        const lastBoundary = Math.max(before.lastIndexOf('}'), before.lastIndexOf(';'), before.lastIndexOf('{'));
        if (cur.isTest && /@Test\b/.test(before.slice(lastBoundary + 1) + text)) {
          lenses.push({ range: new monaco.Range(line, 1, line, 1), id: 'test:' + line, command: { id: 'blackj.runTest', title: tr('editor.lens.test'), arguments: [cur.fileClass, m.name] } });
        }
      }
      if (cur.isTest && top && lenses.length > 1) {
        const line = posAt(a, top.start).lineNumber;
        lenses.unshift({ range: new monaco.Range(line, 1, line, 1), id: 'tests', command: { id: 'blackj.runTest', title: tr('editor.lens.tests'), arguments: [cur.fileClass] } });
      }
      return { lenses, dispose() {} };
    },
    resolveCodeLens(_model, lens) {
      return lens;
    },
  });

  monaco.languages.registerInlayHintsProvider('java', {
    onDidChangeInlayHints: inlayChanged.event,
    provideInlayHints(model, range) {
      if (!editorPrefs().inlayHints) return { hints: [], dispose() {} };
      const ctx = ctxOf(model);
      if (!ctx) return { hints: [], dispose() {} };
      const hints = [];
      const from = model.getOffsetAt(range.getStartPosition());
      const to = model.getOffsetAt(range.getEndPosition());
      const literal = /^(-?[\d.][\w.]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|null)$/;
      for (const t of ctx.a.tokens) {
        if (!t.call || t.start < from || t.start > to || declAt(ctx.a, t)) continue;
        let sym = null;
        try {
          sym = symbolAt(ctx, t.start);
        } catch {
          continue;
        }
        let params = null;
        if (sym && sym.kind === 'method' && sym.member) params = sym.member.params;
        else if (sym && sym.kind === 'class' && sym.ctorCall && sym.cls) {
          const k = sym.cls.ctors.find((c) => c.params.length === sym.argc);
          params = k ? k.params : null;
        }
        if (!params || !params.length) continue;
        const args = argRanges(ctx.a, t.end);
        if (!args || args.length !== params.length) continue;
        args.forEach(([s, e], i) => {
          const txt = ctx.text.slice(s, e).trim();
          if (!literal.test(txt) || !params[i].name) return;
          const p = posAt(ctx.a, s);
          hints.push({ label: params[i].name + ':', position: { lineNumber: p.lineNumber, column: p.column }, kind: monaco.languages.InlayHintKind.Parameter, paddingRight: true });
        });
      }
      return { hints, dispose() {} };
    },
  });

  monaco.languages.registerCodeActionProvider('java', {
    provideCodeActions(model, range, context) {
      const ctx = ctxOf(model);
      if (!ctx) return none;
      const actions = [];
      const seen = new Set();
      for (const marker of context.markers) {
        if (marker.owner !== 'javac') continue;
        const problem = problemFor(model, marker);
        if (!problem) continue;
        let fixes = [];
        try {
          fixes = quickFixes(problem, { pm: ctx.pm, file: ctx.name, text: ctx.text, lang: lang() });
        } catch {
          fixes = [];
        }
        for (const fix of fixes) {
          if (seen.has(fix.title)) continue;
          seen.add(fix.title);
          if (fix.command) {
            actions.push({ title: fix.title, kind: 'quickfix', diagnostics: [marker], isPreferred: !!fix.preferred, command: { id: 'blackj.appAction', title: fix.title, arguments: fix.command } });
          } else if (fix.edits && fix.edits.length) {
            const edits = fix.edits.map((e) => {
              const m = ensureModel(e.file);
              return m && { resource: m.uri, textEdit: { range: new monaco.Range(...e.range), text: e.text }, versionId: undefined };
            }).filter(Boolean);
            if (edits.length) actions.push({ title: fix.title, kind: 'quickfix', diagnostics: [marker], isPreferred: !!fix.preferred, edit: { edits } });
          }
        }
      }
      if (!getState().project.readOnly) {
        try {
          actions.push(...generators(model, range, ctx));
        } catch {
          /* half-typed code */
        }
      }
      return { actions, dispose() {} };
    },
  }, { providedCodeActionKinds: ['quickfix', 'refactor.generate'] });
}
