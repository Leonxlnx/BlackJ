// The tutor's tools: definitions for the API, input checks, the rules per mode, and the grammar of
// the UI targets a tutorial can point at. Pure functions; the window carries the tools out.

const PATH = { type: 'string', maxLength: 200, description: 'Project-relative path with forward slashes, e.g. "Hund.java" or "tiere/Hund.java".' };
const CLASS = { type: 'string', maxLength: 120, description: 'Class name, simple ("Hund") or with package ("tiere.Hund").' };
const ACTION = { type: 'string', enum: ['click', 'contextmenu', 'doubleclick', 'type', 'compile_ok', 'object_created', 'method_called', 'tests_pass', 'main_finished', 'next'] };

const JAVA_PATH = /^(?:[A-Za-z_$][\w$]*\/)*[A-Za-z_$][\w$]*\.java$/;
const README_PATH = /^readme\.(txt|md)$/i;
const CLASS_NAME = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;

// ------------------------------------------------------------------ UI targets

const P = '((?:[A-Za-z_$][\\w$]*\\/)*[A-Za-z_$][\\w$]*\\.java)';
const plain = (id) => ({ kind: id, re: new RegExp('^' + id.replace(/[-]/g, '\\-') + '$'), doc: id });

/**
 * Every id a tutorial step may name. The same rows live in src/lib/tour-targets.mjs for the window;
 * scripts/test-ai.cjs checks that both agree. `group` places the row in the tool description.
 */
const TARGETS = [
  ...['compile', 'run-main', 'stop', 'search', 'side-panel', 'state', 'new-class', 'new-package', 'arrange', 'diagram', 'zoom', 'diagram-more', 'readme'].map(plain),
  { kind: 'class', re: /^class:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/, doc: 'class:<Name>' },
  { kind: 'class-new', re: /^class-new:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/, doc: 'class-new:<Name> (the + on a card)' },
  { kind: 'package', re: /^package:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/, doc: 'package:<name>' },
  plain('bench'),
  { kind: 'object', re: /^object:([A-Za-z_$][\w$]*)$/, doc: 'object:<name>' },
  plain('library'),
  { kind: 'dock', re: /^dock:(objects|console|pad|tests|problems|debug)$/, doc: 'dock:objects|console|pad|tests|problems|debug' },
  ...['console-input', 'pad-input', 'tests-run'].map(plain),
  { kind: 'problem', re: /^problem:([1-9]\d?)$/, doc: 'problem:<n> (1 = first)' },
  plain('editor'),
  { kind: 'editor-tab', re: new RegExp('^editor-tab:' + P + '$'), doc: 'editor-tab:<path>' },
  { kind: 'line', re: new RegExp('^line:' + P + ':(\\d{1,5})$'), doc: 'line:<path>:<n>' },
  { kind: 'gutter', re: new RegExp('^gutter:' + P + ':(\\d{1,5})$'), doc: 'gutter:<path>:<n> (breakpoint margin)' },
  ...['editor-mode', 'format', 'ai-write', 'explain', 'proposal-accept', 'inspector'].map(plain),
  { kind: 'side-tab', re: /^side-tab:(tutor|inspect)$/, doc: 'side-tab:tutor|inspect' },
  ...['composer', 'tutor-mode', 'new-chat'].map(plain),
  { kind: 'debug', re: /^debug:(resume|stepOver|stepInto|stepOut)$/, doc: 'debug:resume|stepOver|stepInto|stepOut' },
  { kind: 'rail', re: /^rail:(home|project|learn|settings)$/, doc: 'rail:home|project|learn|settings' },
  { kind: 'settings', re: /^settings:(aiInline|agentWrite|model|java|theme|lang|fontSize)$/, doc: 'settings:aiInline|agentWrite|model|java|theme|lang|fontSize' },
  {
    kind: 'menu', group: 'class',
    re: /^menu:(new|new:\d{1,2}|static:[A-Za-z_$][\w$]*|runMain|runTests|record|inspectClass|compileNow|open|createTest|explain|delete)$/,
    doc: 'menu:new (first constructor), menu:new:<i> (0-based), menu:static:<method>, menu:runMain, menu:runTests, menu:record, menu:inspectClass, menu:compileNow, menu:open, menu:createTest, menu:explain, menu:delete',
  },
  { kind: 'menu', group: 'object', re: /^menu:(method:[A-Za-z_$][\w$]*|libMethods|inspect|remove)$/, doc: 'menu:method:<name>, menu:libMethods, menu:inspect, menu:remove' },
  { kind: 'dialog', group: 'dialog', re: /^dialog:(arg:\d{1,2}|name|confirm|cancel)$/, doc: 'dialog:arg:<i> (0-based), dialog:name, dialog:confirm, dialog:cancel' },
];

