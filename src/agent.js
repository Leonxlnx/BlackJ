// The tutor's hands in the window. The agent loop (electron/ai.cjs) asks for one tool call at a
// time; it is carried out here against the store, so the student sees every step happen. Changes to
// files become proposals the student applies or discards (cards in the chat, a bar in the editor).
import { getState, setState, subscribe, toast } from './store.js';
import { api } from './api.js';
import { translate } from './i18n.js';
import * as A from './actions.js';
import * as tour from './lib/tour.js';
import { projectModel, simpleName, fileOfClass, isAssignable } from './model.js';
import { explainProblem } from './lib/errors.js';
import { lineDiff } from './lib/diff.js';

const t = (k, p) => translate(getState().settings.lang, k, p);

let turnProjectDir = null;
const waits = new Map(); // callId -> resolve of a proposal waiting for the student
const programs = new Set(); // callIds that started Java code (run_main, create_object, call_method)

export function init() {
  if (api.ai.onTool) api.ai.onTool(onAiTool);
}

/** askTutor / continueLast: tools of this turn may only touch this project. */
export function startTurn(dir) {
  turnProjectDir = dir;
}

/** The turn ended: a proposal still waiting keeps its buttons; a later decision goes into a note. */
export function endTurn(ev) {
  if (ev.type === 'done') return;
  for (const p of Object.values(getState().agent.proposals)) {
    if (p.turnId !== ev.turnId || p.status !== 'pending') continue;
    openProposal(p.id);
    const wait = waits.get(p.callId);
    if (wait) {
      waits.delete(p.callId);
      wait({ content: 'Stopped by the student.', isError: true });
    }
  }
}

// ------------------------------------------------------------------ turn parts

function patchTurn(turnId, fn) {
  setState((s) => ({ chat: { ...s.chat, turns: s.chat.turns.map((x) => (x.id === turnId ? fn(x) : x)) } }));
}

function patchPart(turnId, callId, patch) {
  patchTurn(turnId, (turn) => {
    const parts = turn.parts || [];
    const i = parts.findIndex((p) => p.type === 'tool' && p.callId === callId);
    const next = typeof patch === 'function' ? patch(i >= 0 ? parts[i] : null) : patch;
    if (!next) return turn;
    if (i < 0) return { ...turn, parts: [...parts, { type: 'tool', callId, step: 0, ...next }] };
    const copy = parts.slice();
    copy[i] = { ...parts[i], ...next };
    return { ...turn, parts: copy };
  });
}

const partOf = (turnId, callId) => {
  const turn = getState().chat.turns.find((x) => x.id === turnId);
  return turn && (turn.parts || []).find((p) => p.type === 'tool' && p.callId === callId);
};

export function setToolSummary(turnId, callId, summary) {
  patchPart(turnId, callId, (p) => (p ? { summary } : null));
}

/** Calls the main process gave up on (stop, timeout) or never ran (invalid input, a rule). */
export function onToolCancel(ev) {
  for (const callId of ev.callIds || []) {
    if (ev.reason === 'invalid' || ev.reason === 'blocked') {
      // The model gets the reason; the student does not need a row for a call that never ran.
      patchTurn(ev.turnId, (turn) => ({ ...turn, parts: (turn.parts || []).filter((p) => !(p.type === 'tool' && p.callId === callId)) }));
    } else if (ev.reason === 'timeout') patchPart(ev.turnId, callId, { status: 'error', summary: t('agent.sum.timeout') });
    // A row that is gone (discarded with its step) does not come back as a nameless one.
    else patchPart(ev.turnId, callId, (p) => (!p || p.status === 'done' || p.status === 'error' ? null : { status: 'cancelled' }));
    const wait = waits.get(callId);
    if (wait) {
      waits.delete(callId);
      openProposal('p' + callId);
      wait({ content: 'Stopped by the student.', isError: true });
    }
    if (programs.has(callId)) {
      programs.delete(callId);
      const b = getState().bench.state;
      if (b === 'running' || b === 'waiting') A.stopProgram();
    }
  }
}

// ------------------------------------------------------------------ tool calls from the main process

async function onAiTool(call) {
  const reply = (content, isError) => api.ai.toolResult({ callId: call.callId, content: String(content ?? ''), isError: !!isError });
  const s = getState();
  const last = s.chat.turns[s.chat.turns.length - 1];
  if (!last || last.id !== call.turnId) return reply('This chat was closed.', true);
  if (s.settings.aiOff) return reply('AI is switched off.', true);
  if (!s.project && call.name !== 'get_project') return reply('No project is open.', true);
  if ((s.project ? s.project.dir : null) !== turnProjectDir) return reply('The student opened another project.', true);
  const impl = TOOL_IMPL[call.name];
  if (!impl) return reply('Unknown tool.', true);
  patchPart(call.turnId, call.callId, { name: call.name, input: call.input, status: 'running' });
  let r;
  try {
    r = await impl(call.input || {}, call);
  } catch (err) {
    r = { isError: true, content: String((err && err.message) || err) };
  }
  if (typeof r === 'string') r = { content: r };
  programs.delete(call.callId);
  reply(r.content, r.isError);
  // A call the main process already closed (stop, timeout) keeps the state it got then.
  patchPart(call.turnId, call.callId, (p) => (p && p.status !== 'running' ? null : {
    status: r.isError ? 'error' : 'done',
    summary: r.summary != null ? r.summary : r.isError ? String(r.content).split('\n')[0].slice(0, 60) : '',
  }));
}

