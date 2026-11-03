import { useEffect, useRef, useState } from 'react';
import { useStore, getState, setState } from '../store.js';
import { useT, translate, formatKeys } from '../i18n.js';
import A, { PANEL } from '../panels.js';
import { api } from '../api.js';
import monaco, { defineThemes } from '../lib/monaco.js';
import { KEYWORDS } from '../lib/keywords.js';
import { reindent } from '../lib/format.js';
import { explainProblem } from '../lib/errors.js';
import { explainException } from '../lib/exceptions.js';
import { scopeRanges } from '../lib/javaParse.js';
import { receiverOf, resolveReceiver, libMembers, projectMembers, callAt } from '../lib/completion.js';
import { infoFor } from '../model.js';
import { registerEditor } from '../lib/tour.js';
import { proposalFor } from '../agent.js';
import { lineDiff } from '../lib/diff.js';
import Icon from './Icon.jsx';
import DocsView from './DocsView.jsx';
import PopOut from './PopOut.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let providersReady = false;
function registerProviders() {
  if (providersReady) return;
  providersReady = true;
  defineThemes();

  monaco.languages.registerHoverProvider('java', {
    provideHover(model, position) {
      const s = getState();
      if (!s.settings.hoverHelp) return null;
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const entry = KEYWORDS[word.word];
      if (entry) return { range, contents: [{ value: `**${word.word}** — ${entry[s.settings.lang] || entry.de}` }] };
      // A library method or constant after a dot: its signatures and a short explanation.
      const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
      if (!/\.\s*$/.test(before)) return null;
      const projectModel = A.modelOf(s.files);
      const cur = projectModel.list.find((c) => c.file === s.activeTab) || null;
      const recv = resolveReceiver(model.getValue(), model.getOffsetAt(position), receiverOf(before), projectModel, cur);
      if (!recv || recv.kind === 'array') return null;
      const members = recv.kind === 'lib'
        ? libMembers(recv.cls, recv.statics, recv.args, s.settings.lang)
        : projectMembers(projectModel, recv.cls, recv.statics, !!cur && cur.fileClass === recv.cls.fileClass);
      const hits = members.filter((m) => m.name === word.word);
      if (!hits.length) return null;
      const owner = recv.kind === 'lib' ? recv.cls : recv.cls.simple;
      const sigs = hits.slice(0, 6).map((m) => (m.field ? `${m.ret} ${m.owner || owner}.${m.name}` : `${m.ret} ${m.name}(${m.params.map((p, i) => (m.names ? `${p} ${m.names[i]}` : p)).join(', ')})`)).join('\n');
      const doc = hits.find((m) => m.doc);
      return { range, contents: [{ value: '```java\n' + sigs + (hits.length > 6 ? '\n…' : '') + '\n```' }, ...(doc ? [{ value: doc.doc }] : [])] };
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider('java', {
    provideDocumentFormattingEdits(model) {
      return [{ range: model.getFullModelRange(), text: reindent(model.getValue()) }];
    },
  });

  // Ghost-text completions from Claude Haiku, after a short pause in typing.
  monaco.languages.registerInlineCompletionsProvider('java', {
    async provideInlineCompletions(model, position, _context, token) {
      const s = getState();
      if (!s.settings.aiInline || !A.aiOn(s) || !s.project || s.project.readOnly) return { items: [] };
      await sleep(450);
      if (token.isCancellationRequested) return { items: [] };
      const line = model.getLineContent(position.lineNumber);
      const after = line.slice(position.column - 1);
      if (/\S/.test(after) && !/^[\s)\]};,]*$/.test(after)) return { items: [] };
      const prefix = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
      const suffix = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: model.getLineCount(), endColumn: model.getLineMaxColumn(model.getLineCount()) });
      if (prefix.trim().length < 8) return { items: [] };
      const r = await api.ai.complete({ prefix, suffix, file: s.activeTab });
      if (token.isCancellationRequested || !r || !r.text || !r.text.trim()) return { items: [] };
      return { items: [{ insertText: r.text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
    },
    freeInlineCompletions() {},
    disposeInlineCompletions() {},
  });

  // Parameter hints while typing a call: substring( shows int beginIndex, int endIndex.
  monaco.languages.registerSignatureHelpProvider('java', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp(model, position) {
      const s = getState();
      const offset = model.getOffsetAt(position);
      const text = model.getValue();
      const call = callAt(text.slice(Math.max(0, offset - 3000), offset));
      if (!call) return null;
      const projectModel = A.modelOf(s.files);
      const cur = projectModel.list.find((c) => c.file === s.activeTab) || null;
      let found = [];
      if (call.ctor) {
        const pc = projectModel.list.find((c) => c.simple === call.ctor);
        if (pc) found = pc.ctors.map((k) => ({ name: pc.simple, params: k.params.map((p) => p.type), names: k.params.map((p) => p.name), doc: k.doc ? k.doc.text : null }));
      } else {
        let members = [];
        if (call.expr) {
          const recv = resolveReceiver(text, offset, call.expr, projectModel, cur);
          if (recv && recv.kind === 'lib') members = libMembers(recv.cls, recv.statics, recv.args, s.settings.lang);
          else if (recv && recv.kind === 'project') members = projectMembers(projectModel, recv.cls, recv.statics, !!cur && cur.fileClass === recv.cls.fileClass);
        } else if (cur) members = projectMembers(projectModel, cur, false, true);
        found = members.filter((m) => !m.field && m.name === call.name);
      }
      if (!found.length) return null;
      const signatures = found.slice(0, 12).map((m) => {
        let label = m.name + '(';
        const parameters = m.params.map((p, i) => {
          const part = m.names ? `${p} ${m.names[i]}` : p;
          const start = label.length;
          label += (i ? ', ' : '') + part;
          return { label: [start + (i ? 2 : 0), label.length] };
        });
        label += ')' + (m.ret ? ': ' + m.ret : '');
        return { label, parameters, documentation: m.doc || undefined };
      });
      const active = signatures.findIndex((x) => x.parameters.length > call.argIndex);
      return { value: { signatures, activeSignature: Math.max(0, active), activeParameter: call.argIndex }, dispose() {} };
    },
  });

  monaco.editor.registerCommand('blackj.aiFix', (_accessor, problem) => A.aiFix(problem));
  monaco.languages.registerCodeActionProvider('java', {
    provideCodeActions(model, _range, context) {
      const s = getState();
      if (!A.aiOn(s) || s.compile.state !== 'errors') return { actions: [], dispose() {} };
      const name = s.activeTab;
      const problems = context.markers.filter((m) => m.owner === 'javac' || m.source === 'BlackJ').map((m) => s.compile.problems.find((p) => p.file === name && p.line === m.startLineNumber)).filter(Boolean);
      const actions = problems.slice(0, 1).map((p) => ({
        title: translate(s.settings.lang, 'ai.fix'),
        kind: 'quickfix',
        isPreferred: true,
        command: { id: 'blackj.aiFix', title: translate(s.settings.lang, 'ai.fix'), arguments: [p] },
      }));
      return { actions, dispose() {} };
    },
  });

  const snippets = [
    ['sout', 'System.out.println(${1});', 'System.out.println(…)'],
    ['main', 'public static void main(String[] args) {\n\t${1}\n}', 'main-Methode / main method'],
    ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:anzahl}; ${1:i}++) {\n\t${3}\n}', 'for-Schleife / for loop'],
    ['foreach', 'for (${1:Typ} ${2:element} : ${3:liste}) {\n\t${4}\n}', 'for-each'],
    ['if', 'if (${1:bedingung}) {\n\t${2}\n}', 'if'],
    ['ifelse', 'if (${1:bedingung}) {\n\t${2}\n} else {\n\t${3}\n}', 'if / else'],
    ['while', 'while (${1:bedingung}) {\n\t${2}\n}', 'while'],
    ['scanner', 'Scanner ${1:eingabe} = new Scanner(System.in);', 'Scanner(System.in)'],
    ['test', '@Test\npublic void ${1:testName}() {\n\t${2:assertEquals(erwartet, tatsaechlich);}\n}', 'JUnit @Test'],
    ['get', 'public ${1:int} get${2:Wert}() {\n\treturn ${3:wert};\n}', 'Getter'],
    ['set', 'public void set${1:Wert}(${2:int} ${3:wert}) {\n\tthis.${3:wert} = ${3:wert};\n}', 'Setter'],
  ];
  const keywords = Object.keys(KEYWORDS).filter((k) => /^[a-z]/.test(k));
  monaco.languages.registerCompletionItemProvider('java', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const lineBefore = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
      const s = getState();
      const projectModel = A.modelOf(s.files);
      const K = monaco.languages.CompletionItemKind;
      const items = [];
      if (/\.\s*$/.test(lineBefore)) {
        const cur = projectModel.list.find((c) => c.file === s.activeTab) || null;
        const recv = resolveReceiver(model.getValue(), model.getOffsetAt(position), receiverOf(lineBefore), projectModel, cur);
        if (recv) return { suggestions: memberSuggestions(recv, projectModel, cur, s.settings.lang, range) };
        for (const c of projectModel.list) {
          for (const m of c.methods) {
            if (m.visibility === 'private') continue;
            items.push({ label: `${m.name}(${m.params.map((p) => p.type).join(', ')})`, filterText: m.name, kind: K.Method, detail: `${c.simple} · ${m.returnType}`, documentation: m.doc ? m.doc.text : undefined, insertText: m.params.length ? `${m.name}(${m.params.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ')})` : `${m.name}()`, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range });
          }
        }
        return { suggestions: items };
      }
      for (const [label, body, detail] of snippets) items.push({ label, kind: K.Snippet, detail, insertText: body, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range });
      for (const k of keywords) items.push({ label: k, kind: K.Keyword, insertText: k, range, documentation: KEYWORDS[k][s.settings.lang] || KEYWORDS[k].de });
      for (const c of projectModel.list) items.push({ label: c.simple, kind: c.kind === 'interface' ? K.Interface : K.Class, detail: c.doc ? c.doc.text.slice(0, 80) : c.pkg, insertText: c.simple, range });
      for (const tname of ['String', 'ArrayList', 'HashMap', 'Scanner', 'System', 'Math', 'Integer', 'Double', 'Random']) items.push({ label: tname, kind: K.Class, insertText: tname, range });
      return { suggestions: items };
    },
  });
}

