// Everything the interface can do, in one place. Components call these; these update the store.
import { getState, setState, subscribe, toast } from './store.js';
import { api } from './api.js';
import { translate } from './i18n.js';
import { projectModel, layoutAll, autoLayout, fileOfClass, simpleName, packageOfClass } from './model.js';
import { template } from './lib/templates.js';
import * as Agent from './agent.js';
import { prepare as prepareTarget, rectOf } from './lib/tour.js';
import * as Layout from './lib/layout.js';
import { startOwner } from './panels.js';

const t = (k, p) => translate(getState().settings.lang, k, p);
let nextId = 1;
const uid = () => nextId++;

// ------------------------------------------------------------------ start

export async function init() {
  const info = await api.init();
  setState({ info, settings: info.settings, chat: { turns: [], busy: false, mode: info.settings.tutorMode, notes: [], hiddenChips: {} }, ready: true });
  applyLook(info.settings);
  api.bench.onOut(onBenchOut);
  api.bench.onState(onBenchState);
  if (api.bench.onWindow) api.bench.onWindow((w) => note(w.title ? t('console.window', { title: w.title }) : t('console.windowUntitled')));
  api.ai.onEvent(onAiEvent);
  Agent.init();
  if (api.debug) api.debug.onEvent(onDebugEvent);
  if (api.onProjectChanged) api.onProjectChanged(onProjectChanged);
  startOwner();
  if (info.smoke) import('./smoke.js').then((m) => m.runSmoke());
}

function applyLook(s) {
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.lang = s.lang;
  if (api.windowTheme) api.windowTheme(s.theme);
}

export async function updateSettings(patch) {
  if (patch.aiOff && getState().chat.busy) stopTutor();
  const before = getState().settings;
  const settings = await api.setSettings(patch);
  setState({ settings });
  applyLook(settings);
  if ('tutorMode' in patch) {
    if (!getState().chat.turns.length) setState((s) => ({ chat: { ...s.chat, mode: patch.tutorMode } }));
    else if (patch.tutorMode !== before.tutorMode && patch.tutorMode !== getState().chat.mode) toast(t('tutor.modeChanged'));
  }
  return settings;
}

export function go(view) {
  setState((s) => ({ view, menu: null, palette: null, toast: s.view === view ? s.toast : null }));
}

export function errorText(err) {
  if (!err) return '';
  if (err.kind === 'bench' || err.kind === 'app') {
    const key = 'err.' + err.code;
    const s = t(key, { message: err.message || '', ...(err.params || {}) });
    if (s !== key) return s;
    return t('err.generic', { message: err.message || err.code });
  }
  return t('err.generic', { message: err.message || String(err) });
}

// ------------------------------------------------------------------ projects

function loadProject(p) {
  const files = {};
  for (const f of p.files) files[f.name] = { name: f.name, className: f.className, pkg: f.pkg || '', content: f.content, saved: f.content };
  const model = projectModel(files);
  const stored = p.positions || {};
  const positions = layoutAll(model, stored);
  // Positions saved before BlackJ marked arranged packages ('#moved:<pkg>'), or read from BlueJ:
  // a package whose cards are not where the automatic layout would put them was arranged by hand.
  if (!stored['#v']) {
    positions['#v'] = 2;
    const scratch = layoutAll(model, {});
    const pkgOf = (k) => (k.startsWith('pkg:') ? packageOfClass(k.slice(4)) : model.byName[k] ? model.byName[k].pkg : null);
    for (const [k, v] of Object.entries(stored)) {
      const pk = pkgOf(k);
      if (pk == null || k.startsWith('#')) continue;
      if (!scratch[k] || scratch[k].x !== v.x || scratch[k].y !== v.y) positions['#moved:' + pk] = true;
    }
  }
  const firstTab = p.files.find((f) => f.content.includes('static void main')) || p.files.find((f) => !/Test\.java$/.test(f.name)) || p.files[0];
  // An exercise opens with its task (README) in front, the class to work on next to it.
  const tabs = firstTab ? [firstTab.name] : [];
  if (p.exercise && p.readme) tabs.unshift('#readme');
  // The tutor never carries a turn (or its tools) over into another project.
  const prev = getState().project;
  if (getState().chat.busy && (!prev || prev.dir !== p.dir)) stopTutor();
  endTour('closed');
  setState({
    project: { dir: p.dir, name: p.name, readOnly: p.readOnly, fromBlueJ: p.fromBlueJ, libs: p.libs || [], exercise: p.exercise || null, startFiles: p.files.map((f) => f.name) },
    files,
    readme: p.readme ? { ...p.readme, saved: p.readme.content } : null,
    extraPackages: [],
    pkg: '',
    positions,
    compile: { state: 'never', problems: [], snapshot: {}, ms: 0 },
    bench: { state: 'off', objects: [], java: null },
    classInfo: {},
    console: [],
    exception: null,
    tabs,
    activeTab: tabs[0] || null,
    reveal: null,
    view: 'project',
    dock: 'objects',
    selectedClass: null,
    dialog: null,
    menu: null,
    pad: { entries: [], vars: [], busy: false },
    tests: { running: false, summary: null, results: [], ranAt: null },
    recording: null,
    breakpoints: {},
    debug: { attached: false, paused: null },
    inspect: null,
    side: 'tutor',
    layout: { tree: storedLayout(p.dir), detached: getState().layout.detached },
  });
  newChat();
  if (JSON.stringify(p.positions || {}) !== JSON.stringify(positions)) persistPositions();
}

async function handleOpen(promise) {
  const r = await promise;
  if (r.ok) {
    loadProject(r.result);
    const info = await api.init();
    setState({ info, settings: info.settings });
  } else if (r.error.code !== 'canceled') toast(r.error.code === 'missing' ? t('home.missing') : errorText(r.error), 'bad');
  return r.ok;
}

export const openPath = (p) => handleOpen(api.project.open(p));
export const dropText = () => t('drop.hint');

export async function removeRecent(dir) {
  const recent = (getState().settings.recent || []).filter((r) => r.dir !== dir);
  await updateSettings({ recent });
}

export const openDialog = () => handleOpen(api.project.openDialog());
export const openZip = () => handleOpen(api.project.openZipDialog());

/** Project → Save As: works on a copy from now on, the original stays as it was. */
export async function saveProjectAs(name) {
  if (!getState().project) return false;
  await saveAll();
  const ok = await handleOpen(api.project.saveAs(name ? { name } : {}));
  if (ok) toast(t('saveAs.done', { dir: getState().project.dir }));
  return ok;
}

/** Tools → Project Documentation: Javadoc for every class, opened in the browser. */
export async function generateJavadoc() {
  const s = getState();
  if (!s.project) return null;
  await saveAll();
  setState({ javadocBusy: true });
  toast(t('javadoc.running'));
  const r = await api.project.javadoc();
  setState({ javadocBusy: false });
  if (r.ok) toast(t('javadoc.done'));
  else toast(errorText(r.error), 'bad');
  return r.ok ? r.result : null;
}

/** Edit → Add Class from File: copies .java files into the package that is open in the diagram. */
export async function addClassesFromFiles(files) {
  const s = getState();
  if (!s.project || s.project.readOnly) return null;
  const r = await api.project.addFiles({ pkg: s.pkg, ...(files ? { files } : {}) });
  if (!r.ok) {
    if (r.error.code !== 'canceled') toast(errorText(r.error), 'bad');
    return null;
  }
  setState((st) => {
    const next = { ...st.files };
    for (const f of r.result) next[f.name] = { ...f, pkg: f.pkg || '', saved: f.content };
    return { files: next };
  });
  setState((st) => ({ positions: autoLayout(projectModel(getState().files), st.positions, s.pkg) }));
  persistPositions();
  if (r.result[0]) openFile(r.result[0].name);
  toast(t('addFiles.done', { n: r.result.length }));
  return r.result;
}

export async function saveDiagramImage(rect) {
  const s = getState();
  if (!s.project) return null;
  const r = await api.diagram.savePng({ rect, name: `${s.project.name} – ${t('diagram.title')}` });
  if (r.ok) toast(t('diagram.imageSaved', { file: r.result.file }));
  else if (r.error.code !== 'canceled') toast(errorText(r.error), 'bad');
  return r.ok ? r.result : null;
}

/** No Java on this PC: downloads a JDK into BlackJ's folder (BlueJ ships one in its installer). */
export async function installJdk() {
  if (getState().jdkInstall) return;
  setState({ jdkInstall: { phase: 'lookup' } });
  const off = api.onJdkProgress((p) => setState({ jdkInstall: p }));
  try {
    const r = await api.installJdk();
    if (r.ok) {
      setState((s) => ({ info: { ...s.info, jdk: r.result.jdk, jdks: r.result.jdks } }));
      toast(t('jdk.installed', { version: r.result.jdk.version }));
    } else toast(errorText(r.error), 'bad');
  } finally {
    off();
    setState({ jdkInstall: null });
  }
}