const fail = (content, summary) => ({ isError: true, content, summary });
const json = (obj, summary) => ({ content: JSON.stringify(obj), summary });

/** A class by qualified name, or by simple name when that is unique. */
function classOf(model, name) {
  if (!name) return null;
  if (model.byName[name]) return model.byName[name];
  const hits = model.bySimple[name] || [];
  return hits.length === 1 ? model.byName[hits[0]] : null;
}

const listOf = (names, n = 30) => names.slice(0, n).join(', ') + (names.length > n ? ', …' : '');
const fileLabel = (path) => String(path || '').split('/').pop();
const isReadme = (path) => /^readme\.(txt|md)$/i.test(path || '');
const numbered = (lines, from) => lines.map((l, i) => `${String(i + from).padStart(3)}| ${l}`).join('\n');

function valueText(v) {
  if (!v) return '';
  if (v.kind === 'string') return JSON.stringify(v.text);
  if (v.kind === 'null') return 'null';
  if (v.kind === 'object' || v.kind === 'array') return v.text || (v.length != null ? `${v.type} (${v.length})` : v.type);
  return v.text;
}

const exceptionLine = (e) => {
  const fr = (e.frames || []).find((f) => f.project) || (e.frames || [])[0];
  return `${e.simpleType || e.type}${e.message ? ': ' + e.message : ''}${fr ? ` at ${simpleName(fr.className)}.${fr.method}(${fr.file || '?'}:${fr.line})` : ''}`;
};

/** Console lines after `mark` (an entry id), as one text. */
function consoleSince(mark, max) {
  const text = getState().console.filter((l) => l.id > mark).map((l) => (l.stream === 'call' ? '> ' + l.text + '\n' : l.stream === 'note' ? '' : l.text)).join('');
  return text.length > max ? '…' + text.slice(-max) : text;
}
const consoleMark = () => {
  const c = getState().console;
  return c.length ? c[c.length - 1].id : 0;
};

/** Resolves true once `cond` holds, false after `ms` or when `signal` aborts (the listener goes then). */
function untilState(cond, ms, signal) {
  return new Promise((resolve) => {
    if (cond(getState())) return resolve(true);
    let timer = null;
    const finish = (value) => {
      off();
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish(false);
    const off = subscribe(() => {
      if (cond(getState())) finish(true);
    });
    if (ms) timer = setTimeout(() => finish(false), ms);
    if (signal) {
      if (signal.aborted) return finish(false);
      signal.addEventListener('abort', onAbort);
    }
  });
}

/** Resolves with the pause info when the debugger stops at a breakpoint (never, once `signal` aborts). */
const untilPaused = (signal) => untilState((s) => !!(s.debug && s.debug.paused), 0, signal).then((paused) => {
  if (!paused) return new Promise(() => {});
  const f = (getState().debug.paused.frames || [])[0] || {};
  return { paused: { file: fileOfClass(f.className || ''), line: f.line, method: f.method }, note: 'Stopped at a breakpoint. The student is debugging; the Debugger tab is open.' };
});

function benchBusy() {
  const b = getState().bench.state;
  return b === 'running' || b === 'waiting' ? fail('A program is running. Ask the student to stop it first.') : null;
}

function problemList(s) {
  const lang = s.settings.lang;
  return s.compile.problems.filter((p) => p.severity === 'error').map((p) => ({ file: p.file, line: p.line, message: p.message, hint: explainProblem(p, lang).title }));
}

/** What the compiler said, as a tool result. */
function compileResult(benchCleared) {
  const s = getState();
  const c = s.compile;
  if (c.state === 'ok') return json({ ok: true, ms: c.ms, ...(benchCleared ? { benchCleared: true } : {}) }, t('agent.sum.compiled'));
  if (c.state === 'errors') {
    const errors = problemList(s);
    return json({ ok: false, errors: errors.slice(0, 15), ...(errors.length > 15 ? { more: errors.length - 15 } : {}) }, t('agent.sum.errors', { n: errors.length }));
  }
  return { ...json({ ok: false, failed: String(c.failed || 'The compiler could not run.').slice(0, 400) }), isError: true };
}

/** Picks the constructor or method whose parameters fit the given argument texts best. */
function pickOverload(list, args) {
  const s = getState();
  const model = projectModel(s.files);
  const fits = (param, arg) => {
    const v = String(arg).trim();
    const obj = s.bench.objects.find((o) => o.name === v);
    if (obj) return param.category === 'object' || isAssignable(model, obj.className, param.type);
    if (param.category === 'string') return /^".*"$/s.test(v) || v === 'null';
    if (/^(int|long|short|byte|double|float)$/.test(param.type)) return /^-?\d+([.,]\d+)?[dDfFlL]?$/.test(v);
    if (param.type === 'boolean') return v === 'true' || v === 'false';
    if (param.type === 'char') return /^'.'$/.test(v) || v.length === 1;
    return true;
  };
  return list.find((m) => m.params.every((p, i) => fits(p, args[i]))) || list[0];
}

const argsFor = (args) => {
  const names = new Set(getState().bench.objects.map((o) => o.name));
  return args.map((a) => (names.has(String(a).trim()) ? { kind: 'ref', name: String(a).trim() } : { kind: 'text', text: a }));
};

const sigOf = (name, m) => `${name}(${m.params.map((p) => `${p.type}${p.name && !/^arg\d+$/.test(p.name) ? ' ' + p.name : ''}`).join(', ')})`;

/** Runs Java code for a tool: ends early at a breakpoint, stops it after `ms`. */
async function runJava(callId, promise, ms) {
  programs.add(callId);
  let timer = null;
  const timeout = ms ? new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); }) : null;
  const ac = new AbortController();
  const r = await Promise.race([promise, untilPaused(ac.signal), ...(timeout ? [timeout] : [])]).finally(() => ac.abort());
  clearTimeout(timer);
  if (r && r.timedOut) await A.stopProgram();
  return r;
}

