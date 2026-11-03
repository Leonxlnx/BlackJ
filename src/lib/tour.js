// Where a tutorial step points: resolving target ids to elements (or editor lines), opening what a
// target needs before it can be seen, and checking a tutorial before it starts.
import { getState, setState } from '../store.js';
import * as A from '../actions.js';
import { projectModel, simpleName } from '../model.js';
import monaco from './monaco.js';
import { TARGETS, parseTarget } from './tour-targets.mjs';

export { TARGETS, parseTarget };

let editor = null;
/** EditorPanel hands over its Monaco editor so line targets can be measured. */
export function registerEditor(ed) {
  editor = ed;
}

const DOCK_OF = { bench: 'objects', object: 'objects', library: 'objects', 'console-input': 'console', 'pad-input': 'pad', 'tests-run': 'tests', problem: 'problems', debug: 'debug' };
const SIDE_OF = { 'side-tab': null, inspector: 'inspect', composer: 'tutor', 'tutor-mode': 'tutor', 'new-chat': 'tutor' };
const EDITOR_KINDS = new Set(['editor', 'editor-tab', 'line', 'gutter', 'editor-mode', 'format', 'ai-write', 'explain']);
/** The panel a target lives in ('editor', 'dock', 'side'), or null (the diagram, the title bar, menus). */
function panelOf(t) {
  if (EDITOR_KINDS.has(t.kind)) return 'editor';
  if (t.kind === 'dock' || t.kind in DOCK_OF) return 'dock';
  if (t.kind in SIDE_OF) return 'side';
  return null;
}

// Targets that only appear after an earlier step (a menu, a dialog) or in some states.
const LATER = new Set(['menu', 'dialog', 'class-new', 'stop', 'state', 'proposal-accept', 'tests-run', 'debug']);

/** A class by qualified name, or by simple name when that is unique. */
function classOf(model, name) {
  if (model.byName[name]) return model.byName[name];
  const hits = model.bySimple[name] || [];
  return hits.length === 1 ? model.byName[hits[0]] : null;
}

/**
 * Checks one step before the tutorial starts: null, { error } for a target that cannot exist, or
 * { warning } for one that appears only after an earlier step.
 */
export function check(id, earlier = []) {
  const t = parseTarget(id);
  if (!t) return { error: `Unknown target "${id}". Kinds: ${[...new Set(TARGETS.map((r) => r.kind))].join(', ')}.` };
  const s = getState();
  const model = s.project ? projectModel(s.files) : null;
  const needProject = !['rail', 'settings', 'search'].includes(t.kind);
  if (needProject && !s.project) return { error: 'No project is open.' };
  if (t.kind === 'class' || t.kind === 'class-new') {
    if (!classOf(model, t.arg)) return { error: `No class ${t.arg}. Classes: ${model.list.map((c) => c.fileClass).slice(0, 30).join(', ')}` };
  }
  if (t.kind === 'package' && !model.packages.includes(t.arg) && !(s.extraPackages || []).includes(t.arg)) return { error: `No package ${t.arg}.` };
  if (t.kind === 'object' && !s.bench.objects.some((o) => o.name === t.arg) && !earlier.some((x) => x.action === 'object_created')) {
    return { error: `No object ${t.arg} on the object bench.` };
  }
  if (t.kind === 'editor-tab' || t.kind === 'line' || t.kind === 'gutter') {
    const f = s.files[t.arg];
    if (!f) return { error: `No file ${t.arg}.` };
    if (t.arg2 && t.arg2 > f.content.split('\n').length) return { error: `${t.arg} has only ${f.content.split('\n').length} lines.` };
  }
  if (t.kind === 'run-main' && model && !model.list.some((c) => c.hasMain)) return { error: 'No class has a main method.' };
  if (t.kind === 'rail' && t.arg === 'project' && !s.project) return { error: 'No project is open.' };
  if (LATER.has(t.kind)) return { warning: `${id} appears only after the step before it` };
  // The ring is drawn in the main window only: a popped-out panel docks back for the step.
  const p = panelOf(t);
  if (p && s.layout.detached.includes(p)) return { warning: `the ${p} panel is in its own window; it docks back into the main window for this step` };
  return null;
}