/** Prints the class diagram as it is drawn now (BlueJ: Project > Print). */
export async function printDiagram(rect) {
  const s = getState();
  if (!s.project) return;
  const r = await api.print.diagram({ rect, title: `${s.project.name} – ${t('diagram.title')}` });
  if (!r.ok && r.error.code !== 'canceled') toast(errorText(r.error), 'bad');
}

/** Prints a source file with line numbers, the project and class name on top. */
export async function printFile(name) {
  const s = getState();
  const f = s.files[name];
  if (!f) return;
  setState({ menu: null });
  const r = await api.print.source({ title: `${s.project.name} – ${name}`, text: f.content });
  if (!r.ok && r.error.code !== 'canceled') toast(errorText(r.error), 'bad');
}

/** Saves what the console shows to a text file (BlueJ: Terminal > Save to file). */
export async function saveConsole() {
  const s = getState();
  const text = s.console.map((l) => (l.stream === 'call' ? `> ${l.text}\n` : l.stream === 'note' ? `# ${l.text}\n` : l.text)).join('');
  const r = await api.saveText({ text, name: `${s.project ? s.project.name : 'BlackJ'} – ${t('dock.console')}.txt` });
  if (r.ok) toast(t('console.saved', { file: r.result.file }));
  else if (r.error.code !== 'canceled') toast(errorText(r.error), 'bad');
}

/** Packs the project's sources (no compiled classes) into a .zip, e.g. to hand in homework. */
export async function exportZip(file) {
  if (!getState().project) return;
  await saveAll();
  const r = await api.project.exportZip(file ? { file } : {});
  if (r.ok) toast(t('zip.done', { file: r.result.file, count: r.result.count }));
  else if (r.error.code !== 'canceled') toast(errorText(r.error), 'bad');
  return r.ok ? r.result : null;
}
export const openRecent = (dir) => handleOpen(api.project.open(dir));
export const openExample = (name) => handleOpen(api.project.example(name));
export const openExercise = (id) => handleOpen(api.project.exercise(id));
export const createProject = (name) => handleOpen(api.project.create(name));

export function closeProject() {
  if (getState().chat.busy) stopTutor();
  for (const p of getState().layout.detached) dockBack(p);
  endTour('closed');
  newChat();
  api.bench.reset();
  setState({ project: null, files: {}, view: 'home', tabs: [], activeTab: null, bench: { state: 'off', objects: [], java: null } });
}

export function enterPackage(pkg) {
  const s = getState();
  const model = projectModel(s.files);
  setState({ pkg, selectedClass: null, positions: autoLayout(model, s.positions, pkg) });
}

/** Keeps the diagram's flow layout of a package as stored positions: the user starts arranging. */
export function pinLayout(pkg, at) {
  setState((s) => ({ positions: { ...s.positions, ...at, '#v': 2, ['#moved:' + pkg]: true } }));
  clearTimeout(positionsTimer);
  positionsTimer = setTimeout(persistPositions, 500);
}

let positionsTimer = null;
export function setPosition(key, pos) {
  setState((s) => ({ positions: { ...s.positions, [key]: pos } }));
  clearTimeout(positionsTimer);
  positionsTimer = setTimeout(persistPositions, 500);
}

function persistPositions() {
  const s = getState();
  if (!s.project || s.project.readOnly) return;
  api.project.positions(s.positions);
}

// ------------------------------------------------------------------ files and editor

export function openFile(name, line) {
  setState((s) => ({
    tabs: s.tabs.includes(name) ? s.tabs : [...s.tabs, name],
    activeTab: name,
    reveal: line ? { name, line, at: Date.now() } : s.reveal,
    view: 'project',
    editorMode: 'source',
  }));
  // The editor in its own window comes to the front (without taking the keyboard).
  if (getState().layout.detached.includes('editor') && !getState().info.smoke) api.panel.show({ panel: 'editor' });
}

export function openClass(cls, line) {
  openFile(fileOfClass(cls), line);
}

export function closeTab(name) {
  setState((s) => {
    const tabs = s.tabs.filter((x) => x !== name);
    const idx = s.tabs.indexOf(name);
    return { tabs, activeTab: s.activeTab === name ? tabs[Math.max(0, idx - 1)] || null : s.activeTab };
  });
}

export function editFile(name, content) {
  if (name === '#readme') {
    setState((s) => ({ readme: { ...s.readme, content } }));
    return;
  }
  setState((s) => ({ files: { ...s.files, [name]: { ...s.files[name], content } } }));
}

export async function saveFile(name) {
  const s = getState();
  if (name === '#readme') {
    if (!s.readme || s.readme.content === s.readme.saved || s.project.readOnly) return true;
    const r = await api.project.write({ name: s.readme.name, content: s.readme.content });
    if (r.ok) setState((st) => ({ readme: { ...st.readme, saved: s.readme.content } }));
    return r.ok;
  }
  const f = s.files[name];
  if (!f || f.content === f.saved || s.project.readOnly) return true;
  const r = await api.project.write({ name, content: f.content });
  if (!r.ok) {
    toast(errorText(r.error), 'bad');
    return false;
  }
  setState((st) => ({ files: { ...st.files, [name]: { ...st.files[name], saved: f.content } } }));
  return true;
}

export async function saveAll() {
  for (const name of Object.keys(getState().files)) await saveFile(name);
  await saveFile('#readme');
}

export function isDirty(f) {
  return f && f.content !== f.saved;
}

export function openReadme() {
  const s = getState();
  if (!s.readme) setState({ readme: { name: 'README.TXT', content: '', saved: null } });
  openFile('#readme');
}

/** True when a class's source differs from what was last compiled. */
export function isStale(name) {
  const s = getState();
  if (s.compile.state !== 'ok') return true;
  const f = s.files[name];
  return !f || s.compile.snapshot[name] !== f.content;
}

export async function newClass(simple, kind) {
  const s = getState();
  const pkg = s.pkg;
  const qualified = pkg ? pkg + '.' + simple : simple;
  let content = kind === 'test' ? testTemplate(simple, s.settings.lang) : template(s.settings.lang, kind, simple);
  if (pkg) content = `package ${pkg};\n\n` + content;
  const r = await api.project.createClass({ className: qualified, content });
  if (!r.ok) return errorText(r.error);
  setState({ dialog: null });
  addCreatedFile(r.result);
  return null;
}

/** A class file that now exists on disk joins the project: files, diagram position, editor. */
export function addCreatedFile(f) {
  setState((st) => ({ files: { ...st.files, [f.name]: { ...f, pkg: f.pkg || '', saved: f.content } } }));
  const model = projectModel(getState().files);
  setState((st) => ({ positions: autoLayout(model, st.positions, f.pkg || '') }));
  persistPositions();
  openFile(f.name);
}

function testTemplate(name, lang) {
  const tested = name.replace(/Test$/, '');
  const de = lang !== 'en';
  return `import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * ${de ? `Testklasse für ${tested}.` : `Test class for ${tested}.`}
 */
public class ${name} {

    @BeforeEach
    public void setUp() {
        // ${de ? 'Läuft vor jedem Test: Objekte für die Tests vorbereiten.' : 'Runs before every test: prepare objects for the tests.'}
    }

    @Test
    public void ${de ? 'beispielTest' : 'exampleTest'}() {
        // ${de ? 'Ersetze diesen Test durch deinen eigenen.' : 'Replace this test with your own.'}
        assertEquals(2, 1 + 1);
    }
}
`;
}

/** A file changed outside BlackJ. Unsaved work in the editor always wins; otherwise take the new version. */
function onProjectChanged(ev) {
  const s = getState();
  if (!s.project) return;
  const f = s.files[ev.name];
  if (ev.deleted) {
    if (!f || isDirty(f)) return;
    setState((st) => {
      const files = { ...st.files };
      delete files[ev.name];
      const tabs = st.tabs.filter((x) => x !== ev.name);
      return { files, tabs, activeTab: st.activeTab === ev.name ? tabs[0] || null : st.activeTab };
    });
    return;
  }
  if (f) {
    if (f.saved === ev.content || f.content === ev.content) return;
    if (isDirty(f)) {
      toast(t('watch.conflict', { file: simpleName(f.className) + '.java' }));
      return;
    }
    setState((st) => ({ files: { ...st.files, [ev.name]: { ...st.files[ev.name], content: ev.content, saved: ev.content } } }));
    toast(t('watch.reloaded', { file: simpleName(f.className) + '.java' }));
    return;
  }
  setState((st) => ({ files: { ...st.files, [ev.name]: { name: ev.name, className: ev.className, pkg: ev.pkg, content: ev.content, saved: ev.content } } }));
  const model = projectModel(getState().files);
  setState((st) => ({ positions: autoLayout(model, st.positions, ev.pkg) }));
}