const pausedResult = (r) => json(r, t('agent.sum.paused'));

// ------------------------------------------------------------------ the project as the agent sees it

const compact = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) continue;
    out[k] = v;
  }
  return out;
};
const vis = (v) => (v && v !== 'package' ? v + ' ' : '');

/** get_project: what BlackJ shows right now, compact. */
export function projectSnapshot() {
  const s = getState();
  if (!s.project) return { project: null, view: s.view || 'home' };
  const model = projectModel(s.files);
  const code = !!s.settings.sendContext;
  const errors = s.compile.state === 'errors' ? s.compile.problems.filter((p) => p.severity === 'error') : [];
  const exInfo = s.project.exercise && (s.info.exercises || []).find((e) => e.id === s.project.exercise);
  const classes = model.list.slice(0, 40).map((c) => compact({
    name: c.fileClass,
    file: c.file,
    kind: (c.abstract && c.kind === 'class' ? 'abstract ' : '') + c.kind,
    extends: c.extends[0],
    implements: c.implements,
    fields: code ? c.fields.map((f) => `${vis(f.visibility)}${f.static ? 'static ' : ''}${f.type} ${f.name}`) : null,
    methods: code ? c.methods.map((m) => `${vis(m.visibility)}${m.static ? 'static ' : ''}${m.returnType} ${sigOf(m.name, m)}`) : null,
    constructors: code ? c.ctors.map((m) => sigOf(c.simple, m)) : null,
    main: c.hasMain,
    test: c.isTest,
    compiled: s.compile.state === 'ok' && !A.isStale(c.file),
    errors: errors.filter((p) => p.file === c.file).length,
    uses: model.edges.filter((e) => e.from === c.fileClass && e.kind === 'uses').map((e) => e.to),
  }));
  const proposal = Object.values(s.agent.proposals).find((p) => (p.status === 'pending' || p.status === 'open') && p.kind !== 'create');
  const lines = s.console.slice(-40).map((l) => (l.stream === 'call' ? '> ' + l.text + '\n' : l.text)).join('');
  const tr = s.tour || null;
  return compact({
    project: s.project.name,
    readOnly: !!s.project.readOnly,
    view: s.view,
    exercise: exInfo ? { id: exInfo.id, title: exInfo.title, task: s.readme ? String(s.readme.content).slice(0, 1500) : '', solved: (s.settings.exercisesDone || []).includes(exInfo.id) } : null,
    package: s.pkg,
    classes,
    moreClasses: model.list.length > 40 ? model.list.length - 40 : null,
    compile: compact({
      state: s.compile.state,
      changedSinceCompile: s.compile.state === 'ok' ? Object.keys(s.files).filter((n) => A.isStale(n)) : null,
      problems: problemList(s).slice(0, 15),
    }),
    bench: compact({
      state: s.bench.state,
      objects: s.bench.objects.slice(0, 20).map((o) => compact({ name: o.name, type: o.type, fields: Object.fromEntries((o.preview || []).map((p) => [p.name, p.text])) })),
      moreObjects: s.bench.objects.length > 20 ? s.bench.objects.length - 20 : null,
    }),
    editor: compact({
      open: s.activeTab === '#readme' ? (s.readme && s.readme.name) : s.activeTab,
      tabs: s.tabs.map((x) => (x === '#readme' ? s.readme && s.readme.name : x)).filter(Boolean),
      unsaved: Object.values(s.files).filter((f) => A.isDirty(f)).map((f) => f.name),
      cursor: s.cursor ? { line: s.cursor.line, column: s.cursor.col } : null,
      selection: s.editorSelection && s.editorSelection.file === s.activeTab ? { from: s.editorSelection.from, to: s.editorSelection.to } : null,
      pendingProposal: proposal ? proposal.file : null,
    }),
    console: lines.length > 2000 ? '…' + lines.slice(-2000) : lines,
    exception: s.exception ? exceptionLine(s.exception) : null,
    tests: s.tests.summary ? compact({
      total: s.tests.summary.total,
      passed: s.tests.summary.passed,
      failing: (s.tests.results || []).filter((r) => r.status === 'failed' || r.status === 'error').slice(0, 10).map((r) => compact({ class: r.className, method: r.name, message: r.message })),
    }) : null,
    debugger: s.debug && s.debug.paused ? { paused: (() => { const f = (s.debug.paused.frames || [])[0] || {}; return { file: fileOfClass(f.className || ''), line: f.line, method: f.method }; })() } : null,
    ui: compact({
      dock: s.dock,
      dockCollapsed: !!s.dockCollapsed,
      sidePanel: s.tutorOpen ? s.side : null,
      drawer: !!s.drawer,
      tutorial: tr ? { title: tr.title, step: tr.index + 1, of: tr.steps.length, finished: false } : s.lastTour,
    }),
  });
}