/** Completion items for the members of a resolved receiver (see lib/completion.js). */
function memberSuggestions(recv, projectModel, cur, lang, range) {
  const K = monaco.languages.CompletionItemKind;
  const Snippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const de = lang !== 'en';
  if (recv.kind === 'array') {
    return [{ label: 'length', kind: K.Field, detail: 'int', documentation: de ? 'Anzahl der Elemente im Array (ohne Klammern).' : 'Number of elements in the array (no parentheses).', insertText: 'length', range }];
  }
  const owner = recv.kind === 'lib' ? recv.cls : recv.cls.simple;
  const members = recv.kind === 'lib'
    ? libMembers(recv.cls, recv.statics, recv.args, lang)
    : projectMembers(projectModel, recv.cls, recv.statics, !!cur && cur.fileClass === recv.cls.fileClass);
  const byName = new Map();
  for (const m of members) {
    const k = (m.field ? 'f:' : 'm:') + m.name;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(m);
  }
  const items = [];
  for (const list of byName.values()) {
    const m = list[0];
    const doc = (list.find((x) => x.doc) || {}).doc || undefined;
    const sortText = (doc && recv.kind === 'lib' ? '0' : '1') + m.name;
    if (m.field) {
      items.push({ label: m.name, kind: m.isStatic ? K.Constant : K.Field, detail: `${m.ret} · ${m.owner || owner}`, documentation: doc, insertText: m.name, sortText, range });
      continue;
    }
    // Many overloads (println, valueOf, append …) become one entry that lists them all.
    if (list.length > 3) {
      const sigs = list.map((x) => `${x.name}(${x.params.join(', ')})`).join('\n');
      items.push({ label: `${m.name}(…)`, filterText: m.name, kind: K.Method, detail: `${m.ret} · ${de ? `${list.length} Varianten` : `${list.length} variants`}`, documentation: { value: (doc ? doc + '\n\n' : '') + '```java\n' + sigs + '\n```' }, insertText: `${m.name}($1)`, insertTextRules: Snippet, sortText, range });
      continue;
    }
    for (const x of list) {
      const holes = x.params.map((p, i) => `\${${i + 1}:${(x.names && x.names[i]) || p.replace(/<.*>/, '').replace(/[^\w]/g, '') || 'wert'}}`);
      items.push({ label: `${x.name}(${x.params.join(', ')})`, filterText: x.name, kind: K.Method, detail: `${x.ret} · ${x.owner || owner}`, documentation: x.doc || doc, insertText: `${x.name}(${holes.join(', ')})`, insertTextRules: Snippet, sortText, range });
    }
  }
  return items;
}