/** "class Hund is public, should be declared in a file named Hund.java": rename the file to match. */
export async function renameToClass(fileRel, className) {
  const dir = fileRel.includes('/') ? fileRel.slice(0, fileRel.lastIndexOf('/') + 1) : '';
  const to = dir + className + '.java';
  await saveFile(fileRel);
  const r = await api.project.rename({ from: fileRel, to });
  if (!r.ok) {
    toast(errorText(r.error), 'bad');
    return;
  }
  setState((s) => {
    const files = { ...s.files };
    const f = files[fileRel];
    delete files[fileRel];
    const qualified = (f.pkg ? f.pkg + '.' : '') + className;
    files[to] = { ...f, name: to, className: qualified };
    const positions = { ...s.positions };
    if (positions[f.className]) {
      positions[qualified] = positions[f.className];
      delete positions[f.className];
    }
    const tabs = s.tabs.map((x) => (x === fileRel ? to : x));
    return { files, positions, tabs, activeTab: s.activeTab === fileRel ? to : s.activeTab };
  });
  persistPositions();
  await compile();
}

/** Lays out the classes of the current package again from scratch. */
export function arrange() {
  const s = getState();
  const model = projectModel(s.files);
  const keep = Object.fromEntries(Object.entries(s.positions).filter(([k]) => {
    if (k === '#moved:' + s.pkg) return false;
    if (k.startsWith('#')) return true;
    if (k.startsWith('pkg:')) return packageOfClass(k.slice(4)) !== s.pkg;
    const info = model.byName[k];
    return info ? info.pkg !== s.pkg : true;
  }));
  setState({ positions: autoLayout(model, keep, s.pkg), arrangedAt: Date.now() });
  persistPositions();
}

export async function newPackage(name) {
  const s = getState();
  const full = s.pkg ? s.pkg + '.' + name : name;
  const r = await api.project.createPackage({ name: full });
  if (!r.ok) return errorText(r.error);
  setState((st) => ({ extraPackages: [...new Set([...(st.extraPackages || []), r.result])], dialog: null }));
  return null;
}

export async function deleteClass(cls) {
  const name = fileOfClass(cls);
  const r = await api.project.deleteClass({ name });
  if (!r.ok) {
    toast(errorText(r.error), 'bad');
    return false;
  }
  setState((s) => {
    const files = { ...s.files };
    delete files[name];
    const positions = { ...s.positions };
    delete positions[cls];
    const tabs = s.tabs.filter((x) => x !== name);
    return { files, positions, tabs, activeTab: s.activeTab === name ? tabs[0] || null : s.activeTab, dialog: null, bench: { ...s.bench, state: 'off', objects: [] } };
  });
  persistPositions();
  return true;
}

export async function exportJar(mainClass, includeSource) {
  if (getState().compile.state !== 'ok' || anyStale()) {
    await compile();
    if (getState().compile.state !== 'ok') return;
  }
  const r = await api.project.exportJar({ mainClass, includeSource });
  if (r.ok) toast(t('jar.done', { file: r.result.file }));
  else if (r.error.code !== 'canceled') toast(errorText(r.error), 'bad');
  setState({ dialog: null });
}

// ------------------------------------------------------------------ compile

export async function compile() {
  const s = getState();
  if (!s.project || s.compile.state === 'compiling') return;
  await saveAll();
  const hadObjects = s.bench.objects.length > 0;
  setState({ compile: { ...s.compile, state: 'compiling' }, menu: null });
  const r = await api.compile();
  if (!r.ok) {
    setState((st) => ({ compile: { ...st.compile, state: 'failed', failed: errorText(r.error), at: Date.now() } }));
    toast(errorText(r.error), 'bad');
    return;
  }
  const res = r.result;
  const snapshot = Object.fromEntries(Object.values(getState().files).map((f) => [f.name, f.saved]));
  setState((st) => ({
    compile: { state: res.ok ? 'ok' : 'errors', problems: res.problems, snapshot, ms: res.ms, at: Date.now(), failed: res.failed ? res.output : null },
    classInfo: {},
    exception: null,
    inspect: null,
    pad: { ...st.pad, vars: [] },
    bench: { ...st.bench, objects: [], state: res.ok ? st.bench.state : 'off' },
    debug: { ...st.debug, paused: null },
    dock: res.ok ? (st.dock === 'problems' ? 'objects' : st.dock) : 'problems',
  }));
  if (res.ok && hadObjects) note(t('console.reset'));
  if (!res.ok && res.problems[0]) openFile(res.problems[0].file, res.problems[0].line);
  if (res.failed) toast(res.output, 'bad');
  if (res.benchError) toast(res.benchError, 'bad');
}

export function anyStale() {
  return Object.keys(getState().files).some((n) => isStale(n));
}

export async function ensureCompiled() {
  if (getState().compile.state !== 'ok' || anyStale()) {
    await compile();
    if (getState().compile.state !== 'ok') return false;
  }
  await waitFor(() => getState().bench.state !== 'off', 8000);
  return getState().bench.state !== 'off';
}

// ------------------------------------------------------------------ object bench

function onBenchState(ev) {
  if (['ready', 'stopped', 'exit'].includes(ev.state)) fixtureLog = [];
  setState((s) => {
    const bench = { ...s.bench };
    if (ev.state === 'ready') Object.assign(bench, { state: 'ready', objects: [], java: ev.java });
    else if (ev.state === 'running') bench.state = 'running';
    else if (ev.state === 'idle') bench.state = 'ready';
    else if (ev.state === 'waiting') bench.state = 'waiting';
    else if (ev.state === 'stopped' || ev.state === 'exit') Object.assign(bench, { state: 'off', objects: [] });
    const patch = { bench, dock: ev.state === 'waiting' ? 'console' : s.dock };
    if (ev.state === 'ready' || ev.state === 'exit') Object.assign(patch, { inspect: null, pad: { ...s.pad, vars: [] }, debug: { ...s.debug, paused: null } });
    return patch;
  });
  if (ev.state === 'exit') note(t('console.exit', { code: ev.code ?? '?' }));
  if (ev.state === 'ready') syncBreakpoints();
}

function onBenchOut(chunks) {
  setState((s) => {
    const console = s.console.slice();
    for (const c of chunks) {
      const last = console[console.length - 1];
      if (last && last.stream === c.stream && !last.text.endsWith('\n')) console[console.length - 1] = { ...last, text: last.text + c.text };
      else console.push({ stream: c.stream, text: c.text, id: uid() });
    }
    return { console: console.length > 4000 ? console.slice(-3000) : console, dock: s.dock === 'objects' && s.bench.state === 'running' ? 'console' : s.dock };
  });
}

export function note(text) {
  setState((s) => ({ console: [...s.console, { stream: 'note', text, id: uid() }] }));
}

function logCall(text) {
  setState((s) => ({ console: [...s.console, { stream: 'call', text, id: uid() }] }));
}

export function clearConsole() {
  setState({ console: [] });
}

export async function describe(cls) {
  const s = getState();
  if (s.classInfo[cls]) return s.classInfo[cls];
  if (s.compile.state !== 'ok' || s.bench.state === 'off') return null;
  const r = await api.bench.describe({ className: cls });
  if (!r.ok) return null;
  setState((st) => ({ classInfo: { ...st.classInfo, [cls]: r.result } }));
  return r.result;
}

/** BlueJ's "Use Library Class": constructors and methods of a Java library class such as Math or ArrayList. */
export async function describeLibrary(name) {
  const clean = String(name || '').trim().replace(/\s+/g, '');
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(clean)) return { error: t('lib.invalid') };
  if (!(await ensureCompiled())) return { error: t('lib.needCompile') };
  const r = await api.bench.describe({ className: clean });
  if (!r.ok) return { error: r.error.code === 'classMissing' ? t('lib.notFound', { name: clean }) : errorText(r.error) };
  return { desc: r.result };
}

function setException(err, label) {
  const frame = (err.frames || []).find((f) => f.project && f.line > 0);
  setState({ exception: { ...err, label, frame }, dock: 'problems' });
  if (frame) openClass(frame.className, frame.line);
}

function literal(arg, param) {
  if (arg.kind === 'ref') return arg.name;
  const v = String(arg.text ?? '').trim();
  if (param && param.category === 'string' && !/^".*"$/.test(v) && v !== 'null') return JSON.stringify(arg.text ?? '');
  if (param && param.category === 'char' && v.length === 1) return `'${v}'`;
  if (param && param.category === 'array' && !/^\{.*\}$/.test(v)) {
    const items = param.type === 'String[]' ? (v.match(/"(?:[^"\\]|\\.)*"|[^,]+/g) || []).map((x) => x.trim()).filter(Boolean).map((x) => (/^".*"$/.test(x) ? x : JSON.stringify(x))).join(', ') : v;
    return `new ${param.type}{${items}}`;
  }
  if (param && param.category === 'array') return `new ${param.type}${v}`;
  if (param && param.category === 'enum' && /^[A-Za-z_]\w*$/.test(v)) return `${simpleName(param.type)}.${v}`;
  return v.replace(/^(-?\d+),(\d+)$/, '$1.$2');
}