// ------------------------------------------------------------------ the tools

/** The text of a file as the editor has it (or the README). */
function fileText(path) {
  const s = getState();
  if (isReadme(path)) return s.readme && s.readme.name.toLowerCase() === path.toLowerCase() ? s.readme.content : null;
  const f = s.files[path];
  return f ? f.content : null;
}

const noFile = (path) => fail(`No file ${path}. Files: ${listOf(Object.keys(getState().files))}`);

// search_code runs in a worker that is ended after 300 ms: a model-written regex that backtracks
// for ever cannot freeze the window. The worker reports after every file, so hits so far count.
const SEARCH_WORKER = `onmessage = (e) => {
  const { files, query, regex } = e.data;
  const q = query.toLowerCase();
  const re = regex ? new RegExp(query, 'i') : null;
  const hits = [];
  let more = 0;
  for (const [name, text] of files) {
    const lines = text.split('\\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].slice(0, 500);
      if (!(re ? re.test(l) : l.toLowerCase().includes(q))) continue;
      if (hits.length < 50) hits.push(name + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 160));
      else more++;
    }
    postMessage({ hits, more, done: false });
  }
  postMessage({ hits, more, done: true });
};`;
let searchUrl = null;

function searchFiles(files, query, regex) {
  return new Promise((resolve) => {
    let last = { hits: [], more: 0 };
    let worker;
    try {
      searchUrl = searchUrl || URL.createObjectURL(new Blob([SEARCH_WORKER], { type: 'text/javascript' }));
      worker = new Worker(searchUrl);
    } catch {
      return resolve({ ...last, early: true });
    }
    const end = (early) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ hits: last.hits, more: last.more, early });
    };
    const timer = setTimeout(() => end(true), 300);
    worker.onmessage = (e) => {
      last = e.data;
      if (e.data.done) end(false);
    };
    worker.onerror = () => end(true);
    worker.postMessage({ files, query, regex });
  });
}

