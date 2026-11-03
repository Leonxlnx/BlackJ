import { useEffect, useRef, useState } from 'react';
import { useStore, getState, setState } from '../store.js';
import { useT, translate } from '../i18n.js';
import * as A from '../actions.js';
import { api } from '../api.js';
import monaco, { defineThemes } from '../lib/monaco.js';
import { KEYWORDS } from '../lib/keywords.js';
import { reindent } from '../lib/format.js';
import { explainProblem } from '../lib/errors.js';
import { explainException } from '../lib/exceptions.js';
import { scopeRanges } from '../lib/javaParse.js';
import { infoFor } from '../model.js';
import Icon from './Icon.jsx';
import DocsView from './DocsView.jsx';

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
      const entry = KEYWORDS[word.word];
      if (!entry) return null;
      return {
        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
        contents: [{ value: `**${word.word}** — ${entry[s.settings.lang] || entry.de}` }],
      };
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
      if (!s.settings.aiInline || !s.info.tutor.hasKey || !s.project || s.project.readOnly) return { items: [] };
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

  monaco.editor.registerCommand('blackj.aiFix', (_accessor, problem) => A.aiFix(problem));
  monaco.languages.registerCodeActionProvider('java', {
    provideCodeActions(model, _range, context) {
      const s = getState();
      if (!s.info.tutor.hasKey || s.compile.state !== 'errors') return { actions: [], dispose() {} };
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
      <Icon name="spark" />
      {busy ? (
        <span className="ai-busy">{t('ai.working')} <span className="muted">„{busy.instruction}“</span></span>
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
  const hasKey = useStore((s) => s.info.tutor.hasKey);
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
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      'semanticHighlighting.enabled': false,
    });
    editorRef.current = ed;
    for (const k of ['scope', 'bp', 'dbg', 'ex']) decos.current[k] = ed.createDecorationsCollection();
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const name = getState().activeTab;
      if (name) A.saveFile(name);
    });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => A.compile());
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => setState({ aiPrompt: { at: Date.now() } }));
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
    ed.updateOptions({ readOnly: !!project.readOnly });
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
    decos.current.bp.set(lines.map((l) => ({ range: new monaco.Range(l, 1, l, 1), options: { glyphMarginClassName: 'bp-glyph', glyphMarginHoverMessage: { value: t('debug.breakpoint') } } })));
    const f = paused && paused.frames && paused.frames[paused.frame || 0];
    if (f && active === A.fileOfClass(f.className)) {
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

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !insertRequest || !ed.getModel()) return;
    ed.executeEdits('tutor', [{ range: ed.getSelection(), text: insertRequest.code, forceMoveMarkers: true }]);
    ed.focus();
  }, [insertRequest]);

  const file = active && fileOf(active);
  const isJava = file && active !== '#readme';
  const info = isJava ? infoFor(files[active]) : null;
  const method = info && cursor ? [...info.methods, ...info.ctors].filter((m) => m.line <= cursor.line).sort((a, b) => b.line - a.line)[0] : null;
  const format = () => {
    const ed = editorRef.current;
    if (ed && ed.getModel()) ed.getAction('editor.action.formatDocument').run();
  };
  const hasSelection = selection && selection.file === active;

  return (
    <section className="panel editor-panel" aria-label="Editor">
      <div className="panel-head">
        <div className="tabs" role="tablist">
          {tabs.map((name) => {
            const f = fileOf(name);
            if (!f) return null;
            const label = name === '#readme' ? f.className : A.simpleName(f.className);
            return (
              <button
                key={name}
                className="tab"
                role="tab"
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
                {A.isDirty(f) ? <span className="dirty" title={t('editor.unsaved')} /> : null}
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
            <div className="seg seg-sm" role="group">
              <button aria-pressed={mode === 'source'} onClick={() => setState({ editorMode: 'source' })}>{t('editor.source')}</button>
              <button aria-pressed={mode === 'docs'} onClick={() => setState({ editorMode: 'docs' })}>{t('editor.docs')}</button>
            </div>
            <button className="icon-btn" title={t('editor.format') + ' (Umschalt+Alt+F)'} aria-label={t('editor.format')} onClick={format} disabled={project.readOnly || mode !== 'source'}>
              <Icon name="indent" />
            </button>
            <button className="btn btn-sm btn-quiet ai-btn" title={t('ai.write') + ' (Strg+I)'} onClick={() => setState({ aiPrompt: { at: Date.now() } })} disabled={project.readOnly || !hasKey || mode !== 'source'}>
              <Icon name="spark" />
              <span className="wide-only">{t('ai.writeShort')}</span>
            </button>
            <button
              className="btn btn-sm btn-quiet"
              title={hasSelection ? t('editor.explain') : t('editor.explainFile')}
              onClick={() => A.askTutor(hasSelection ? translate(settings.lang, 'tutor.prompt.explainSelection') : translate(settings.lang, 'tutor.prompt.explainFile', { file: A.simpleName(file.className) + '.java' }))}
            >
              <Icon name="tutor" />
              <span className="wide-only">{hasSelection ? t('editor.explain') : t('editor.explainShort')}</span>
            </button>
          </div>
        )}
      </div>
      {isJava && mode === 'source' && (
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
      <div className="editor-wrap">
        <div className="editor-host" ref={hostRef} style={{ visibility: file && (mode === 'source' || !isJava) ? 'visible' : 'hidden' }} />
        {isJava && mode === 'docs' && <DocsView info={info} />}
        {!file && <div className="editor-empty">{t('editor.none')}</div>}
        <AiPrompt editorRef={editorRef} />
      </div>
    </section>
  );
}