export function statementFor({ kind, cls, target, method, args, name }) {
  const list = (method.params || []).map((p, i) => literal(args[i] || { kind: 'text', text: '' }, p)).join(', ');
  const simple = simpleName(cls);
  if (kind === 'new') return `${simple} ${name || '…'} = new ${simple}(${list});`;
  const call = `${method.static ? simple : target}.${method.name}(${list})`;
  const variable = getState().settings.lang === 'en' ? 'result' : 'ergebnis';
  // A type variable (E, T, K …) is declared as Object in the shown statement.
  const ret = /^[A-Z]$/.test(method.returnType || '') ? 'Object' : method.returnType;
  if (ret && ret !== 'void') return `${ret} ${variable} = ${call};`;
  return call + ';';
}

/** keepSide: the tutor created the object, so the side panel stays on the tutor. */
export async function createObject(cls, ctor, args, name, { keepSide = false } = {}) {
  await breakpointsReady();
  const r = await api.bench.create({ className: cls, key: ctor.key, args, name: name || null });
  if (!r.ok) {
    if (r.error.kind === 'exception') {
      setException(r.error, `new ${simpleName(cls)}(…)`);
      return { done: true, exception: r.error };
    }
    if (r.error.code === 'stopped') return { done: true, stopped: true };
    return { error: errorText(r.error) };
  }
  const stmt = statementFor({ kind: 'new', cls, method: ctor, args, name: r.result.name });
  if (getState().settings.clearConsoleOnCall) clearConsole();
  logCall(stmt);
  record(stmt);
  fixtureLog.push(stmt);
  setState((s) => ({ bench: { ...s.bench, objects: r.result.bench, lastNew: r.result.name }, dock: s.dock === 'pad' ? 'pad' : 'objects', exception: null, inspect: { ref: r.result.name, trail: [r.result.name] }, side: s.side === 'tutor' && !s.tutorPinned && !keepSide ? 'inspect' : s.side }));
  return { done: true, name: r.result.name };
}

/** quiet: no result dialog (the tutor called it and reports the value itself). */
export async function callMethod({ target, cls, method, args, quiet = false }) {
  await breakpointsReady();
  const r = await api.bench.call({ target: method.static ? null : target, className: cls, key: method.key, args });
  if (!r.ok) {
    if (r.error.kind === 'exception') {
      setException(r.error, `${method.static ? simpleName(cls) : target}.${method.name}(…)`);
      return { done: true, exception: r.error };
    }
    if (r.error.code === 'stopped') return { done: true, stopped: true };
    return { error: errorText(r.error) };
  }
  const res = r.result;
  const callText = `${method.static ? simpleName(cls) : target}.${method.name}(${(method.params || []).map((p, i) => literal(args[i], p)).join(', ')})`;
  const shown = res.void ? '' : res.value.kind === 'string' ? JSON.stringify(res.value.text) : res.value.text ?? res.value.type;
  if (getState().settings.clearConsoleOnCall) clearConsole();
  logCall(res.void ? callText : `${callText}  →  ${shown}`);
  if (res.void) record(callText + ';');
  fixtureLog.push(callText + ';');
  setState((s) => ({ bench: { ...s.bench, objects: res.bench }, exception: null, inspectTick: Date.now() }));
  if (!res.void && !quiet) setState({ dialog: { type: 'result', label: callText, result: res } });
  return { done: true, result: res };
}

/**
 * Runs a class's main method. For the tutor: `input` lines are typed into the console each time the
 * program waits (a wait with no line left stops it), and `timeoutMs` stops a program that runs on.
 */
export async function runMain(cls, { input = null, timeoutMs = 0, args = [] } = {}) {
  if (!(await ensureCompiled())) return { compileFailed: true };
  setState({ dock: 'console', menu: null, palette: null });
  if (getState().settings.clearConsoleOnCall) clearConsole();
  logCall(`${simpleName(cls)}.main(${args.length ? `new String[]{${args.map((a) => JSON.stringify(a)).join(', ')}}` : 'new String[0]'})`);
  await breakpointsReady();
  const out = { finished: false, timedOut: false, waitingForInput: false };
  const lines = input ? [...input] : null;
  let unsubscribe = null;
  let timer = null;
  if (lines) {
    let was = getState().bench.state;
    unsubscribe = subscribe(() => {
      const now = getState().bench.state;
      const before = was;
      was = now;
      if (now !== 'waiting' || before === 'waiting') return;
      if (lines.length) sendInput(lines.shift());
      else {
        out.waitingForInput = true;
        stopProgram();
      }
    });
  }
  if (timeoutMs) timer = setTimeout(() => { out.timedOut = true; stopProgram(); }, timeoutMs);
  const r = await api.bench.main({ className: cls, args });
  clearTimeout(timer);
  if (unsubscribe) unsubscribe();
  if (!r.ok) {
    if (r.error.kind === 'exception') {
      setException(r.error, `${simpleName(cls)}.main`);
      out.exception = r.error;
    } else if (r.error.code !== 'stopped') {
      toast(errorText(r.error), 'bad');
      out.error = errorText(r.error);
    }
    return out;
  }
  setState((st) => ({ bench: { ...st.bench, objects: r.result.bench } }));
  out.finished = true;
  return out;
}

function waitFor(cond, ms) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => (cond() || Date.now() - start > ms ? resolve() : setTimeout(tick, 50));
    tick();
  });
}

export async function sendInput(text) {
  setState((s) => ({ console: [...s.console, { stream: 'in', text: text + '\n', id: uid() }], bench: { ...s.bench, state: s.bench.state === 'waiting' ? 'running' : s.bench.state } }));
  await api.bench.stdin({ text: text + '\n' });
}

export async function stopProgram() {
  if (getState().debug.attached && api.debug) api.debug.detach();
  await api.bench.reset();
  note(t('console.stopped') + ' ' + t('console.reset'));
  setState((s) => ({ bench: { ...s.bench, objects: [] }, inspect: null, debug: { ...s.debug, paused: null } }));
}

export async function inspect(ref) {
  const r = await api.bench.inspect({ ref });
  if (!r.ok) return { error: errorText(r.error) };
  return r.result;
}

export async function inspectClass(cls) {
  const r = await api.bench.inspectClass({ className: cls });
  if (!r.ok) return { error: errorText(r.error) };
  return r.result;
}

export function showInspector(ref, label, isClass = false) {
  setState({ inspect: { ref, trail: [label || ref], isClass }, side: 'inspect', tutorOpen: true });
}

export async function storeOnBench(ref, name) {
  const r = await api.bench.store({ ref, name: name || null });
  if (!r.ok) return errorText(r.error);
  setState((s) => ({ bench: { ...s.bench, objects: r.result.bench, lastNew: r.result.name }, dialog: null, dock: s.dock === 'pad' ? 'pad' : 'objects' }));
  return null;
}

export async function removeObject(name) {
  const r = await api.bench.remove({ name });
  if (r.ok) setState((s) => ({ bench: { ...s.bench, objects: r.result }, menu: null, inspect: s.inspect && s.inspect.ref === name ? null : s.inspect }));
}

// ------------------------------------------------------------------ code pad

export async function padRun(code) {
  const text = code.trim();
  if (!text || getState().pad.busy) return;
  if (!(await ensureCompiled())) return;
  const id = uid();
  setState((s) => ({ pad: { ...s.pad, busy: true, entries: [...s.pad.entries, { id, code: text, status: 'running' }] } }));
  await breakpointsReady();
  const r = await api.bench.pad({ code: text });
  const patch = (e) => setState((s) => ({ pad: { ...s.pad, busy: false, vars: r.ok && r.result.vars ? r.result.vars : s.pad.vars, entries: s.pad.entries.map((x) => (x.id === id ? { ...x, ...e } : x)) } }));
  if (!r.ok) {
    if (r.error.kind === 'exception') patch({ status: 'exception', exception: r.error });
    else patch({ status: 'failed', error: errorText(r.error) });
    return;
  }
  const res = r.result;
  if (res.bench) setState((s) => ({ bench: { ...s.bench, objects: res.bench }, inspectTick: Date.now() }));
  if (res.kind === 'error') patch({ status: 'error', diagnostics: res.diagnostics });
  else if (res.kind === 'value') patch({ status: 'value', type: res.type, value: res.value });
  else patch({ status: 'done' });
}

export async function padReset() {
  await api.bench.padReset();
  setState((s) => ({ pad: { entries: [], vars: [], busy: false } }));
}