const models = new Map();
function modelFor(dir, name, content) {
  const key = dir + '|' + name;
  let m = models.get(key);
  if (!m || m.isDisposed()) {
    const isText = name === '#readme';
    m = monaco.editor.createModel(content, isText ? 'plaintext' : 'java', monaco.Uri.parse('inmemory://blackj/' + encodeURIComponent(dir) + '/' + encodeURIComponent(name)));
    m.updateOptions({ tabSize: 4, insertSpaces: true });
    models.set(key, m);
  }
  return m;
}
function disposeOthers(dir) {
  for (const [k, m] of models) {
    if (!k.startsWith(dir + '|')) {
      m.dispose();
      models.delete(k);
    }
  }
}

function scopeDecorations(src) {
  const ranges = scopeRanges(src).filter((r) => r.kind !== 'class' && r.end > r.start);
  const innermost = new Map();
  for (const r of ranges.sort((a, b) => a.depth - b.depth)) {
    for (let l = r.start; l <= r.end; l++) innermost.set(l, r);
  }
  const out = [];
  for (const [line, r] of innermost) {
    const cls = r.kind === 'method' ? 'sc-m' : r.depth % 2 ? 'sc-b1' : 'sc-b2';
    out.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: cls, linesDecorationsClassName: cls + '-bar' } });
  }
  return out;
}