const TOOL_IMPL = {
  get_project: () => json(projectSnapshot()),

  read_file: ({ path, from_line, to_line }) => {
    const text = fileText(path);
    if (text == null) return noFile(path);
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const n = lines.length;
    const from = Math.min(n, Math.max(1, from_line || 1));
    const to = Math.min(n, to_line || from + 399, from + 399);
    const f = getState().files[path];
    let head = `${fileLabel(path)} · ${n} lines`;
    if (from > 1 || to < n) head += ` · lines ${from}-${to} of ${n}${to < n ? ', ask for more with from_line' : ''}`;
    if (f && A.isDirty(f)) head += ' · unsaved changes';
    return { content: head + '\n' + numbered(lines.slice(from - 1, to), from), summary: '' };
  },

  search_code: async ({ query, regex, path }) => {
    if (regex) {
      try {
        new RegExp(query, 'i');
      } catch (err) {
        return fail(`Invalid regular expression: ${err.message}`);
      }
    }
    const files = path ? [path] : Object.keys(getState().files).sort();
    if (path && fileText(path) == null) return noFile(path);
    const { hits, more, early } = await searchFiles(files.map((name) => [name, String(fileText(name))]), query, !!regex);
    const count = hits.length + more;
    if (!count) return { content: early ? 'No matches (search stopped early).' : 'No matches.', summary: t('agent.sum.lines', { n: 0 }) };
    return { content: hits.join('\n') + (more ? `\n(${more} more)` : '') + (early ? '\n(search stopped early)' : ''), summary: t('agent.sum.lines', { n: count }) };
  },

  inspect_object: async ({ name }) => {
    const objects = getState().bench.objects;
    if (!objects.some((o) => o.name === name)) return fail(objects.length ? `No object ${name}. On the bench: ${listOf(objects.map((o) => o.name))}` : 'The object bench is empty.');
    const d = await A.inspect(name);
    if (d.error) return fail(d.error);
    const fields = (d.fields || []).slice(0, 30).map((f) => ({ name: f.name, type: f.type, value: valueText(f.value) }));
    return json({ name, type: d.type, fields });
  },

  create_class: ({ name, content }, call) => {
    const s = getState();
    const file = fileOfClass(name);
    if (s.files[file]) return fail(`${simpleName(name)} already exists (${file}). Use edit_file to change it.`);
    const simple = simpleName(name);
    const pkg = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : '';
    if (!new RegExp(`\\b(class|interface|enum|record)\\s+${simple.replace(/\$/g, '\\$')}\\b`).test(content)) return fail(`The content must declare ${simple} (class, interface, enum or record ${simple}).`);
    const m = content.match(/^\s*package\s+([\w.]+)\s*;/m);
    if ((m ? m[1] : '') !== pkg) return fail(pkg ? `The content must start with "package ${pkg};".` : 'A class in the default package has no package line.');
    return propose({ kind: 'create', file, className: name, before: '', after: content }, call);
  },

  write_file: ({ path, content }, call) => {
    const before = fileText(path);
    if (before == null || isReadme(path)) return fail(`No file ${path}. Use create_class for a new class.`);
    if (before === content) return fail('The content is the same as the file.');
    return propose({ kind: 'write', file: path, before, after: content }, call);
  },

  edit_file: ({ path, old_text, new_text, replace_all }, call) => {
    const before = fileText(path);
    if (before == null || isReadme(path)) return noFile(path);
    const r = replaceIn(path, before, old_text, new_text, replace_all);
    if (r.error) return fail(r.error);
    return propose({ kind: 'edit', file: path, before, after: r.after, edit: { old_text, new_text, replace_all: !!replace_all } }, call);
  },

  delete_class: ({ name }, call) => {
    const s = getState();
    const model = projectModel(s.files);
    const c = classOf(model, name);
    if (!c) return fail(`No class ${name}. Classes: ${listOf(model.names)}`);
    const users = [...new Set(model.edges.filter((e) => e.to === c.fileClass && e.from !== c.fileClass).map((e) => simpleName(e.from)))];
    if (users.length) return fail(`${c.simple} is used by ${users.join(', ')}. Change those first.`);
    if (s.project.exercise && (s.project.startFiles || []).includes(c.file)) return fail('This class belongs to the exercise; it stays.');
    return propose({ kind: 'delete', file: c.file, className: c.fileClass, before: s.files[c.file].content, after: '' }, call);
  },

  compile: async () => {
    if (getState().compile.state === 'compiling') await untilState((s) => s.compile.state !== 'compiling', 15000);
    const hadObjects = getState().bench.objects.length > 0;
    await A.compile();
    await untilState((s) => s.compile.state !== 'compiling', 15000);
    return compileResult(hadObjects);
  },

  run_tests: async (input, call) => {
    const s = getState();
    const model = projectModel(s.files);
    const testClasses = model.list.filter((c) => c.isTest);
    if (!testClasses.length) return fail('This project has no test classes.');
    let select = { all: true };
    if (input.class) {
      const c = classOf(model, input.class);
      if (!c || !c.isTest) return fail(`No test class ${input.class}. Test classes: ${listOf(testClasses.map((x) => x.fileClass))}`);
      select = input.method ? { className: c.fileClass, method: input.method } : { className: c.fileClass };
    }
    const ranBefore = s.tests.ranAt;
    const r = await runJava(call.callId, A.runTests(select).then(() => ({ ran: true })), 0);
    if (r && r.paused) return pausedResult(r);
    const st = getState();
    if (st.compile.state !== 'ok') return { ...compileResult(false), isError: true };
    if (!st.tests.summary || st.tests.ranAt === ranBefore) return fail('The tests did not run.');
    const sum = st.tests.summary;
    const failing = (st.tests.results || []).filter((x) => x.status === 'failed' || x.status === 'error');
    return json({
      total: sum.total, passed: sum.passed, failed: sum.failed,
      failing: failing.slice(0, 10).map((x) => compact({ class: x.className, method: x.name, message: x.message, expected: x.expected, actual: x.actual })),
    }, t('agent.sum.tests', { passed: sum.passed, total: sum.total }));
  },

  run_main: async (input, call) => {
    const busy = benchBusy();
    if (busy) return busy;
    const model = projectModel(getState().files);
    const c = classOf(model, input.class);
    const mains = model.list.filter((x) => x.hasMain).map((x) => x.fileClass);
    if (!c) return fail(`No class ${input.class}. Classes with main: ${listOf(mains) || 'none'}`);
    if (!c.hasMain) return fail(`${c.simple} has no main method. Classes with main: ${listOf(mains) || 'none'}`);
    const mark = consoleMark();
    const secs = input.timeout_s || 10;
    const r = await runJava(call.callId, A.runMain(c.fileClass, { input: input.input || [], timeoutMs: secs * 1000 }), 0);
    if (r && r.paused) return pausedResult(r);
    if (r.compileFailed) return { ...compileResult(false), isError: true };
    const out = compact({
      finished: r.finished,
      timedOut: r.timedOut || null,
      waitingForInput: r.waitingForInput || null,
      output: consoleSince(mark, 4000),
      exception: r.exception ? exceptionLine(r.exception) : null,
      error: r.error,
    });
    out.finished = !!r.finished;
    const summary = r.timedOut ? t('agent.sum.timedOut', { s: secs }) : r.exception ? t('agent.sum.exception', { type: r.exception.simpleType }) : t('agent.sum.ran');
    return { ...json(out, summary), isError: !!r.error };
  },

  create_object: async (input, call) => {
    const busy = benchBusy();
    if (busy) return busy;
    const model = projectModel(getState().files);
    const c = classOf(model, input.class);
    if (!c) return fail(`No class ${input.class}. Classes: ${listOf(model.names)}`);
    if (!(await A.ensureCompiled())) return { ...compileResult(false), isError: true };
    const desc = await A.describe(c.fileClass);
    if (!desc) return fail(`Could not read the class ${c.simple}.`);
    if (desc.kind !== 'class' || c.abstract) return fail(`${c.simple} is ${desc.kind === 'interface' ? 'an interface' : 'abstract'}. Create an object of a class that implements or extends it.`);
    if (!desc.constructors.length) return fail(`${c.simple} has no constructor that can be called.`);
    const args = input.args || [];
    const fitting = desc.constructors.filter((k) => k.params.length === args.length);
    if (!fitting.length) return fail(`No constructor with ${args.length} parameters. Constructors: ${desc.constructors.map((k) => sigOf(c.simple, k)).join(', ')}`);
    const ctor = pickOverload(fitting, args);
    const r = await runJava(call.callId, A.createObject(c.fileClass, ctor, argsFor(args), input.name || null, { keepSide: true }), 30000);
    if (r.paused) return pausedResult(r);
    if (r.timedOut) return json({ timedOut: true, note: 'The constructor did not finish within 30 s; the program was stopped.' }, t('agent.sum.timedOut', { s: 30 }));
    if (r.error) return fail(r.error);
    if (r.exception) return json({ exception: exceptionLine(r.exception) }, t('agent.sum.exception', { type: r.exception.simpleType }));
    if (r.stopped) return fail('The program was stopped.');
    const obj = getState().bench.objects.find((o) => o.name === r.name);
    return json(compact({ name: r.name, type: obj ? obj.type : c.simple, fields: obj ? Object.fromEntries((obj.preview || []).map((p) => [p.name, p.text])) : null }), t('agent.sum.object', { name: r.name }));
  },

  call_method: async (input, call) => {
    const busy = benchBusy();
    if (busy) return busy;
    const s = getState();
    const model = projectModel(s.files);
    let cls;
    let target = null;
    if (input.object) {
      const obj = s.bench.objects.find((o) => o.name === input.object);
      if (!obj) return fail(s.bench.objects.length ? `No object ${input.object}. On the bench: ${listOf(s.bench.objects.map((o) => o.name))}` : 'The object bench is empty.');
      if (!obj.value || !obj.value.project) return fail("Only objects of project classes. Use run_main or ask the student to use the object's menu.");
      cls = obj.className;
      target = obj.name;
    } else {
      const c = classOf(model, input.class);
      if (!c) return fail(`No class ${input.class}. Classes: ${listOf(model.names)}`);
      if (!(await A.ensureCompiled())) return { ...compileResult(false), isError: true };
      cls = c.fileClass;
    }
    const desc = await A.describe(cls);
    if (!desc) return fail(`Could not read the class ${simpleName(cls)}.`);
    const args = input.args || [];
    const named = desc.methods.filter((m) => m.name === input.method && !m.abstract && (input.object || m.static));
    const fitting = named.filter((m) => m.params.length === args.length);
    if (!fitting.length) {
      const all = desc.methods.filter((m) => !m.abstract && (input.object || m.static)).map((m) => sigOf(m.name, m));
      return fail(named.length ? `${input.method} takes ${named.map((m) => m.params.length).join(' or ')} arguments: ${named.map((m) => sigOf(m.name, m)).join(', ')}` : `No ${input.object ? '' : 'static '}method ${input.method}. Methods: ${listOf([...new Set(all)], 40)}`);
    }
    const method = pickOverload(fitting, args);
    const mark = consoleMark();
    const r = await runJava(call.callId, A.callMethod({ target, cls, method, args: argsFor(args), quiet: true }), 30000);
    if (r.paused) return pausedResult(r);
    if (r.timedOut) return json({ timedOut: true, note: 'The method did not finish within 30 s; the program was stopped.' }, t('agent.sum.timedOut', { s: 30 }));
    if (r.error) return fail(r.error);
    if (r.exception) return json({ exception: exceptionLine(r.exception), output: consoleSince(mark, 2000) }, t('agent.sum.exception', { type: r.exception.simpleType }));
    if (r.stopped) return fail('The program was stopped.');
    const res = r.result;
    const value = res.void ? null : valueText(res.value);
    return json(compact({ result: value, type: method.returnType, output: consoleSince(mark, 2000) }), res.void ? t('agent.sum.ran') : t('agent.sum.returned', { value: String(value).slice(0, 40) }));
  },

  open_file: ({ path, line, end_line }) => {
    const text = fileText(path);
    if (text == null) return noFile(path);
    const n = text.split('\n').length;
    const name = isReadme(path) ? '#readme' : path;
    const from = line ? Math.min(n, line) : null;
    A.openFile(name, from || undefined);
    if (from && end_line) setState({ agentHighlight: { file: name, from, to: Math.min(n, end_line), at: Date.now() } });
    return { content: from ? `Opened ${fileLabel(path)} at line ${from}.` : `Opened ${fileLabel(path)}.`, summary: '' };
  },

  select_class: ({ name }) => {
    const s = getState();
    const model = projectModel(s.files);
    const c = classOf(model, name);
    if (!c) return fail(`No class ${name}. Classes: ${listOf(model.names)}`);
    if (s.view !== 'project') A.go('project');
    if (c.pkg !== s.pkg) A.enterPackage(c.pkg);
    setState({ selectedClass: c.fileClass, revealCard: { key: c.fileClass, at: Date.now() } });
    return { content: `Selected ${c.simple}.`, summary: '' };
  },

  show_tutorial: ({ title, steps }, call) => {
    const warnings = [];
    for (const [i, step] of steps.entries()) {
      const r = tour.check(step.target, steps.slice(0, i));
      if (r && r.error) return fail(`step ${i + 1}: ${r.error}`);
      if (r && r.warning) warnings.push(`step ${i + 1}: ${r.warning}`);
    }
    A.startTour({ title, steps, callId: call.callId, turnId: call.turnId });
    return json(compact({ shown: true, steps: steps.length, warnings }), t('tour.count', { i: 1, n: steps.length }));
  },

  point_at: async ({ target, text }, call) => {
    const r = tour.check(target, []);
    if (r && r.error) return fail(r.error);
    const ok = await A.pointAt({ target, text, callId: call.callId, turnId: call.turnId });
    return ok ? { content: 'Shown.', summary: '' } : fail(`Not visible: ${target}`);
  },
};