// ------------------------------------------------------------------ tests (JUnit) and recording

export async function runTests(select = { all: true }) {
  if (!api.tests) return;
  if (!(await ensureCompiled())) return;
  setState((s) => ({ tests: { ...s.tests, running: true, select }, dock: 'tests', menu: null }));
  const r = await api.tests.run({ select });
  if (!r.ok) {
    setState((s) => ({ tests: { ...s.tests, running: false } }));
    toast(errorText(r.error), 'bad');
    return;
  }
  setState({ tests: { running: false, summary: r.result.summary, results: r.result.tests, output: r.result.output, ranAt: Date.now(), select } });
  // An exercise counts as solved once all tests of its test class pass in one run.
  const s = getState();
  const sum = r.result.summary;
  if (s.project && s.project.exercise && !select.method && sum.total > 0 && sum.passed === sum.total) {
    const done = s.settings.exercisesDone || [];
    if (!done.includes(s.project.exercise)) await updateSettings({ exercisesDone: [...done, s.project.exercise] });
    toast(t('exercise.solved'));
  }
}

export function startRecording(testClass, method) {
  setState({ recording: { testClass, method, lines: [] }, dialog: null, dock: 'objects' });
  note(t('record.started', { method, cls: simpleName(testClass) }));
}

function record(stmt) {
  const rec = getState().recording;
  if (rec) setState({ recording: { ...rec, lines: [...rec.lines, stmt] } });
}

export function recordAssertion(callText, expected) {
  const rec = getState().recording;
  if (!rec) return;
  setState({ recording: { ...rec, lines: [...rec.lines, `assertEquals(${expected}, ${callText});`] } });
}

export async function stopRecording(save = true) {
  const rec = getState().recording;
  setState({ recording: null });
  if (!rec || !save || !rec.lines.length) return;
  const file = fileOfClass(rec.testClass);
  const f = getState().files[file];
  if (!f) return;
  const body = rec.lines.map((l) => '        ' + l).join('\n');
  const method = `\n    @Test\n    public void ${rec.method}() {\n${body}\n    }\n`;
  const idx = f.content.lastIndexOf('}');
  let content = f.content.slice(0, idx).replace(/\s*$/, '\n') + method + '}\n';
  if (!/import\s+static\s+org\.junit\.jupiter\.api\.Assertions\.\*|import\s+static\s+org\.junit\.Assert\.\*/.test(content) && rec.lines.some((l) => l.startsWith('assert'))) {
    content = (/org\.junit\.Test\b/.test(content) ? 'import static org.junit.Assert.*;\n' : 'import static org.junit.jupiter.api.Assertions.*;\n') + content;
  }
  if (!/import\s+org\.junit(\.jupiter\.api)?\.Test\s*;/.test(content) && !/import\s+org\.junit\.jupiter\.api\.\*/.test(content)) content = 'import org.junit.jupiter.api.Test;\n' + content;
  editFile(file, content);
  await saveFile(file);
  openFile(file);
  note(t('record.saved', { method: rec.method }));
}

// ------------------------------------------------------------------ inheritance arrows (BlueJ: draw an "inherits" arrow)