function AiPrompt({ editorRef }) {
  const t = useT();
  const prompt = useStore((s) => s.aiPrompt);
  const busy = useStore((s) => s.aiBusy);
  const selection = useStore((s) => s.editorSelection);
  const active = useStore((s) => s.activeTab);
  const [text, setText] = useState('');
  const [top, setTop] = useState(12);
  const inputRef = useRef(null);
  useEffect(() => {
    if (!prompt) return;
    setText('');
    const ed = editorRef.current;
    if (ed) {
      const pos = ed.getPosition();
      const vis = pos && ed.getScrolledVisiblePosition(pos);
      setTop(vis ? Math.max(8, Math.min(vis.top + 24, ed.getLayoutInfo().height - 120)) : 12);
    }
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  }, [prompt]);
  if (!prompt && !busy) return null;
  const sel = selection && selection.file === active ? selection : null;
  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const ed = editorRef.current;
    const pos = ed && ed.getPosition();
    setState({ aiPrompt: null });
    A.aiEdit({ instruction: text.trim(), scope: sel ? 'selection' : 'insert', selection: sel || (pos ? { from: pos.lineNumber, to: pos.lineNumber, text: '' } : null) });
  };
  return (
    <form className="ai-prompt" style={{ top }} onSubmit={submit}>
      <Icon name="tutor" />
      {busy ? (
        <>
          <span className="ai-busy">{t('ai.working')} <span className="muted">„{busy.instruction}“</span></span>
          <button type="button" className="icon-btn" aria-label={t('tutor.stop')} title={t('tutor.stop')} onClick={A.stopEdit}>
            <Icon name="close" />
          </button>
        </>
      ) : (
        <>
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={sel ? t('ai.placeholderSel', { from: sel.from, to: sel.to }) : t('ai.placeholder')} onKeyDown={(e) => e.key === 'Escape' && setState({ aiPrompt: null })} spellCheck="false" />
          <kbd>Enter</kbd>
        </>
      )}
    </form>
  );
}