/** "line:Hund.java:12" -> { kind: 'line', arg: 'Hund.java', arg2: 12 }; null for anything else. */
function parseTarget(id) {
  if (typeof id !== 'string') return null;
  for (const row of TARGETS) {
    const m = id.match(row.re);
    if (!m) continue;
    const out = { kind: row.kind, arg: m[1] ?? null, arg2: m[2] != null ? Number(m[2]) : null };
    return out;
  }
  return null;
}

const docsOf = (group) => TARGETS.filter((r) => (r.group || 'ui') === group).map((r) => r.doc).join(', ');

// ------------------------------------------------------------------ tool definitions

const tool = (name, description, properties, required = []) => ({
  name,
  description,
  eager_input_streaming: true,
  input_schema: { type: 'object', additionalProperties: false, properties, required },
});
const strings = (maxItems, maxLength) => ({ type: 'array', maxItems, items: { type: 'string', maxLength } });

const TOOLS = [
  tool('get_project', 'What BlackJ shows right now: classes with members and relations, compile state and errors, objects on the object bench, the open file, selection and cursor, recent console output, the last exception, test results, the current exercise, a running tutorial, and which panels are open. Use it when the context sent with the message is not enough.', {}),
  tool('read_file', 'Read a source file (or README.TXT) as the editor has it, including unsaved changes, with line numbers. At most 400 lines per call. Read a file before you change it.', {
    path: PATH, from_line: { type: 'integer', minimum: 1 }, to_line: { type: 'integer', minimum: 1 },
  }, ['path']),
  tool('search_code', 'Search all .java files (or one file) for text, case-insensitive; regex: true for a JavaScript regular expression. Returns up to 50 matching lines.', {
    query: { type: 'string', minLength: 1, maxLength: 200 }, regex: { type: 'boolean' }, path: PATH,
  }, ['query']),
  tool('inspect_object', 'Fields and current values of an object on the object bench.', { name: { type: 'string', minLength: 1, maxLength: 64 } }, ['name']),
  tool('create_class', 'Create a new class file with this exact content. The content must declare the class with the same name and, for a class in a package, the matching package line. Fails if the class exists.', {
    name: CLASS, content: { type: 'string', minLength: 1, maxLength: 60000 },
  }, ['name', 'content']),
  tool('write_file', 'Replace the whole content of an existing .java file. Use edit_file for small changes.', {
    path: PATH, content: { type: 'string', minLength: 1, maxLength: 60000 },
  }, ['path', 'content']),
  tool('edit_file', 'Replace exact text in a .java file. old_text must match the current file exactly (whitespace included) and occur once, unless replace_all is true.', {
    path: PATH, old_text: { type: 'string', minLength: 1, maxLength: 20000 }, new_text: { type: 'string', maxLength: 20000 }, replace_all: { type: 'boolean' },
  }, ['path', 'old_text', 'new_text']),
  tool('delete_class', 'Move a class file to the recycle bin. Only for classes no other class uses; the student must confirm.', { name: CLASS }, ['name']),
  tool('compile', 'Save and compile all classes, like the Kompilieren button. Compiling clears the objects on the object bench.', {}),
  tool('run_tests', 'Run JUnit tests: all, one test class, or one test method (method needs class). Compiles first if needed.', {
    class: CLASS, method: { type: 'string', maxLength: 120 },
  }),
  tool('run_main', "Run a class's main method like 'main starten'. input: lines typed into the console when the program waits for input. Stops after timeout_s (default 10).", {
    class: CLASS, input: strings(50, 500), timeout_s: { type: 'integer', minimum: 1, maximum: 30 },
  }, ['class']),
  tool('create_object', 'Create an object on the object bench, like right-click > new. args are Java expressions: literals ("Bello", 3, true) or names of bench objects. The constructor is chosen by the number of args.', {
    class: CLASS, args: strings(12, 500), name: { type: 'string', minLength: 1, maxLength: 64 },
  }, ['class']),
  tool('call_method', 'Call a method of a bench object (object) or a static method (class), like the object menu. Returns the result and console output.', {
    object: { type: 'string', maxLength: 64 }, class: CLASS, method: { type: 'string', maxLength: 120 }, args: strings(12, 500),
  }, ['method']),
  tool('open_file', 'Open a file in the editor and show a line or range. Use it to point at code.', {
    path: PATH, line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 },
  }, ['path']),
  tool('select_class', 'Select and show a class card in the class diagram.', { name: CLASS }, ['name']),
  tool('show_tutorial',
    'Use this when the student asks where something is or how to do something in BlackJ. Each step draws a ring around a UI element with your short text and waits until the student does it. BlackJ labels the ring with the action itself (Hier klicken, Rechtsklick), so the text says only what the step does ("Kompiliert alle Klassen.", "Öffnet das Menü von Hund.") and never starts with a click verb. ' +
    'action ends the step: click, contextmenu (right-click), doubleclick, type (the student edits the file), compile_ok, object_created, method_called, tests_pass, main_finished, next (the student presses Weiter). ' +
    'Default: contextmenu on class cards, click on other buttons, next otherwise. Returns at once; afterwards change nothing else in the UI and end with one short sentence that stands on its own (the steps do not appear in the chat). One tutorial per answer.\n' +
    'Targets: ' + docsOf('ui') + '. After a right-click on a class: ' + docsOf('class') + '. After a click on an object: ' + docsOf('object') + '. In a dialog: ' + docsOf('dialog') + '.',
    {
      title: { type: 'string', maxLength: 60 },
      steps: {
        type: 'array', minItems: 1, maxItems: 8,
        items: {
          type: 'object', additionalProperties: false,
          properties: { target: { type: 'string', maxLength: 120 }, text: { type: 'string', minLength: 1, maxLength: 200 }, action: ACTION },
          required: ['target', 'text'],
        },
      },
    }, ['steps']),
  tool('point_at', 'Draw a ring around one UI element with a short note, without steps. Same targets as show_tutorial.', {
    target: { type: 'string', maxLength: 120 }, text: { type: 'string', minLength: 1, maxLength: 160 },
  }, ['target', 'text']),
];

const BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// ------------------------------------------------------------------ input checks

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A checker for exactly the schema features used above. Returns a reason or null. */
function checkSchema(schema, value, at) {
  if (schema.type === 'object') {
    if (!isPlain(value)) return `${at} must be an object`;
    for (const k of schema.required || []) if (!(k in value)) return `${at}.${k} is missing`;
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties[k];
      if (!sub) {
        if (schema.additionalProperties === false) return `${at}.${k} is not allowed`;
        continue;
      }
      const r = checkSchema(sub, v, `${at}.${k}`);
      if (r) return r;
    }
    return null;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${at} must be a string`;
    if (schema.minLength != null && value.length < schema.minLength) return `${at} is too short`;
    if (schema.maxLength != null && value.length > schema.maxLength) return `${at} is too long (max ${schema.maxLength})`;
    if (schema.enum && !schema.enum.includes(value)) return `${at} must be one of ${schema.enum.join(', ')}`;
    return null;
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return `${at} must be an integer`;
    if (schema.minimum != null && value < schema.minimum) return `${at} must be at least ${schema.minimum}`;
    if (schema.maximum != null && value > schema.maximum) return `${at} must be at most ${schema.maximum}`;
    return null;
  }
  if (schema.type === 'boolean') return typeof value === 'boolean' ? null : `${at} must be true or false`;
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${at} must be an array`;
    if (schema.minItems != null && value.length < schema.minItems) return `${at} needs at least ${schema.minItems} items`;
    if (schema.maxItems != null && value.length > schema.maxItems) return `${at} has more than ${schema.maxItems} items`;
    for (let i = 0; i < value.length; i++) {
      const r = checkSchema(schema.items, value[i], `${at}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  return null;
}

/** Schema plus the rules a schema cannot say. Returns a reason (model-facing) or null. */
function validateToolInput(name, input) {
  const def = BY_NAME[name];
  if (!def) return 'unknown tool';
  const bad = checkSchema(def.input_schema, input, 'input');
  if (bad) return bad;
  const p = input.path;
  if (p != null) {
    const readme = (name === 'read_file' || name === 'open_file') && README_PATH.test(p);
    if (!readme && !JAVA_PATH.test(p)) return `path "${p}" must be a project .java file like "Hund.java" or "tiere/Hund.java"`;
  }
  for (const k of ['name', 'class']) {
    if (input[k] == null) continue;
    if ((name === 'create_object' && k === 'name') || name === 'inspect_object') {
      if (!IDENT.test(input[k])) return `${k} must be a Java identifier`;
    } else if (!CLASS_NAME.test(input[k])) return `${k} "${input[k]}" is not a class name`;
  }
  if (name === 'call_method') {
    if ((input.object == null) === (input.class == null)) return 'give exactly one of object or class';
    if (input.object != null && !IDENT.test(input.object)) return 'object must be the name of a bench object';
    if (!IDENT.test(input.method)) return 'method must be a method name';
  }
  if (name === 'run_tests' && input.method != null && input.class == null) return 'method needs class';
  if (name === 'read_file' && input.from_line && input.to_line && input.to_line < input.from_line) return 'to_line must be >= from_line';
  if (name === 'open_file' && input.line && input.end_line && input.end_line < input.line) return 'end_line must be >= line';
  if (name === 'show_tutorial') {
    for (const [i, s] of input.steps.entries()) if (!parseTarget(s.target)) return `steps[${i}].target "${s.target}" is not a known target`;
  }
  if (name === 'point_at' && !parseTarget(input.target)) return `target "${input.target}" is not a known target`;
  return null;
}

// ------------------------------------------------------------------ rules per mode

const WRITE = new Set(['create_class', 'write_file', 'edit_file', 'delete_class']);
const LOOK = new Set(['get_project', 'read_file', 'search_code', 'inspect_object']);

/** Hard rules that hold whatever the model writes. Returns a reason (model-facing) or null. */
function checkPolicy(name, input, agent = {}, turn = {}) {
  if (turn.tour && !LOOK.has(name)) return 'A tutorial is running for the student. Change nothing else now; end your answer with one short sentence.';
  if ((name === 'read_file' || name === 'search_code') && agent.readCode === false) {
    return 'The student turned off sending code to the tutor (Settings). Ask them to paste the part you need.';
  }
  if (!WRITE.has(name)) return null;
  if (agent.readOnly) return 'This project is read-only.';
  if (agent.exercise) {
    const file = input.path || (input.name ? String(input.name).split('.').join('/') + '.java' : '');
    const simple = String(input.name || input.path || '').replace(/\.java$/, '').split(/[./]/).pop();
    if ((agent.testFiles || []).includes(file) || /Test$/.test(simple)) return 'The tests of an exercise check the solution; they stay as they are.';
    if (agent.mode === 'hints') return 'Hints mode in an exercise: do not write the solution. Point to the place (open_file, point_at), ask a guiding question or show the next small step.';
  }
  return null;
}

/** Long tool results are cut so one call cannot fill the conversation. */
function truncate(text, max = 12000) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const keep = max - 200;
  return s.slice(0, keep) + `\n[... ${s.length - keep} more characters cut. Ask for a smaller part.]`;
}

/** Project files a call touches, for the main process's own confinement check. */
function pathsOf(name, input) {
  if (!isPlain(input)) return [];
  if (['read_file', 'write_file', 'edit_file', 'open_file', 'search_code'].includes(name)) return input.path ? [input.path] : [];
  if (name === 'create_class' || name === 'delete_class') return input.name ? [String(input.name).split('.').join('/') + '.java'] : [];
  return [];
}

module.exports = { TOOLS, TARGETS, validateToolInput, checkPolicy, truncate, parseTarget, pathsOf, WRITE };
