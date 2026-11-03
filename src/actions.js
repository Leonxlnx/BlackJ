// Everything the interface can do, in one place. Components call these; these update the store.
import { getState, setState, toast } from './store.js';
import { api } from './api.js';
import { translate } from './i18n.js';
import { projectModel, layoutAll, autoLayout, fileOfClass, simpleName, packageOfClass } from './model.js';
import { template } from './lib/templates.js';

const t = (k, p) => translate(getState().settings.lang, k, p);
let nextId = 1;
const uid = () => nextId++;

// ------------------------------------------------------------------ start

export async function init() {
  const info = await api.init();
  setState({ info, settings: info.settings, chat: { turns: [], busy: false, mode: info.settings.tutorMode }, ready: true });
  applyLook(info.settings);
  api.bench.onOut(onBenchOut);
  api.bench.onState(onBenchState);
  api.ai.onEvent(onAiEvent);
  if (api.debug) api.debug.onEvent(onDebugEvent);
  if (api.onProjectChanged) api.onProjectChanged(onProjectChanged);
  if (info.smoke) import('./smoke.js').then((m) => m.runSmoke());
}

function applyLook(s) {
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.lang = s.lang;
  if (api.windowTheme) api.windowTheme(s.theme);
}

export async function updateSettings(patch) {
  const settings = await api.setSettings(patch);
  setState({ settings });
  applyLook(settings);
  if ('tutorMode' in patch && !getState().chat.turns.length) setState((s) => ({ chat: { ...s.chat, mode: patch.tutorMode } }));
  return settings;
}