/** Splits a type list at top-level commas: "A, Comparable<B, C>" -> ["A", "Comparable<B, C>"]. */
function typeList(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if (c === '<') depth++;
    if (c === '>') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Rewrites the extends / implements clauses of `simple` in `content`; fn gets and returns { ext, impl }. */
function rewriteHeader(content, simple, fn) {
  const m = new RegExp(`\\b(class|interface|enum|record)\\s+${simple}\\b`).exec(content);
  if (!m) return null;
  let i = m.index + m[0].length;
  const skip = (o, c) => {
    let j = i;
    while (/\s/.test(content[j] || '')) j++;
    if (content[j] !== o) return;
    for (let d = 0; j < content.length; j++) {
      if (content[j] === o) d++;
      else if (content[j] === c && --d === 0) { i = j + 1; return; }
    }
  };
  skip('<', '>');
  if (m[1] === 'record') skip('(', ')');
  const open = content.indexOf('{', i);
  if (open < 0) return null;
  const clause = content.slice(i, open);
  const ext = /\bextends\s+([\s\S]*?)(?=\bimplements\b|$)/.exec(clause);
  const impl = /\bimplements\s+([\s\S]*)$/.exec(clause);
  const next = fn({ ext: ext ? typeList(ext[1]) : [], impl: impl ? typeList(impl[1]) : [] });
  // Keeps the brace where the student put it (same line or the next).
  const tail = /\n\s*$/.test(clause) ? /\s*$/.exec(clause)[0] : ' ';
  const text = (next.ext.length ? ' extends ' + next.ext.join(', ') : '') + (next.impl.length ? ' implements ' + next.impl.join(', ') : '') + tail;
  return content.slice(0, i) + text + content.slice(open);
}

const bare = (type) => simpleName(type.replace(/<[\s\S]*$/, '').trim());

/** BlueJ's inheritance arrow: `from` extends (or implements) `to`, written into from's source. */
export async function addRelation(from, to) {
  const s = getState();
  const model = modelOf(s.files);
  const a = model.byName[from];
  const b = model.byName[to];
  if (!a || !b || from === to || s.project.readOnly) return;
  // No cycles: `to` must not already inherit from `from`.
  const seen = new Set();
  for (const queue = [to]; queue.length;) {
    const c = queue.shift();
    if (c === from) {
      toast(t('relation.cycle', { a: a.simple, b: b.simple }), 'bad');
      return;
    }
    if (seen.has(c) || !model.byName[c]) continue;
    seen.add(c);
    queue.push(...(model.byName[c].parents || []));
  }
  const toInterface = b.kind === 'interface';
  if (!toInterface && (a.kind === 'interface' || a.kind === 'enum' || b.kind === 'enum')) {
    toast(t('relation.invalid', { a: a.simple, b: b.simple }), 'bad');
    return;
  }
  const file = fileOfClass(from);
  let content = rewriteHeader(s.files[file].content, a.simple, ({ ext, impl }) => {
    if (toInterface && a.kind !== 'interface') return { ext, impl: impl.some((x) => bare(x) === b.simple) ? impl : [...impl, b.simple] };
    if (toInterface) return { ext: ext.some((x) => bare(x) === b.simple) ? ext : [...ext, b.simple], impl };
    return { ext: [b.simple], impl };
  });
  if (!content) return;
  const pkgB = packageOfClass(to);
  if (pkgB && pkgB !== packageOfClass(from) && !new RegExp(`import\\s+${to.replace(/\./g, '\\.')}\\s*;`).test(content)) {
    const pkgLine = /^package\s+[^;]+;[ \t]*\n/m.exec(content);
    const at = pkgLine ? pkgLine.index + pkgLine[0].length : 0;
    content = content.slice(0, at) + `${pkgLine ? '\n' : ''}import ${to};\n` + content.slice(at);
  }
  editFile(file, content);
  await saveFile(file);
}

/** Removes `to` from the extends / implements clauses of `from`. */
export async function removeRelation(from, to) {
  const s = getState();
  const file = fileOfClass(from);
  const target = simpleName(to);
  const content = rewriteHeader(s.files[file].content, simpleName(from), ({ ext, impl }) => ({ ext: ext.filter((x) => bare(x) !== target), impl: impl.filter((x) => bare(x) !== target) }));
  if (!content) return;
  setState({ menu: null });
  editFile(file, content);
  await saveFile(file);
}

// ------------------------------------------------------------------ test fixture (BlueJ: object bench to test fixture and back)

// Every object creation and method call since the bench last started, so the bench can become a setUp().
let fixtureLog = [];

/** Index of the brace that closes the one before `from`, skipping strings, chars and comments. */
function closingBrace(text, from) {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    else if (c === '/' && text[i + 1] === '*') i = text.indexOf('*/', i + 2) < 0 ? text.length : text.indexOf('*/', i + 2) + 1;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** The setUp method (annotated @BeforeEach or @Before, else named setUp): its name and body range. */
function findSetUp(content) {
  const m = /@(?:BeforeEach|Before)\b[^;{]*?\bvoid\s+(\w+)\s*\(\s*\)[^{;]*\{/.exec(content) || /\bvoid\s+(setUp)\s*\(\s*\)[^{;]*\{/.exec(content);
  if (!m) return null;
  const open = m.index + m[0].length;
  const close = closingBrace(content, open);
  return close < 0 ? null : { name: m[1], open, close };
}

/** Writes the objects on the bench into the test class: a field for each object and a setUp() that builds them. */
export async function benchToFixture(testClass) {
  const s = getState();
  const file = fileOfClass(testClass);
  const f = file && s.files[file];
  if (!f || s.project.readOnly) return;
  const onBench = new Set(s.bench.objects.map((o) => o.name));
  const declare = (l) => /^([\w$.<>[\], ?]+?)\s+([\w$]+)\s*=\s*new\b/.exec(l);
  const everDeclared = new Set(fixtureLog.map(declare).filter(Boolean).map((m) => m[2]));
  // A removed object takes its calls with it; objects from elsewhere (code pad, Get) have no statement to write.
  const lines = fixtureLog.filter((l) => [...l.matchAll(/[\w$]+/g)].every((w) => !everDeclared.has(w[0]) || onBench.has(w[0])));
  const decls = lines.map(declare).filter(Boolean);
  if (!decls.length) {
    toast(t('fixture.nothing'), 'bad');
    return;
  }
  let content = f.content;
  const junit4 = /import\s+org\.junit\.Test\s*;/.test(content);
  const body = lines.map((l) => '        ' + l.replace(/^[\w$.<>[\], ?]+?\s+([\w$]+)\s*=\s*new\b/, '$1 = new')).join('\n');
  const fields = decls.filter((m) => !new RegExp(`\\b${m[2]}\\s*[;=]`).test(content.slice(0, (findSetUp(content) || { open: content.length }).open))).map((m) => `    private ${m[1]} ${m[2]};\n`).join('');
  const setUp = findSetUp(content);
  if (setUp) content = content.slice(0, setUp.open) + '\n' + body + '\n    ' + content.slice(setUp.close);
  const classOpen = /\bclass\s+\w+[^{]*\{[ \t]*\n?/.exec(content);
  if (!classOpen) return;
  const at = classOpen.index + classOpen[0].length;
  const method = setUp ? '' : `\n    @${junit4 ? 'Before' : 'BeforeEach'}\n    public void setUp() {\n${body}\n    }\n`;
  content = content.slice(0, at) + fields + method + (fields || method ? '\n' : '') + content.slice(at).replace(/^\n+/, '');
  const imp = junit4 ? 'org.junit.Before' : 'org.junit.jupiter.api.BeforeEach';
  if (!setUp && !new RegExp(`import\\s+${imp.replace(/\./g, '\\.')}\\s*;|import\\s+${imp.replace(/\.\w+$/, '').replace(/\./g, '\\.')}\\.\\*\\s*;`).test(content)) {
    const lastImport = [...content.matchAll(/^import\s+[^;]+;[ \t]*$/gm)].pop();
    content = lastImport ? content.slice(0, lastImport.index + lastImport[0].length) + `\nimport ${imp};` + content.slice(lastImport.index + lastImport[0].length) : `import ${imp};\n` + content;
  }
  editFile(file, content);
  await saveFile(file);
  openFile(file);
  setState({ menu: null });
  toast(t(decls.length === 1 ? 'fixture.saved1' : 'fixture.saved', { n: decls.length, cls: simpleName(testClass) }));
}

/** Runs the test class's setUp() and puts the objects it builds on the bench. */
export async function fixtureToBench(testClass) {
  setState({ menu: null });
  if (!(await ensureCompiled())) return;
  const f = getState().files[fileOfClass(testClass)];
  const setUp = f && findSetUp(f.content);
  if (!setUp) {
    toast(t('fixture.noSetUp'), 'bad');
    return;
  }
  await breakpointsReady();
  const made = await api.bench.create({ className: testClass, key: '<init>()', args: [], name: null });
  if (!made.ok) {
    toast(errorText(made.error), 'bad');
    return;
  }
  const tmp = made.result.name;
  let count = 0;
  try {
    const call = await api.bench.call({ target: tmp, className: testClass, key: setUp.name + '()', args: [] });
    if (!call.ok) {
      if (call.error.kind === 'exception') setException(call.error, `${simpleName(testClass)}.${setUp.name}()`);
      else toast(errorText(call.error), 'bad');
      return;
    }
    const ins = await api.bench.inspect({ ref: tmp });
    for (const fl of (ins.ok && ins.result.fields) || []) {
      if (!fl.value || !fl.value.handle) continue;
      let r = await api.bench.store({ ref: fl.value.handle, name: fl.name });
      if (!r.ok && r.error.code === 'nameTaken') r = await api.bench.store({ ref: fl.value.handle, name: null });
      if (r.ok) count++;
    }
  } finally {
    const rm = await api.bench.remove({ name: tmp });
    if (rm.ok) setState((s) => ({ bench: { ...s.bench, objects: rm.result }, dock: 'objects' }));
  }
  toast(count ? t(count === 1 ? 'fixture.loaded1' : 'fixture.loaded', { n: count }) : t('fixture.empty'), count ? undefined : 'bad');
}

// ------------------------------------------------------------------ debugger

export function toggleBreakpoint(file, line) {
  setState((s) => {
    const list = new Set(s.breakpoints[file] || []);
    if (list.has(line)) list.delete(line);
    else list.add(line);
    return { breakpoints: { ...s.breakpoints, [file]: [...list].sort((a, b) => a - b) } };
  });
  syncBreakpoints();
}

// The debug helper attaches in the background; calls into the program wait for it, so a
// breakpoint set just before a method call is always in place when the method runs.
let bpSync = Promise.resolve();
export function syncBreakpoints() {
  if (!api.debug) return bpSync;
  const s = getState();
  const map = {};
  for (const [file, lines] of Object.entries(s.breakpoints || {})) {
    const f = s.files[file];
    if (f && lines.length) map[f.className] = lines;
  }
  bpSync = api.debug.setBreakpoints({ breakpoints: map }).catch(() => null);
  return bpSync;
}
const breakpointsReady = () => Promise.race([bpSync, new Promise((r) => setTimeout(r, 5000))]);

function onDebugEvent(ev) {
  if (ev.event === 'paused') {
    // The call that hit the breakpoint is still running: get its dialog out of the way of the code.
    setState((s) => ({ debug: { ...s.debug, attached: true, paused: { ...ev, frame: 0 } }, dock: 'debug', dialog: s.dialog && s.dialog.type === 'call' ? null : s.dialog }));
    const f = ev.frames && ev.frames[0];
    if (f) openClass(f.className, f.line);
  } else if (ev.event === 'resumed') setState((s) => ({ debug: { ...s.debug, paused: null } }));
  else if (ev.event === 'attached') setState((s) => ({ debug: { ...s.debug, attached: true } }));
  else if (ev.event === 'vmDeath' || ev.event === 'detached') setState((s) => ({ debug: { attached: false, paused: null } }));
}

export function debugCommand(cmd) {
  if (!api.debug) return;
  api.debug[cmd]();
}

export async function debugFrame(index) {
  const r = await api.debug.variables({ frame: index });
  if (r.ok) setState((s) => ({ debug: { ...s.debug, paused: { ...s.debug.paused, frame: index, variables: r.result.variables || [], statics: r.result.statics || [] } } }));
  const f = getState().debug.paused.frames[index];
  if (f) openClass(f.className, f.line);
}

export async function debugExpand(objectId) {
  const r = await api.debug.expand({ objectId });
  return r.ok ? r.result : [];
}

// ------------------------------------------------------------------ AI tutor

export function newChat() {
  const s = getState();
  const tour = s.tour;
  if (tour && tour.turnId && s.chat.turns.some((x) => x.id === tour.turnId)) endTour('closed');
  Agent.closeProposals();
  api.ai.newChat({ lang: s.settings.lang, mode: s.chat.mode });
  setState((st) => ({ chat: { ...st.chat, turns: [], busy: false, notes: [], hiddenChips: {} } }));
}

export function setTutorMode(mode) {
  setState((s) => ({ chat: { ...s.chat, mode } }));
  newChat();
}

const exceptionText = (e) => `${e.type}${e.message ? ': ' + e.message : ''}\n` + (e.frames || []).map((fr) => `  at ${fr.className}.${fr.method}(${fr.file || '?'}:${fr.line})`).join('\n');
const errorsOf = (s) => (s.compile.state === 'errors' ? s.compile.problems.filter((p) => p.severity === 'error') : []);

/**
 * What the composer offers to send along with the next message, as chips the student can remove.
 * Each chip has a `value` that says when a removed chip comes back (it changed).
 */
export function contextChips(s = getState()) {
  if (!s.project) return [];
  const chips = [];
  const f = s.activeTab && s.activeTab !== '#readme' && s.files[s.activeTab];
  if (f) chips.push({ key: 'file', value: f.name, label: t('chip.file', { file: simpleName(f.className) + '.java' }) });
  const sel = s.editorSelection;
  if (f && sel && sel.file === s.activeTab && sel.text.trim()) chips.push({ key: 'selection', value: `${sel.from}-${sel.to}`, label: t('chip.selection', { from: sel.from, to: sel.to }) });
  const errors = errorsOf(s);
  if (errors.length) chips.push({ key: 'problems', value: String(s.compile.at), label: errors.length === 1 ? t('chip.error1') : t('chip.errors', { n: errors.length }) });
  if (s.exception) chips.push({ key: 'exception', value: s.exception.label || s.exception.simpleType, label: t('chip.exception', { type: s.exception.simpleType }) });
  const ex = s.project.exercise && (s.info.exercises || []).find((e) => e.id === s.project.exercise);
  if (ex) chips.push({ key: 'exercise', value: ex.id, label: t('chip.exercise', { title: ex.title }) });
  return chips.map((c) => ({ ...c, hidden: s.chat.hiddenChips[c.key] === c.value }));
}

export function hideChip(key, value) {
  setState((s) => ({ chat: { ...s.chat, hiddenChips: { ...s.chat.hiddenChips, [key]: value } } }));
}

export function buildContext() {
  const s = getState();
  const shown = Object.fromEntries(contextChips(s).filter((c) => !c.hidden).map((c) => [c.key, true]));
  const ctx = {};
  if (s.settings.sendContext) {
    ctx.classes = Object.values(s.files).map((x) => x.className);
    const f = shown.file && s.files[s.activeTab];
    if (f) Object.assign(ctx, { file: f.name, content: f.content, cursor: s.cursor ? s.cursor.line : 1 });
    if (shown.selection) ctx.selection = s.editorSelection;
    if (shown.problems) ctx.problems = s.compile.problems;
    if (shown.exception) ctx.exception = exceptionText(s.exception);
  }
  // Notes, the exercise and a running tutorial name no code, so they always go along.
  if (s.chat.notes.length) ctx.notes = s.chat.notes;
  const ex = shown.exercise && (s.info.exercises || []).find((e) => e.id === s.project.exercise);
  if (ex) ctx.exercise = ex.title;
  if (s.tour && s.tour.mode === 'tour') ctx.tour = { title: s.tour.title || '', step: s.tour.index + 1, of: s.tour.steps.length };
  return Object.keys(ctx).length ? ctx : null;
}

/** What the main process needs to enforce the rules of the current mode. */
function agentInfo(s) {
  const model = s.project ? projectModel(s.files) : null;
  return {
    mode: s.chat.mode,
    exercise: !!(s.project && s.project.exercise),
    testFiles: model ? model.list.filter((c) => c.isTest).map((c) => c.file) : [],
    readCode: !!s.settings.sendContext,
    readOnly: !!(s.project && s.project.readOnly),
  };
}

/** AI features are on: a key is set and they are not switched off (e.g. for a class test). */
export const aiOn = (s) => !!s.info.tutor.hasKey && !s.settings.aiOff;

export async function askTutor(text) {
  const s = getState();
  if (!text.trim() || s.settings.aiOff) return;
  if (s.chat.busy) {
    // The tutor is still answering: the question waits in the composer instead of vanishing.
    setState({ tutorOpen: true, side: 'tutor', tutorDraft: { text, at: Date.now() } });
    return;
  }
  setState({ tutorOpen: true, side: 'tutor' });
  const turnId = 't' + Date.now();
  const context = buildContext();
  const ctxLabel = context && context.file ? simpleName(s.files[context.file].className) + '.java' : null;
  Agent.startTurn(s.project ? s.project.dir : null);
  setState((st) => ({
    chat: { ...st.chat, busy: true, notes: [], turns: [...st.chat.turns, { id: turnId + 'u', role: 'user', text, ctx: ctxLabel }, { id: turnId, role: 'assistant', parts: [], status: 'waiting' }] },
  }));
  await api.ai.send({ text, context, model: s.settings.model, lang: s.settings.lang, mode: s.chat.mode, turnId, agent: agentInfo(s) });
}

/** Resumes the last turn after it failed between tool rounds (files may already have changed). */
export async function continueLast() {
  const s = getState();
  const turn = s.chat.turns[s.chat.turns.length - 1];
  if (!turn || turn.role !== 'assistant' || s.chat.busy) return;
  Agent.startTurn(s.project ? s.project.dir : null);
  setState((st) => ({ chat: { ...st.chat, busy: true, turns: st.chat.turns.map((x) => (x.id === turn.id ? { ...x, status: 'working', error: null, partial: false } : x)) } }));
  // Step numbers go on after the turn's last one: `discard { step }` must never hit an earlier part.
  const stepBase = Math.max(0, turn.steps || 0, ...(turn.parts || []).map((p) => p.step || 0));
  await api.ai.continue({ turnId: turn.id, model: s.settings.model, agent: agentInfo(s), stepBase });
}

const sameTurn = (fn) => (s, ev) => ({ chat: { ...s.chat, turns: s.chat.turns.map((turn) => (turn.id === ev.turnId ? fn(turn, ev) : turn)) } });
const endParts = (parts) => parts.map((p) => (p.type === 'tool' && (p.status === 'streaming' || p.status === 'running') ? { ...p, status: 'cancelled' } : p));

/** One event of the agent loop applied to its turn. */
function applyAiEvent(turn, ev) {
  const parts = turn.parts || [];
  const last = parts[parts.length - 1];
  switch (ev.type) {
    case 'step':
      return ev.n > 1 ? { ...turn, status: 'working' } : turn;
    case 'thinking':
      return parts.length ? turn : { ...turn, status: 'thinking' };
    case 'writing':
      if (last && last.type === 'text' && last.step === ev.step) return { ...turn, status: 'working' };
      return { ...turn, status: 'working', parts: [...parts, { type: 'text', text: '', step: ev.step }] };
    case 'delta':
      if (last && last.type === 'text') return { ...turn, status: 'working', parts: [...parts.slice(0, -1), { ...last, text: last.text + ev.text }] };
      return { ...turn, status: 'working', parts: [...parts, { type: 'text', text: ev.text, step: ev.step }] };
    case 'toolStart':
      return { ...turn, status: 'working', parts: [...parts, { type: 'tool', callId: ev.callId, name: ev.name, input: null, status: 'streaming', step: ev.step }] };
    case 'discard':
      return { ...turn, parts: parts.filter((p) => p.step !== ev.step) };
    case 'done':
      return {
        ...turn, parts: endParts(parts), status: ev.stopReason === 'refusal' ? 'refusal' : 'done', usage: ev.usage, cost: ev.cost, model: ev.model,
        steps: ev.steps, limit: ev.limit, long: ev.long, full: ev.full,
      };
    case 'aborted':
      return { ...turn, parts: endParts(parts), status: 'aborted', partial: ev.partial };
    case 'error':
      return { ...turn, parts: endParts(parts), status: 'error', error: ev, partial: ev.partial };
    default:
      return turn;
  }
}

// Text deltas are applied once per frame, so a long answer does not re-render for every token.
let pendingDeltas = [];
let deltaFrame = 0;
function flushDeltas() {
  cancelAnimationFrame(deltaFrame);
  deltaFrame = 0;
  if (!pendingDeltas.length) return;
  const list = pendingDeltas;
  pendingDeltas = [];
  setState((s) => {
    let st = s;
    for (const ev of list) st = { ...st, ...sameTurn(applyAiEvent)(st, ev) };
    return { chat: st.chat };
  });
}

function onAiEvent(ev) {
  if (ev.type === 'delta') {
    pendingDeltas.push(ev);
    if (!deltaFrame) deltaFrame = requestAnimationFrame(flushDeltas);
    return;
  }
  flushDeltas();
  if (ev.type === 'toolCancel') {
    Agent.onToolCancel(ev);
    return;
  }
  setState((s) => {
    const next = sameTurn(applyAiEvent)(s, ev);
    const own = s.chat.turns.length && s.chat.turns[s.chat.turns.length - 1].id === ev.turnId;
    const busy = own && ['done', 'aborted', 'error'].includes(ev.type) ? false : s.chat.busy;
    return { chat: { ...next.chat, busy } };
  });
  if (['done', 'aborted', 'error'].includes(ev.type)) Agent.endTurn(ev);
}

export function stopTutor() {
  api.ai.stop();
}

/**
 * Enter while the tutor only waits for a decision on its change: the turn stops (the card keeps
 * its buttons) and the new message goes out once the stop has arrived.
 */
export async function sendAfterStop(text) {
  stopTutor();
  await waitFor(() => !getState().chat.busy, 5000);
  if (!getState().chat.busy) await askTutor(text);
}

export { acceptProposal, rejectProposal, undoChange, undoTurn } from './agent.js';

export async function retryLast() {
  const turns = getState().chat.turns;
  const lastUser = [...turns].reverse().find((x) => x.role === 'user');
  if (!lastUser) return;
  setState((s) => ({ chat: { ...s.chat, turns: s.chat.turns.slice(0, -2) } }));
  await askTutor(lastUser.text);
}

// ------------------------------------------------------------------ tutorials (the ring that shows where to click)

let pointTimer = null;

export function startTour({ title, steps, callId, turnId }) {
  if (getState().tour) endTour('replaced');
  setState({ tour: { id: uid(), mode: 'tour', title: title || '', steps, index: 0, callId, turnId, startedAt: Date.now(), stepAt: Date.now() } });
  enterStep();
}

/** One ring with a note and no steps. Resolves false when the target does not show up in 1.5 s. */
export async function pointAt({ target, text, callId, turnId }) {
  if (getState().tour) endTour('replaced');
  const id = uid();
  setState({ tour: { id, mode: 'point', title: '', steps: [{ target, text, action: 'next' }], index: 0, callId, turnId, startedAt: Date.now(), stepAt: Date.now() } });
  prepareTarget(target);
  const start = Date.now();
  while (!rectOf(target)) {
    if (Date.now() - start > 1500 || !getState().tour || getState().tour.id !== id) {
      if (getState().tour && getState().tour.id === id) endTour('closed');
      return false;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  clearTimeout(pointTimer);
  pointTimer = setTimeout(() => {
    if (getState().tour && getState().tour.id === id) endTour('done');
  }, 8000);
  return true;
}

function enterStep() {
  const tour = getState().tour;
  if (!tour) return;
  setState({ tour: { ...tour, stepAt: Date.now() } });
  prepareTarget(tour.steps[tour.index].target);
}

export function tourNext() {
  const tour = getState().tour;
  if (!tour) return;
  if (tour.index >= tour.steps.length - 1) {
    endTour('done');
    return;
  }
  setState({ tour: { ...tour, index: tour.index + 1 } });
  enterStep();
}

export function tourBack() {
  const tour = getState().tour;
  if (!tour || tour.index === 0) return;
  setState({ tour: { ...tour, index: tour.index - 1 } });
  enterStep();
}

/** reason: 'done' | 'closed' | 'escape' | 'replaced'. */
export function endTour(reason) {
  const tour = getState().tour;
  if (!tour) return;
  clearTimeout(pointTimer);
  const finished = reason === 'done';
  setState({ tour: null, lastTour: { title: tour.title, step: tour.index + 1, of: tour.steps.length, finished } });
  if (tour.callId && tour.mode === 'tour') {
    // Closed on its last step, the tutorial was seen through: that is not a failure.
    const seen = finished || tour.index === tour.steps.length - 1;
    Agent.setToolSummary(tour.turnId, tour.callId, seen ? t('agent.sum.tourDone') : t('agent.sum.tourStopped', { i: tour.index + 1, n: tour.steps.length }));
  }
}

export async function setApiKey(key, remember) {
  const r = await api.ai.setKey({ key, remember });
  if (!r.ok) return errorText(r.error);
  setState((s) => ({ info: { ...s.info, tutor: { ...s.info.tutor, ...r.result } } }));
  await updateSettings({ rememberKey: remember });
  return null;
}

export async function forgetApiKey() {
  const st = await api.ai.forgetKey();
  setState((s) => ({ info: { ...s.info, tutor: { ...s.info.tutor, ...st } } }));
}

// ------------------------------------------------------------------ AI editing (Ctrl+I, fix)

/** Asks Claude for a change and shows it as a diff; nothing changes until it is accepted. */
export async function aiEdit({ instruction, scope, selection }) {
  const s = getState();
  const name = s.activeTab;
  const f = s.files[name];
  if (!f || s.settings.aiOff) return;
  if (!s.info.tutor.hasKey) {
    setState({ tutorOpen: true, side: 'tutor' });
    toast(t('tutor.err.noKey'), 'bad');
    return;
  }
  setState({ aiBusy: { instruction } });
  const r = await api.ai.edit({ instruction, file: f.name, content: f.content, selection, model: s.settings.model, lang: s.settings.lang, scope });
  setState({ aiBusy: null });
  if (!r.ok) {
    if (r.error.code !== 'aborted') toast(t('tutor.err.' + (r.error.code || 'unknown'), { message: r.error.message || '' }), 'bad');
    return;
  }
  const lines = f.content.split('\n');
  let modified;
  if (scope === 'file') modified = r.result.code;
  else if (selection && selection.text) modified = [...lines.slice(0, selection.from - 1), r.result.code, ...lines.slice(selection.to)].join('\n');
  else {
    const at = selection ? selection.from - 1 : lines.length;
    modified = [...lines.slice(0, at), r.result.code, ...lines.slice(at)].join('\n');
  }
  if (f.content.endsWith('\n') && !modified.endsWith('\n')) modified += '\n';
  setState({ dialog: { type: 'diff', file: name, original: f.content, modified, explanation: r.result.explanation, instruction } });
}

/** Stops a running Ctrl+I request; the editor stays as it was. */
export function stopEdit() {
  if (api.ai.editStop) api.ai.editStop();
  setState({ aiBusy: null });
}

export function aiFix(problem) {
  openFile(problem.file, problem.line);
  const msg = `${problem.message}${problem.details && problem.details.length ? ' (' + problem.details.join('; ') + ')' : ''}`;
  setTimeout(() => aiEdit({ scope: 'file', instruction: t('ai.fixPrompt', { line: problem.line, message: msg }) }), 30);
}

export function applyDiff(file, content) {
  editFile(file, content);
  saveFile(file);
  setState({ dialog: null });
}

// ------------------------------------------------------------------ menus, dialogs, palette

export function openMenu(menu) {
  setState({ menu });
}

export function closeMenu() {
  setState({ menu: null });
}

export function openDialogBox(dialog) {
  setState({ dialog, menu: null, palette: null });
}

export function closeDialog() {
  setState({ dialog: null });
}

export function openPalette(mode = 'all') {
  setState({ palette: { mode, at: Date.now() }, menu: null });
}

export function closePalette() {
  setState({ palette: null });
}

export function modelOf(files) {
  return projectModel(files);
}

/** Puts code from the tutor into the open editor at the cursor (EditorPanel carries it out). */
export function insertCode(code) {
  setState({ insertRequest: { code, id: Date.now() }, view: 'project' });
}

export function toggleTutor() {
  setState((s) => ({ tutorOpen: !s.tutorOpen }));
}

export function setSide(side) {
  setState({ side, tutorOpen: true });
}

// ------------------------------------------------------------------ workspace layout and pop-outs
// The arrangement of the panels is remembered per project (in this PC's browser storage).

const layoutKey = (dir) => 'blackj.layout:' + String(dir).toLowerCase();

function storedLayout(dir) {
  try {
    const tree = JSON.parse(localStorage.getItem(layoutKey(dir)) || 'null');
    if (tree && Layout.isValid(tree)) return tree;
  } catch { /* nothing stored, or storage blocked */ }
  return Layout.defaultLayout();
}

function setLayoutTree(tree) {
  setState((s) => ({ layout: { ...s.layout, tree } }));
  const s = getState();
  if (!s.project) return;
  try {
    localStorage.setItem(layoutKey(s.project.dir), JSON.stringify(tree));
  } catch { /* private mode */ }
}

export function setSplitSizes(id, sizes) {
  setLayoutTree(Layout.setSizes(getState().layout.tree, id, sizes));
}

export function resetSplit(id) {
  setLayoutTree(Layout.resetSizes(getState().layout.tree, id));
}

/** A panel dragged by its head onto a side of another panel (or of the whole workspace). */
export function movePanelTo(panel, target, zone) {
  if (!Layout.PANELS.includes(panel) || panel === target) return;
  if (panel === 'side' || target === 'side') setState({ tutorOpen: true });
  setLayoutTree(Layout.movePanel(getState().layout.tree, panel, target, zone));
}

export function resetLayout() {
  for (const p of getState().layout.detached) dockBack(p);
  setLayoutTree(Layout.defaultLayout());
}

/** Moves a panel into a window of its own; `at` is the screen point where it was dropped. */
export function popOut(panel, at) {
  const s = getState();
  if (!Layout.POPPABLE.includes(panel) || !s.project || !api.panel) return;
  setState((st) => ({ layout: { ...st.layout, detached: [...new Set([...st.layout.detached, panel])] }, ...(panel === 'side' ? { tutorOpen: true } : {}), ...(panel === 'dock' ? { dockCollapsed: false } : {}) }));
  api.panel.open({ panel, x: at ? at.x : undefined, y: at ? at.y : undefined, title: `${panelTitle(panel)} – ${s.project.name}` });
}

/** Closes a pop-out window; its panel goes back to its place in the main window. */
export function dockBack(panel) {
  if (api.panel) api.panel.close({ panel });
  panelClosed(panel);
}

export function panelClosed(panel) {
  setState((s) => ({ layout: { ...s.layout, detached: s.layout.detached.filter((p) => p !== panel) }, activeWin: s.activeWin === panel ? 'main' : s.activeWin }));
}

export function panelTitle(panel) {
  return panel === 'diagram' ? t('diagram.title') : t('panel.' + panel);
}

export { simpleName, packageOfClass, fileOfClass };