// ------------------------------------------------------------------ proposals

/** edit_file's replacement on a given text. CRLF files stay CRLF. */
function replaceIn(path, text, oldText, newText, all) {
  const crlf = text.includes('\r\n');
  const src = text.replace(/\r\n/g, '\n');
  const o = oldText.replace(/\r\n/g, '\n');
  const n = newText.replace(/\r\n/g, '\n');
  if (o === n) return { error: 'old_text and new_text are the same.' };
  const at = [];
  for (let i = src.indexOf(o); i >= 0; i = src.indexOf(o, i + Math.max(1, o.length))) at.push(i);
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  if (!at.length) {
    const first = o.split('\n').map((l) => l.trim()).find(Boolean);
    const lines = first ? src.split('\n').map((l, i) => (l.includes(first) ? i + 1 : 0)).filter(Boolean).slice(0, 5) : [];
    return { error: `old_text not found in ${fileLabel(path)}. ` + (lines.length ? `Its first line occurs at line ${lines.join(', ')}; re-read the file and copy the text exactly.` : 'Re-read the file.') };
  }
  if (at.length > 1 && !all) return { error: `old_text occurs ${at.length} times (lines ${at.slice(0, 8).map(lineOf).join(', ')}). Include more surrounding lines or set replace_all.` };
  const after = all ? src.split(o).join(n) : src.slice(0, at[0]) + n + src.slice(at[0] + o.length);
  return { after: crlf ? after.replace(/\n/g, '\r\n') : after };
}