/** Opens what the target needs to be visible: the project view, a dock tab, a package, a file. */
export function prepare(id) {
  const t = parseTarget(id);
  if (!t) return;
  const s = getState();
  if (!['rail', 'settings', 'search'].includes(t.kind) && s.project && s.view !== 'project') A.go('project');
  // The overlay only covers the main window: a target in a pop-out comes back to it.
  const panel = panelOf(t);
  if (panel && s.layout.detached.includes(panel)) A.dockBack(panel);
  const dock = t.kind === 'dock' ? t.arg : DOCK_OF[t.kind];
  if (dock && (s.dock !== dock || s.dockCollapsed)) setState({ dock, dockCollapsed: false });
  if ((t.kind === 'class' || t.kind === 'class-new') && s.project) {
    const info = classOf(projectModel(s.files), t.arg);
    if (info) {
      if (info.pkg !== s.pkg) A.enterPackage(info.pkg);
      setState({ revealCard: { key: info.fileClass, at: Date.now() } });
    }
  }
  if (t.kind === 'package' && s.project) {
    const parent = t.arg.includes('.') ? t.arg.slice(0, t.arg.lastIndexOf('.')) : '';
    if (parent !== s.pkg) A.enterPackage(parent);
    setState({ revealCard: { key: 'pkg:' + t.arg, at: Date.now() } });
  }
  if (t.kind === 'readme' && s.pkg) A.enterPackage('');
  if (t.kind === 'editor-tab' || t.kind === 'line' || t.kind === 'gutter') {
    if (s.activeTab !== t.arg || (s.editorMode || 'source') !== 'source') A.openFile(t.arg);
    if (t.arg2) {
      const line = t.arg2;
      setTimeout(() => {
        if (editor && getState().activeTab === t.arg && editor.getModel()) editor.revealLineInCenterIfOutsideViewport(line);
      }, 60);
    }
  }
  if (t.kind in SIDE_OF) setState({ tutorOpen: true, side: t.kind === 'side-tab' ? t.arg : SIDE_OF[t.kind] });
  else if (getState().drawer && getState().tutorOpen && !['menu', 'dialog'].includes(t.kind)) setState({ tutorOpen: false });
  if (t.kind === 'settings' && s.view !== 'settings') A.go('settings');
}

const visible = (el) => !!el && el.getClientRects().length > 0;

/** The element of a target, or null while it is not on screen. */
export function resolve(id) {
  const t = parseTarget(id);
  if (!t || t.kind === 'line' || t.kind === 'gutter') return null;
  const exact = [...document.querySelectorAll(`[data-tour="${CSS.escape(id)}"]`)].find(visible);
  if (exact) return exact;
  // The first constructor is "menu:new"; "menu:new:0" means the same item.
  if (id === 'menu:new:0') return resolve('menu:new');
  // class:Hund also finds class:tiere.Hund when only one class has that simple name.
  if ((t.kind === 'class' || t.kind === 'class-new' || t.kind === 'package') && !t.arg.includes('.')) {
    const hits = [...document.querySelectorAll(`[data-tour^="${t.kind}:"]`)].filter((el) => simpleName(el.dataset.tour.slice(t.kind.length + 1)) === t.arg && visible(el));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** The screen rectangle of one editor line (its text) or of its breakpoint margin. */
function lineRect(path, line, part) {
  const ed = editor;
  if (!ed || getState().activeTab !== path || !ed.getModel()) return null;
  const model = ed.getModel();
  if (line > model.getLineCount()) return null;
  const host = ed.getDomNode();
  if (!visible(host)) return null;
  const box = host.getBoundingClientRect();
  const layout = ed.getLayoutInfo();
  const h = ed.getOption(monaco.editor.EditorOption.lineHeight) || 20;
  const start = ed.getScrolledVisiblePosition({ lineNumber: line, column: Math.max(1, model.getLineFirstNonWhitespaceColumn(line) || 1) });
  if (!start || start.top < -2 || start.top + h > layout.height + 2) return null;
  if (part === 'gutter') return new DOMRect(box.left + layout.glyphMarginLeft, box.top + start.top, Math.max(16, layout.contentLeft - layout.glyphMarginLeft), h);
  const stop = ed.getScrolledVisiblePosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
  const left = box.left + Math.max(layout.contentLeft, start.left);
  const right = Math.min(box.left + layout.contentLeft + layout.contentWidth - layout.verticalScrollbarWidth, box.left + Math.max(stop ? stop.left : start.left, start.left + 24));
  return new DOMRect(left, box.top + start.top, Math.max(24, right - left), h);
}

/** The rectangle a ring goes around, or null while the target is not visible. */
export function rectOf(id) {
  const t = parseTarget(id);
  if (!t) return null;
  if (t.kind === 'line' || t.kind === 'gutter') return lineRect(t.arg, t.arg2, t.kind);
  const el = resolve(id);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? r : null;
}