export function go(view) {
  setState({ view, menu: null, palette: null });
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
  const positions = layoutAll(model, p.positions || {});
  const firstTab = p.files.find((f) => f.content.includes('static void main')) || p.files[0];
  setState({
    project: { dir: p.dir, name: p.name, readOnly: p.readOnly, fromBlueJ: p.fromBlueJ, libs: p.libs || [], exercise: p.exercise || null },
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
    tabs: firstTab ? [firstTab.name] : [],
    activeTab: firstTab ? firstTab.name : null,
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
  api.bench.reset();
  setState({ project: null, files: {}, view: 'home', tabs: [], activeTab: null, bench: { state: 'off', objects: [], java: null } });
}

export function enterPackage(pkg) {
  const s = getState();
  const model = projectModel(s.files);
  setState({ pkg, selectedClass: null, positions: autoLayout(model, s.positions, pkg) });
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
  const f = r.result;
  setState((st) => ({ files: { ...st.files, [f.name]: { ...f, pkg: f.pkg || '', saved: f.content } }, dialog: null }));
  const model = projectModel(getState().files);
  setState((st) => ({ positions: autoLayout(model, st.positions, pkg) }));
  persistPositions();
  openFile(f.name);
  return null;
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
    return;
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
    setState((st) => ({ compile: { ...st.compile, state: 'failed' } }));
    toast(errorText(r.error), 'bad');
    return;
  }
  const res = r.result;
  const snapshot = Object.fromEntries(Object.values(getState().files).map((f) => [f.name, f.saved]));
  setState((st) => ({
    compile: { state: res.ok ? 'ok' : 'errors', problems: res.problems, snapshot, ms: res.ms, at: Date.now() },
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

async function ensureCompiled() {
  if (getState().compile.state !== 'ok' || anyStale()) {
    await compile();
    if (getState().compile.state !== 'ok') return false;
  }
  await waitFor(() => getState().bench.state !== 'off', 8000);
  return getState().bench.state !== 'off';
}

// ------------------------------------------------------------------ object bench

function onBenchState(ev) {
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
  if (param && param.category === 'array' && !/^\{.*\}$/.test(v)) return `new ${param.type}{${v}}`;
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

export async function createObject(cls, ctor, args, name) {
  await breakpointsReady();
  const r = await api.bench.create({ className: cls, key: ctor.key, args, name: name || null });
  if (!r.ok) {
    if (r.error.kind === 'exception') {
      setException(r.error, `new ${simpleName(cls)}(…)`);
      return { done: true };
    }
    return { error: errorText(r.error) };
  }
  const stmt = statementFor({ kind: 'new', cls, method: ctor, args, name: r.result.name });
  if (getState().settings.clearConsoleOnCall) clearConsole();
  logCall(stmt);
  record(stmt);
  setState((s) => ({ bench: { ...s.bench, objects: r.result.bench, lastNew: r.result.name }, dock: s.dock === 'pad' ? 'pad' : 'objects', exception: null, inspect: { ref: r.result.name, trail: [r.result.name] }, side: s.side === 'tutor' && !s.tutorPinned ? 'inspect' : s.side }));
  return { done: true, name: r.result.name };
}

export async function callMethod({ target, cls, method, args }) {
  await breakpointsReady();
  const r = await api.bench.call({ target: method.static ? null : target, className: cls, key: method.key, args });
  if (!r.ok) {
    if (r.error.kind === 'exception') {
      setException(r.error, `${method.static ? simpleName(cls) : target}.${method.name}(…)`);
      return { done: true };
    }
    if (r.error.code === 'stopped') return { done: true };
    return { error: errorText(r.error) };
  }
  const res = r.result;
  const callText = `${method.static ? simpleName(cls) : target}.${method.name}(${(method.params || []).map((p, i) => literal(args[i], p)).join(', ')})`;
  const shown = res.void ? '' : res.value.kind === 'string' ? JSON.stringify(res.value.text) : res.value.text ?? res.value.type;
  if (getState().settings.clearConsoleOnCall) clearConsole();
  logCall(res.void ? callText : `${callText}  →  ${shown}`);
  if (res.void) record(callText + ';');
  setState((s) => ({ bench: { ...s.bench, objects: res.bench }, exception: null, inspectTick: Date.now() }));
  if (!res.void) setState({ dialog: { type: 'result', label: callText, result: res } });
  return { done: true };
}

export async function runMain(cls) {
  if (!(await ensureCompiled())) return;
  setState({ dock: 'console', menu: null, palette: null });
  if (getState().settings.clearConsoleOnCall) clearConsole();
  logCall(`${simpleName(cls)}.main(new String[0])`);
  await breakpointsReady();
  const r = await api.bench.main({ className: cls });
  if (!r.ok) {
    if (r.error.kind === 'exception') setException(r.error, `${simpleName(cls)}.main`);
    else if (r.error.code !== 'stopped') toast(errorText(r.error), 'bad');
    return;
  }
  setState((st) => ({ bench: { ...st.bench, objects: r.result.bench } }));
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
  api.ai.newChat({ lang: s.settings.lang, mode: s.chat.mode });
  setState((st) => ({ chat: { ...st.chat, turns: [], busy: false } }));
}

export function setTutorMode(mode) {
  setState((s) => ({ chat: { ...s.chat, mode } }));
  newChat();
}

export function buildContext() {
  const s = getState();
  if (!s.settings.sendContext) return null;
  const f = s.activeTab && s.files[s.activeTab];
  const ctx = { classes: Object.values(s.files).map((x) => x.className) };
  if (f) Object.assign(ctx, { file: f.name, content: f.content });
  if (s.editorSelection && s.editorSelection.file === s.activeTab && s.editorSelection.text.trim()) ctx.selection = s.editorSelection;
  if (s.compile.state === 'errors') ctx.problems = s.compile.problems;
  if (s.exception) {
    const e = s.exception;
    ctx.exception = `${e.type}${e.message ? ': ' + e.message : ''}\n` + (e.frames || []).map((fr) => `  at ${fr.className}.${fr.method}(${fr.file || '?'}:${fr.line})`).join('\n');
  }
  return ctx;
}

/** AI features are on: a key is set and they are not switched off (e.g. for a class test). */
export const aiOn = (s) => !!s.info.tutor.hasKey && !s.settings.aiOff;

export async function askTutor(text) {
  const s = getState();
  if (!text.trim() || s.chat.busy || s.settings.aiOff) return;
  setState({ tutorOpen: true, side: 'tutor' });
  const turnId = 't' + Date.now();
  const context = buildContext();
  const ctxLabel = context && context.file ? context.file : null;
  setState((st) => ({
    chat: { ...st.chat, busy: true, turns: [...st.chat.turns, { id: turnId + 'u', role: 'user', text, ctx: ctxLabel }, { id: turnId, role: 'assistant', text: '', status: 'waiting' }] },
  }));
  await api.ai.send({ text, context, model: s.settings.model, lang: s.settings.lang, mode: s.chat.mode, turnId });
}

function onAiEvent(ev) {
  setState((s) => {
    const turns = s.chat.turns.map((turn) => {
      if (turn.id !== ev.turnId) return turn;
      if (ev.type === 'thinking') return { ...turn, status: 'thinking' };
      if (ev.type === 'writing') return { ...turn, status: 'writing' };
      if (ev.type === 'delta') return { ...turn, status: 'writing', text: turn.text + ev.text };
      if (ev.type === 'done') return { ...turn, status: ev.stopReason === 'refusal' ? 'refusal' : 'done', usage: ev.usage, cost: ev.cost, model: ev.model };
      if (ev.type === 'aborted') return { ...turn, status: 'aborted' };
      if (ev.type === 'error') return { ...turn, status: 'error', error: ev };
      return turn;
    });
    const busy = !['done', 'aborted', 'error'].includes(ev.type) && s.chat.busy;
    return { chat: { ...s.chat, turns, busy } };
  });
}

export function stopTutor() {
  api.ai.stop();
}

export async function retryLast() {
  const turns = getState().chat.turns;
  const lastUser = [...turns].reverse().find((x) => x.role === 'user');
  if (!lastUser) return;
  setState((s) => ({ chat: { ...s.chat, turns: s.chat.turns.slice(0, -2) } }));
  await askTutor(lastUser.text);
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
    toast(t('tutor.err.' + (r.error.code || 'unknown'), { message: r.error.message || '' }), 'bad');
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

export { simpleName, packageOfClass, fileOfClass };