function setProposal(id, patch) {
  setState((s) => {
    const p = s.agent.proposals[id];
    const next = p ? { ...p, ...patch } : { id, ...patch };
    return { agent: { ...s.agent, proposals: { ...s.agent.proposals, [id]: next } } };
  });
}

const getProposal = (id) => getState().agent.proposals[id];

function openProposal(id) {
  const p = getProposal(id);
  if (p && p.status === 'pending') setProposal(id, { status: 'open' });
}

function addNote(key, p) {
  const text = t(key, { file: fileLabel(p.file) });
  setState((s) => ({ chat: { ...s.chat, notes: [...(s.chat.notes || []), text] } }));
}

/** Settles the tool call waiting for this proposal, or (after a stop) leaves a note for the next message. */
function settle(p, result, noteKey) {
  const wait = waits.get(p.callId);
  if (wait) {
    waits.delete(p.callId);
    wait(result);
  } else if (noteKey) addNote(noteKey, p);
}

function propose(change, call) {
  const id = 'p' + call.callId;
  const s = getState();
  const auto = !!s.settings.agentWrite && s.chat.mode === 'explain' && change.kind !== 'delete';
  setProposal(id, { ...change, callId: call.callId, turnId: call.turnId, status: 'pending', createdAt: Date.now() });
  // The card goes right after the call's row (which is hidden for writes: the card is the row).
  patchTurn(call.turnId, (turn) => {
    const parts = (turn.parts || []).slice();
    const i = parts.findIndex((p) => p.type === 'tool' && p.callId === call.callId);
    const step = i >= 0 ? parts[i].step : 0;
    parts.splice(i >= 0 ? i + 1 : parts.length, 0, { type: 'diff', proposalId: id, step });
    return { ...turn, parts };
  });
  if (change.kind === 'write' || change.kind === 'edit') {
    // The editor opens where the change starts, so the student sees the spot next to the card.
    const first = lineDiff(change.before, change.after).rows.find((r) => r.type === 'add' || r.type === 'del');
    A.openFile(change.file, first ? first.b || first.a : undefined);
  }
  const summary = change.kind === 'delete' ? '' : diffStat(change);
  if (auto) {
    // The student may have typed since the tool read the file (here or in a pop-out).
    const after = rebase(change, change.after);
    if (after == null) {
      setProposal(id, { status: 'conflict' });
      return Promise.resolve(fail(`${fileLabel(change.file)} changed since you read it. Re-read it.`));
    }
    return applyChange({ ...getProposal(id), after }).then((err) => {
      if (err) {
        setProposal(id, { status: 'conflict' });
        return fail(err);
      }
      setProposal(id, { status: 'applied', after, appliedAt: Date.now() });
      return json({ status: 'applied', file: change.file, lines: change.after.split('\n').length, note: 'The student can undo it.' }, summary);
    });
  }
  return new Promise((resolve) => {
    waits.set(call.callId, (r) => resolve({ ...r, summary: r.summary ?? summary }));
  });
}

function diffStat(change) {
  const before = String(change.before).split('\n');
  const after = String(change.after).split('\n');
  return `${after.length - before.length >= 0 ? '+' : ''}${after.length - before.length}`;
}

/** Writes a change to the project. Returns an error text or null. */
async function applyChange(p) {
  if (p.kind === 'write' || p.kind === 'edit') {
    A.editFile(p.file, p.after);
    const ok = await A.saveFile(p.file);
    return ok ? null : `Could not save ${fileLabel(p.file)}.`;
  }
  if (p.kind === 'create') {
    const r = await api.project.createClass({ className: p.className, content: p.after });
    if (!r.ok) return A.errorText(r.error);
    A.addCreatedFile(r.result);
    return null;
  }
  if (p.kind === 'delete') return (await A.deleteClass(p.className)) ? null : `Could not delete ${simpleName(p.className)}.`;
  return 'Unknown change.';
}