export default function EditorPanel() {
  const t = useT();
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const files = useStore((s) => s.files);
  const readme = useStore((s) => s.readme);
  const project = useStore((s) => s.project);
  const settings = useStore((s) => s.settings);
  const compile = useStore((s) => s.compile);
  const exception = useStore((s) => s.exception);
  const reveal = useStore((s) => s.reveal);
  const insertRequest = useStore((s) => s.insertRequest);
  const selection = useStore((s) => s.editorSelection);
  const breakpoints = useStore((s) => s.breakpoints);
  const paused = useStore((s) => s.debug && s.debug.paused);
  const mode = useStore((s) => s.editorMode || 'source');
  const cursor = useStore((s) => s.cursor);
  const hasKey = useStore((s) => A.aiOn(s));
  const proposals = useStore((s) => s.agent.proposals);
  const agentHighlight = useStore((s) => s.agentHighlight);
  // The chat card next to this editor has the buttons; the bar then only points at the change.
  const cardBeside = useStore((s) => !PANEL && !!s.tutorOpen && s.side === 'tutor' && !(s.layout && s.layout.detached.includes('side')));
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const applying = useRef(false);
  const saveTimer = useRef(null);
  const decos = useRef({});

  const fileOf = (name) => (name === '#readme' ? readme && { name: '#readme', className: readme.name, content: readme.content, saved: readme.saved } : files[name]);

  useEffect(() => {
    registerProviders();
    const st = getState().settings;
    const ed = monaco.editor.create(hostRef.current, {
      automaticLayout: true,
      theme: 'blackj-' + st.theme,
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: st.fontSize,
      lineHeight: Math.round(st.fontSize * 1.6),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      padding: { top: 10, bottom: 12 },
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      tabSize: 4,
      glyphMargin: true,
      lineDecorationsWidth: 10,
      bracketPairColorization: { enabled: false },
      guides: { indentation: true },
      stickyScroll: { enabled: false },
      fixedOverflowWidgets: true,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      inlineSuggest: { enabled: true, mode: 'subwordSmart' },
      lightbulb: { enabled: 'on' },
      contextmenu: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      'semanticHighlighting.enabled': false,
    });
    editorRef.current = ed;
    registerEditor(ed);
    for (const k of ['scope', 'bp', 'dbg', 'ex', 'agent']) decos.current[k] = ed.createDecorationsCollection();
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const name = getState().activeTab;
      if (name) A.saveFile(name);
    });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => A.compile());
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => {
      if (!getState().settings.aiOff) setState({ aiPrompt: { at: Date.now() } });
    });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => A.openPalette());
    ed.addCommand(monaco.KeyCode.F5, () => {
      const s = getState();
      const list = A.modelOf(s.files).list;
      const main = list.find((c) => c.file === s.activeTab && c.hasMain) || list.find((c) => c.hasMain);
      if (main) A.runMain(main.fileClass);
    });
    ed.addCommand(monaco.KeyCode.F9, () => {
      const pos = ed.getPosition();
      const name = getState().activeTab;
      if (pos && name && name !== '#readme') A.toggleBreakpoint(name, pos.lineNumber);
    });
    ed.onMouseDown((e) => {
      const T = monaco.editor.MouseTargetType;
      if (e.target.type !== T.GUTTER_GLYPH_MARGIN && e.target.type !== T.GUTTER_LINE_DECORATIONS) return;
      const name = getState().activeTab;
      if (name && name !== '#readme' && e.target.position) A.toggleBreakpoint(name, e.target.position.lineNumber);
    });
    // The app's own right-click menu (Monaco's built-in one is English only).
    ed.onContextMenu((e) => {
      const s = getState();
      const tr = (k, p) => translate(s.settings.lang, k, p);
      if (!ed.getModel() || !s.project) return;
      let sel = ed.getSelection();
      if (e.target.position && (!sel || !sel.containsPosition(e.target.position))) {
        ed.setPosition(e.target.position);
        sel = ed.getSelection();
      }
      const hasSel = !!sel && !sel.isEmpty();
      const name = s.activeTab;
      const isCode = !!name && name !== '#readme';
      const ro = s.project.readOnly || (s.editorMode || 'source') !== 'source';
      const line = (e.target.position || ed.getPosition()).lineNumber;
      const hasBp = isCode && (s.breakpoints[name] || []).includes(line);
      const run = (id) => () => {
        ed.focus();
        const action = ed.getAction(id);
        if (action) action.run();
      };
      const exec = (cmd) => () => {
        ed.focus();
        document.execCommand(cmd);
      };
      const items = [
        { label: tr('edit.cut'), keys: 'ctrl X', disabled: !hasSel || ro, onClick: exec('cut') },
        { label: tr('edit.copy'), keys: 'ctrl C', disabled: !hasSel, onClick: exec('copy') },
        { label: tr('edit.paste'), keys: 'ctrl V', disabled: ro, onClick: exec('paste') },
      ];
      if (A.aiOn(s)) {
        items.push({ type: 'sep' });
        if (hasSel) items.push({ label: tr('edit.explain'), icon: 'tutor', onClick: () => A.askTutor(tr('tutor.prompt.explainSelection')) });
        if (!ro) items.push({ label: tr('ai.write'), icon: 'pencil', keys: 'ctrl I', onClick: () => setState({ aiPrompt: { at: Date.now() } }) });
        items.push({ label: tr(s.settings.aiInline ? 'edit.aiInlineOff' : 'edit.aiInlineOn'), onClick: () => A.updateSettings({ aiInline: !s.settings.aiInline }) });
      }
      items.push({ type: 'sep' });
      if (isCode) items.push({ label: tr(hasBp ? 'edit.bpRemove' : 'edit.bpAdd', { line }), keys: 'F9', onClick: () => A.toggleBreakpoint(name, line) });
      items.push({ label: tr('shortcuts.comment'), keys: 'ctrl #', disabled: ro, onClick: run('editor.action.commentLine') });
      items.push({ label: tr('editor.format'), keys: 'shift Alt F', disabled: ro || !isCode, onClick: run('editor.action.formatDocument') });
      items.push({ label: tr('shortcuts.find'), keys: 'ctrl H', onClick: run('editor.action.startFindReplaceAction') });
      A.openMenu({ x: e.event.posx, y: e.event.posy, items });
    });
    ed.onDidChangeModelContent(() => {
      if (applying.current) return;
      const name = getState().activeTab;
      if (!name) return;
      A.editFile(name, ed.getValue());
      clearTimeout(saveTimer.current);
      if (getState().settings.autosave) saveTimer.current = setTimeout(() => A.saveFile(name), 1200);
    });
    let selTimer = null;
    ed.onDidChangeCursorSelection(() => {
      clearTimeout(selTimer);
      selTimer = setTimeout(() => {
        const sel = ed.getSelection();
        const model = ed.getModel();
        if (!sel || !model) return;
        const text = model.getValueInRange(sel);
        setState({ editorSelection: text.trim() ? { file: getState().activeTab, from: sel.startLineNumber, to: sel.endLineNumber, text } : null, cursor: { line: sel.positionLineNumber, col: sel.positionColumn } });
      }, 120);
    });
    return () => {
      clearTimeout(saveTimer.current);
      registerEditor(null);
      ed.dispose();
    };
  }, []);

  useEffect(() => {
    if (project) disposeOthers(project.dir);
  }, [project && project.dir]);

  // Show the active file; keep models in step with the store (inserts, AI changes, external changes).
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !project) return;
    const file = active && fileOf(active);
    if (!file) {
      ed.setModel(null);
      return;
    }
    const m = modelFor(project.dir, file.name, file.content);
    if (ed.getModel() !== m) ed.setModel(m);
    if (m.getValue() !== file.content) {
      applying.current = true;
      m.pushEditOperations([], [{ range: m.getFullModelRange(), text: file.content }], () => null);
      applying.current = false;
    }
    // Prose (the README with an exercise's task) wraps; code keeps its lines.
    ed.updateOptions({ readOnly: !!project.readOnly, wordWrap: active === '#readme' ? 'on' : 'off' });
  }, [active, files, readme, project]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    monaco.editor.setTheme('blackj-' + settings.theme);
    ed.updateOptions({ fontSize: settings.fontSize, lineHeight: Math.round(settings.fontSize * 1.6), inlineSuggest: { enabled: !!settings.aiInline } });
  }, [settings.theme, settings.fontSize, settings.aiInline]);

  // BlueJ-style scope colours, recomputed shortly after typing.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !decos.current.scope) return;
    const file = active && files[active];
    if (!file || !settings.scopeColors) {
      decos.current.scope.clear();
      return undefined;
    }
    const timer = setTimeout(() => decos.current.scope.set(scopeDecorations(file.content)), 120);
    return () => clearTimeout(timer);
  }, [active, files, settings.scopeColors]);

  // Breakpoints and the line the debugger stopped on.
  useEffect(() => {
    if (!decos.current.bp) return;
    const lines = (active && breakpoints && breakpoints[active]) || [];
    const f = paused && paused.frames && paused.frames[paused.frame || 0];
    const here = f && active === A.fileOfClass(f.className);
    // On the paused line only the current-frame bar shows; the breakpoint dot would collide with it.
    const dots = here ? lines.filter((l) => l !== f.line) : lines;
    decos.current.bp.set(dots.map((l) => ({ range: new monaco.Range(l, 1, l, 1), options: { glyphMarginClassName: 'bp-glyph', glyphMarginHoverMessage: { value: t('debug.breakpointHover') } } })));
    if (here) {
      decos.current.dbg.set([{ range: new monaco.Range(f.line, 1, f.line, 1), options: { isWholeLine: true, className: 'dbg-line', glyphMarginClassName: 'dbg-glyph' } }]);
    } else decos.current.dbg.clear();
  }, [active, breakpoints, paused]);

  // Compiler problems as markers, with the plain-language explanation first.
  useEffect(() => {
    if (!project) return;
    for (const [key, m] of models) {
      if (!key.startsWith(project.dir + '|')) continue;
      const name = decodeURIComponent(key.slice(project.dir.length + 1));
      const markers = compile.state === 'errors'
        ? compile.problems.filter((p) => p.file === name).map((p) => {
            const ex = explainProblem(p, settings.lang);
            const line = Math.min(p.line, m.getLineCount());
            return {
              severity: p.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
              message: `${ex.title}\n${ex.explain}\n${ex.fix}\n\njavac: ${p.message}${p.details.length ? '\n' + p.details.join('\n') : ''}`,
              startLineNumber: line,
              endLineNumber: line,
              startColumn: Math.max(1, p.column),
              endColumn: Math.max(p.column + 1, m.getLineMaxColumn(line)),
              source: 'BlackJ',
            };
          })
        : [];
      monaco.editor.setModelMarkers(m, 'javac', markers);
    }
  }, [compile, settings.lang, project, tabs]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !decos.current.ex) return;
    const f = exception && exception.frame;
    if (f && active === A.fileOfClass(f.className)) {
      const ex = explainException(exception.simpleType, settings.lang);
      decos.current.ex.set([{ range: new monaco.Range(f.line, 1, f.line, 1), options: { isWholeLine: true, className: 'exception-line', linesDecorationsClassName: 'exception-glyph', hoverMessage: { value: `**${exception.simpleType}**: ${ex.title}\n\n${exception.message || ''}` } } }]);
    } else decos.current.ex.clear();
  }, [exception, active, settings.lang]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !reveal || reveal.name !== active) return;
    const t0 = setTimeout(() => {
      ed.revealLineInCenter(reveal.line);
      ed.setPosition({ lineNumber: reveal.line, column: 1 });
      ed.focus();
    }, 30);
    return () => clearTimeout(t0);
  }, [reveal, active]);

  // The lines the tutor points at (open_file with a range): a short, quiet highlight.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !decos.current.agent) return undefined;
    if (!agentHighlight || agentHighlight.file !== active || !ed.getModel()) {
      decos.current.agent.clear();
      return undefined;
    }
    const m = ed.getModel();
    const to = Math.min(agentHighlight.to, m.getLineCount());
    decos.current.agent.set([{ range: new monaco.Range(agentHighlight.from, 1, to, 1), options: { isWholeLine: true, className: 'agent-hl' } }]);
    const timer = setTimeout(() => decos.current.agent.clear(), Math.max(0, 1600 - (Date.now() - agentHighlight.at)));
    return () => clearTimeout(timer);
  }, [agentHighlight, active]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !insertRequest || !ed.getModel()) return;
    ed.executeEdits('tutor', [{ range: ed.getSelection(), text: insertRequest.code, forceMoveMarkers: true }]);
    ed.focus();
  }, [insertRequest]);

  // Keep the active file tab in view when the strip scrolls.
  const tabsRef = useRef(null);
  // The strip fades only on a side where tabs are hidden.
  const updateFade = () => {
    const el = tabsRef.current;
    if (!el) return;
    el.classList.toggle('fade-l', el.scrollLeft > 1);
    el.classList.toggle('fade-r', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };
  // Scrolls just far enough to show the active tab, then lands on a tab boundary: the first tab
  // that is at least half visible starts at the strip's left edge, in line with the breadcrumb.
  const alignTabs = () => {
    const strip = tabsRef.current;
    if (!strip) return;
    strip.style.paddingRight = '';
    const items = [...strip.querySelectorAll('.tab')];
    const el = strip.querySelector('.tab[aria-selected="true"]');
    if (el && items.length) {
      const sr = strip.getBoundingClientRect();
      const at = (t) => {
        const r = t.getBoundingClientRect();
        return { l: r.left - sr.left + strip.scrollLeft, r: r.right - sr.left + strip.scrollLeft };
      };
      const spans = items.map(at);
      const a = at(el);
      const w = strip.clientWidth;
      let left = strip.scrollLeft;
      if (a.l < left) left = a.l;
      else if (a.r > left + w) left = a.r - w;
      const half = spans.find((p) => p.r - Math.max(p.l, left) >= (p.r - p.l) / 2);
      const next = spans.find((p) => p.l >= left - 0.5);
      let snap = half ? half.l : left;
      if (a.r > snap + w + 0.5 && next) snap = next.l;
      snap = Math.max(0, Math.round(snap - spans[0].l));
      const room = snap + w - strip.scrollWidth;
      if (room > 0) strip.style.paddingRight = room + 'px';
      strip.scrollLeft = snap;
    }
    updateFade();
  };
  const alignTabsRef = useRef(alignTabs);
  alignTabsRef.current = alignTabs;
  useEffect(() => {
    alignTabs();
  }, [active, tabs]);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return undefined;
    let lastW = -1;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === lastW) return;
      lastW = el.offsetWidth;
      alignTabsRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const file = active && fileOf(active);
  const isJava = file && active !== '#readme';
  const info = isJava ? infoFor(files[active]) : null;
  const method = info && cursor ? [...info.methods, ...info.ctors].filter((m) => m.line <= cursor.line).sort((a, b) => b.line - a.line)[0] : null;
  const format = () => {
    const ed = editorRef.current;
    if (ed && ed.getModel()) ed.getAction('editor.action.formatDocument').run();
  };
  const hasSelection = selection && selection.file === active;
  const proposal = active && active !== '#readme' ? proposalFor(proposals, active) : null;
  const proposalStat = proposal ? lineDiff(proposal.before, proposal.after) : null;

  return (
    <section className="panel editor-panel" aria-label="Editor">
      <div className="panel-head">
        <div className="tabs" role="tablist" ref={tabsRef} onScroll={updateFade}>
          {tabs.map((name) => {
            const f = fileOf(name);
            if (!f) return null;
            const label = name === '#readme' ? f.className : A.simpleName(f.className);
            return (
              <button
                key={name}
                className="tab"
                role="tab"
                data-tour={name === '#readme' ? undefined : 'editor-tab:' + name}
                aria-selected={name === active}
                title={name}
                onClick={() => A.openFile(name)}
                onMouseDown={(e) => e.button === 1 && A.closeTab(name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const others = tabs.filter((x) => x !== name);
                  A.openMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      { label: t('tab.close'), icon: 'close', onClick: () => { A.saveFile(name); A.closeTab(name); } },
                      { label: t('tab.closeOthers'), disabled: !others.length, onClick: () => others.forEach((x) => { A.saveFile(x); A.closeTab(x); }) },
                      { label: t('tab.closeAll'), onClick: () => tabs.forEach((x) => { A.saveFile(x); A.closeTab(x); }) },
                      ...(name !== '#readme' ? [{ type: 'sep' }, { label: t('tab.showInDiagram'), icon: 'grid', onClick: () => { const f = files[name]; if (f.pkg !== getState().pkg) A.enterPackage(f.pkg); setState({ selectedClass: f.className }); } }] : []),
                    ],
                  });
                }}
              >
                <span className="tab-label">{label}</span>
                {A.isDirty(f) ? <span className="dirty" title={t('editor.unsaved')} /> : proposalFor(proposals, name) ? <span className="dirty" title={t('agent.bar.text')} /> : null}
                <span className="tab-close" role="button" aria-label={t('common.close')} onClick={(e) => { e.stopPropagation(); A.saveFile(name); A.closeTab(name); }}>
                  <Icon name="close" />
                </span>
              </button>
            );
          })}
        </div>
        <span className="grow" />
        {isJava && (
          <div className="editor-tools">
            <div className="seg seg-sm" role="group" data-tour="editor-mode">
              <button aria-pressed={mode === 'source'} onClick={() => setState({ editorMode: 'source' })}>{t('editor.source')}</button>
              <button aria-pressed={mode === 'docs'} onClick={() => setState({ editorMode: 'docs' })}>{t('editor.docs')}</button>
            </div>
            <button className="icon-btn" data-tour="format" title={t('editor.format') + ' (' + formatKeys(settings.lang, 'shift Alt F', '+') + ')'} aria-label={t('editor.format')} onClick={format} disabled={project.readOnly || mode !== 'source'}>
              <Icon name="indent" />
            </button>
            {!settings.aiOff && (
              <>
                {hasKey && (
                <button className="btn btn-sm btn-quiet ai-btn" data-tour="ai-write" title={t('ai.write') + ' (' + formatKeys(settings.lang, 'ctrl I', '+') + ')'} onClick={() => setState({ aiPrompt: { at: Date.now() } })} disabled={project.readOnly || mode !== 'source'}>
                  <Icon name="pencil" />
                  <span className="wide-only">{t('ai.writeShort')}</span>
                </button>
                )}
                <button
                  className="btn btn-sm btn-quiet"
                  data-tour="explain"
                  title={hasSelection ? t('editor.explain') : t('editor.explainFile')}
                  onClick={() => A.askTutor(hasSelection ? translate(settings.lang, 'tutor.prompt.explainSelection') : translate(settings.lang, 'tutor.prompt.explainFile', { file: A.simpleName(file.className) + '.java' }))}
                >
                  <Icon name="tutor" />
                  <span className="wide-only">{hasSelection ? t('editor.explain') : t('editor.explainShort')}</span>
                </button>
              </>
            )}
          </div>
        )}
        <PopOut panel="editor" />
      </div>
      {proposal && (
        <div className={'proposal-bar' + (cardBeside ? ' quiet' : '')}>
          <span>{t(cardBeside ? 'agent.bar.open' : 'agent.bar.text')}</span>
          {proposalStat && <span className="stat">+{proposalStat.added} −{proposalStat.removed}</span>}
          <span className="grow" />
          {cardBeside ? (
            <button className="link" onClick={() => setState({ dialog: { type: 'diff', proposalId: proposal.id, file: proposal.file, original: proposal.before, modified: proposal.after } })}>{t('agent.diff.view')}</button>
          ) : (
            <>
              <button className="btn btn-sm btn-quiet" onClick={() => setState({ dialog: { type: 'diff', proposalId: proposal.id, file: proposal.file, original: proposal.before, modified: proposal.after } })}>{t('agent.diff.view')}</button>
              <button className="btn btn-sm btn-quiet" disabled={!!proposal.busy} onClick={() => A.rejectProposal(proposal.id)}>{t('agent.diff.reject')}</button>
              <button className="btn btn-sm btn-primary" data-tour="proposal-accept" disabled={!!proposal.busy} onClick={() => A.acceptProposal(proposal.id)}>{t('agent.diff.accept')}</button>
            </>
          )}
        </div>
      )}
      {isJava && mode === 'source' && (files[active].pkg || method || (compile.state === 'errors' && hasKey && compile.problems.some((p) => p.file === active))) && (
        <div className="breadcrumb">
          <span className="muted">{files[active].pkg ? files[active].pkg + ' ›' : ''}</span>
          <span>{A.simpleName(files[active].className)}</span>
          {method && (
            <>
              <span className="muted">›</span>
              <span>{method.name}({method.params.map((p) => p.type).join(', ')})</span>
            </>
          )}
          <span className="grow" />
          {compile.state === 'errors' && compile.problems.some((p) => p.file === active) && hasKey && (
            <button className="link" onClick={() => A.aiFix(compile.problems.find((p) => p.file === active))}>{t('ai.fix')}</button>
          )}
        </div>
      )}
      <div className="editor-wrap" data-tour="editor">
        <div className="editor-host" ref={hostRef} style={{ visibility: file && (mode === 'source' || !isJava) ? 'visible' : 'hidden' }} />
        {isJava && mode === 'docs' && <DocsView info={info} />}
        {!file && <div className="editor-empty">{t('editor.none')}</div>}
        <AiPrompt editorRef={editorRef} />
      </div>
    </section>
  );
}