/** The change as it would apply to the files now, or null when they moved on since the proposal. */
function rebase(p, after) {
  const now = getState().files[p.file];
  if (p.kind === 'create') return now ? null : after;
  if (p.kind === 'delete') return now ? after : null;
  if (!now) return null;
  if (now.content === p.before) return after;
  if (p.kind === 'edit' && after === p.after) {
    const r = replaceIn(p.file, now.content, p.edit.old_text, p.edit.new_text, p.edit.replace_all);
    return r.error ? null : r.after;
  }
  return null;
}

const busyIds = new Set();

/** Übernehmen. `text` is the right side of the diff dialog when the student tweaked it there. */
export async function acceptProposal(id, text) {
  const p = getProposal(id);
  if (!p || !(p.status === 'pending' || p.status === 'open') || busyIds.has(id)) return;
  busyIds.add(id);
  setProposal(id, { busy: true });
  try {
    const after = rebase(p, text != null ? text : p.after);
    const dialog = getState().dialog;
    if (dialog && dialog.proposalId === id) setState({ dialog: null });
    if (after == null) {
      setProposal(id, { status: 'conflict' });
      settle(p, { isError: true, content: `${fileLabel(p.file)} changed since you read it. Re-read it.` });
      return;
    }
    const err = await applyChange({ ...p, after });
    if (err) {
      setProposal(id, { status: 'conflict' });
      settle(p, { isError: true, content: err });
      toast(err, 'bad');
      return;
    }
    setProposal(id, { status: 'accepted', after, appliedAt: Date.now() });
    settle(p, { content: JSON.stringify({ status: 'accepted', file: p.file, ...(after !== p.after ? { note: 'The student adjusted the change before applying it. Re-read the file.' } : {}) }) }, 'agent.note.accepted');
  } finally {
    busyIds.delete(id);
    if (getProposal(id)) setProposal(id, { busy: false });
  }
}

/** Verwerfen. */
export function rejectProposal(id) {
  const p = getProposal(id);
  // While Übernehmen is still saving, the change is on its way: discarding it now would tell the model the opposite.
  if (!p || !(p.status === 'pending' || p.status === 'open') || busyIds.has(id)) return;
  const dialog = getState().dialog;
  if (dialog && dialog.proposalId === id) setState({ dialog: null });
  setProposal(id, { status: 'rejected' });
  settle(p, { content: JSON.stringify({ status: 'rejected', note: 'The student discarded this change. Do not repeat it unless they ask.' }) }, 'agent.note.rejected');
}

/** Rückgängig: only while the file is still exactly what the tutor wrote. */
export async function undoChange(id) {
  const p = getProposal(id);
  if (!p || !(p.status === 'applied' || p.status === 'accepted')) return;
  const now = getState().files[p.file];
  if (!now || now.content !== p.after) {
    toast(t('agent.undoConflict'), 'bad');
    return;
  }
  if (p.kind === 'create') await A.deleteClass(p.className);
  else {
    A.editFile(p.file, p.before);
    await A.saveFile(p.file);
  }
  setProposal(id, { status: 'undone' });
  addNote('agent.note.undone', p);
}

/** The newest applied proposal of a file is the only one that offers Rückgängig. */
export function canUndo(p, proposals) {
  if (!(p.status === 'applied' || p.status === 'accepted') || p.kind === 'delete') return false;
  return !Object.values(proposals).some((q) => q.file === p.file && q.id !== p.id && (q.appliedAt || 0) > (p.appliedAt || 0) && q.status !== 'rejected' && q.status !== 'cancelled' && q.status !== 'conflict');
}

/** New chat, closed project: what is still waiting is cancelled. */
export function closeProposals() {
  const list = Object.values(getState().agent.proposals);
  if (!list.length) return;
  for (const p of list) {
    if (p.status === 'pending' || p.status === 'open') {
      setProposal(p.id, { status: 'cancelled' });
      settle(p, { isError: true, content: 'This chat was closed.' });
    }
  }
  waits.clear();
  setState({ agent: { proposals: {} } });
}

/** The proposal the editor shows a bar for: pending or open, for this file. */
export function proposalFor(proposals, file) {
  return Object.values(proposals).find((p) => p.file === file && (p.status === 'pending' || p.status === 'open') && p.kind !== 'create' && p.kind !== 'delete') || null;
}

/** The turn waits only for the student's decision on a change (the composer can stop and resend). */
export function waitingForStudent(s = getState()) {
  return Object.values(s.agent.proposals).some((p) => p.status === 'pending');
}

// ------------------------------------------------------------------ labels for the chat

const WRITES = new Set(['create_class', 'write_file', 'edit_file', 'delete_class']);
export const isWriteTool = (name) => WRITES.has(name);

/** "Liest Hund.java": the row label of a tool call, with its input filled in. */
export function toolLabel(part, tr) {
  const i = part.input;
  if (!i) return tr('agent.toolShort.' + part.name);
  const key = 'agent.tool.' + (part.name === 'write_file' ? 'edit_file' : part.name);
  return tr(key, {
    file: fileLabel(i.path),
    query: i.query,
    name: i.name ? simpleName(i.name) : i.name,
    class: i.class ? simpleName(i.class) : '',
    target: i.object || (i.class ? simpleName(i.class) : ''),
    method: i.method,
  });
}
