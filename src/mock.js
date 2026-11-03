// A stand-in for the Electron bridge, so the interface can be previewed in a plain browser.
// It simulates the bundled examples and a small object bench; nothing here runs Java.
import { parseJava } from './lib/javaParse.js';

const sources = import.meta.glob('../resources/examples/*/*.java', { query: '?raw', import: 'default', eager: true });

const RAW = { int: 'int', double: 'double', boolean: 'boolean', char: 'char', long: 'long', String: 'java.lang.String' };
const key = (name, params) => `${name}(${params.map((p) => RAW[p.type] || p.type).join(',')})`;
const category = (t) => (t === 'int' || t === 'long' ? 'int' : t === 'double' ? 'decimal' : t === 'boolean' ? 'boolean' : t === 'char' ? 'char' : t === 'String' ? 'string' : t.endsWith('[]') ? 'array' : 'object');
const defaults = { int: '0', double: '0.0', boolean: 'false', char: "'\\u0000'", long: '0' };

export function createMock() {
  const listeners = { out: new Set(), state: new Set(), ai: new Set() };
  const emit = (k, v) => listeners[k].forEach((f) => f(v));
  let settings = { lang: 'de', theme: 'dark', fontSize: 14, hoverHelp: true, autosave: true, diagramDetails: true, jdkPath: null, model: 'claude-opus-5-5', tutorMode: 'hints', sendContext: true, showCosts: false, rememberKey: true, recent: [{ dir: 'C:\\Users\\Schueler\\Documents\\BlackJ\\Tiere', name: 'Tiere', opened: new Date().toISOString() }] };
  let files = {};
  let objects = {};
  let hasKey = false;
  const ok = (result) => Promise.resolve({ ok: true, result });
  const infos = () => Object.fromEntries(Object.entries(files).map(([n, c]) => [n.slice(0, -5), parseJava(c, n.slice(0, -5))]));

  function project(name) {
    files = {};
    for (const [p, content] of Object.entries(sources)) {
      const parts = p.split('/');
      if (parts[parts.length - 2] === name) files[parts[parts.length - 1]] = content;
    }
    objects = {};
    return { dir: 'C:\\Users\\Schueler\\Documents\\BlackJ\\' + name, name, files: Object.entries(files).map(([n, c]) => ({ name: n, className: n.slice(0, -5), content: c })), positions: {}, fromBlueJ: false, readOnly: false };
  }

  function describe(className) {
    const all = infos();
    const info = all[className];
    const methods = [];
    const seen = new Set();
    for (let c = info, inherited = false; c; c = all[c.extends[0]], inherited = true) {
      for (const m of c.methods) {
        if (m.visibility === 'private') continue;
        const k = key(m.name, m.params);
        if (seen.has(k)) continue;
        seen.add(k);
        methods.push({ key: k, name: m.name, returnType: m.returnType, params: m.params.map((p) => ({ ...p, raw: RAW[p.type] || p.type, category: category(p.type) })), static: m.static, abstract: m.abstract, visibility: m.visibility, declaringClass: c.name, inherited });
      }
    }
    methods.push({ key: 'toString()', name: 'toString', returnType: 'String', params: [], static: false, visibility: 'public', declaringClass: 'java.lang.Object', inherited: true });
    return { name: className, kind: info.kind, superclass: info.extends[0] || null, interfaces: info.implements, constructors: info.kind === 'class' ? info.ctors.map((c) => ({ key: key('<init>', c.params), name: className, params: c.params.map((p) => ({ ...p, raw: RAW[p.type] || p.type, category: category(p.type) })), visibility: c.visibility })) : [], methods };
  }

  function fieldsOf(className) {
    const all = infos();
    const chain = [];
    for (let c = all[className]; c; c = all[c.extends[0]]) chain.unshift(c);
    return chain.flatMap((c) => c.fields.filter((f) => !f.static).map((f) => ({ name: f.name, type: f.type, declaredIn: c.name, visibility: f.visibility })));
  }

  function benchList() {
    return Object.values(objects).map((o) => ({ name: o.name, type: o.className, className: o.className, value: { kind: 'object', type: o.className, handle: o.name, project: true, text: o.text() } }));
  }

  return {
    isMock: true,
    init: () => Promise.resolve({ version: '1.0.0', settings, jdk: { version: '21.0.6', source: 'BlueJ', home: 'C:\\Program Files\\BlueJ\\jdk', major: 21 }, jdks: [{ version: '21.0.6', source: 'BlueJ', home: 'C:\\Program Files\\BlueJ\\jdk', major: 21 }, { version: '17.0.16', source: 'Eclipse Adoptium', home: 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.16.8-hotspot', major: 17 }], examples: ['Bankkonto', 'Tiere'], tutor: { hasKey, stored: false, canStore: true, models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 4, output: 20 }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 2, output: 10 }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.1, output: 0.5 }] }, smoke: false, platform: 'win32' }),
    setSettings: (patch) => { settings = { ...settings, ...patch }; return Promise.resolve(settings); },
    chooseJdk: () => Promise.resolve({ ok: false, error: { code: 'canceled' } }),
    autoJdk: () => Promise.resolve({}),
    project: {
      openDialog: () => ok(project('Tiere')),
      open: (dir) => ok(project(dir.split('\\').pop())),
      example: (name) => ok(project(name)),
      create: (name) => { files = {}; return ok({ dir: 'C:\\Users\\Schueler\\Documents\\BlackJ\\' + name, name, files: [], positions: {}, readOnly: false }); },
      write: ({ name, content }) => { files[name] = content; return ok(null); },
      createClass: ({ className, content }) => { files[className + '.java'] = content; return ok({ name: className + '.java', className, content }); },
      deleteClass: ({ name }) => { delete files[name]; return ok(null); },
      positions: () => ok(null),
      reveal: () => Promise.resolve(null),
    },
    compile: () => new Promise((resolve) => setTimeout(() => {
      objects = {};
      const problems = [];
      for (const [n, c] of Object.entries(files)) {
        c.split('\n').forEach((line, i) => {
          if (/^\s*(int|double|String|boolean)\s+\w+\s*=\s*[^;]+$/.test(line)) problems.push({ file: n, line: i + 1, column: line.length + 1, severity: 'error', message: "';' expected", details: [], source: line });
        });
      }
      setTimeout(() => emit('state', { state: problems.length ? 'stopped' : 'ready', java: '21.0.6' }), 60);
      resolve({ ok: true, result: { ok: !problems.length, problems, ms: 640, output: '' } });
    }, 500)),
    bench: {
      describe: ({ className }) => ok(describe(className)),
      create: ({ className, args, name }) => {
        const info = describe(className);
        const n = name || className[0].toLowerCase() + className.slice(1) + (Object.keys(objects).filter((k) => k.startsWith(className[0].toLowerCase() + className.slice(1))).length + 1);
        if (objects[n]) return Promise.resolve({ ok: false, error: { kind: 'bench', code: 'nameTaken', params: { name: n } } });
        const values = {};
        for (const f of fieldsOf(className)) values[f.name] = defaults[f.type] ?? 'null';
        const ctor = info.constructors[0];
        (ctor ? ctor.params : []).forEach((p, i) => { if (p.name in values) values[p.name] = args[i]?.kind === 'ref' ? args[i].name : String(args[i]?.text ?? '').replace(/^"|"$/g, ''); });
        if ('leben' in values) values.leben = '7';
        objects[n] = { name: n, className, values, text: () => ('name' in values && 'alter' in values ? `${values.name} (${values.alter} Jahre)` : null) };
        return ok({ name: n, value: { kind: 'object', type: className }, bench: benchList() });
      },
      call: ({ target, key: k }) => {
        const o = objects[target];
        const m = describe(o.className).methods.find((x) => x.key === k);
        let value = null;
        const field = m.name.replace(/^(get|is)/, '');
        const fname = field[0].toLowerCase() + field.slice(1);
        if (m.name === 'gibLaut') value = o.className === 'Katze' ? 'Miau!' : 'Wuff!';
        else if (m.name === 'geburtstag') o.values.alter = String(Number(o.values.alter) + 1);
        else if (m.name === 'gassiGehen') { o.values.gassiGegangen = 'true'; emit('out', [{ stream: 'out', text: `${o.values.name} war Gassi und ist jetzt glücklich.\n` }]); }
        else if (m.name === 'einzahlen') o.values.kontostand = String(Number(o.values.kontostand) + 50);
        else if (fname in o.values) value = o.values[fname];
        else if (m.name === 'toString') value = o.text();
        const isVoid = m.returnType === 'void';
        return ok({ void: isVoid, type: m.returnType, value: isVoid ? null : { kind: m.returnType === 'String' ? 'string' : 'prim', type: m.returnType, text: value ?? '0' }, bench: benchList() });
      },
      main: () => { emit('out', [{ stream: 'out', text: 'Wie soll dein Hund heißen? ' }]); emit('state', { state: 'waiting' }); return new Promise(() => {}); },
      inspect: ({ ref }) => {
        const o = objects[ref];
        return ok({ ref, type: o.className, value: { kind: 'object', type: o.className, text: o.text() }, fields: fieldsOf(o.className).map((f) => ({ ...f, value: { kind: f.type === 'String' ? 'string' : 'prim', type: f.type, text: o.values[f.name] } })), statics: [] });
      },
      store: () => ok({ bench: benchList() }),
      remove: ({ name }) => { delete objects[name]; return ok(benchList()); },
      list: () => ok(benchList()),
      stdin: ({ text }) => { emit('out', [{ stream: 'out', text: `Im Streichelzoo leben 2 Tiere:\n${text.trim()} sagt Wuff!\nMinka sagt Miau!\nDurchschnittsalter: 4.0 Jahre\n` }]); emit('state', { state: 'idle' }); return ok(null); },
      reset: () => { objects = {}; emit('state', { state: 'ready' }); return ok(null); },
      onOut: (f) => { listeners.out.add(f); return () => listeners.out.delete(f); },
      onState: (f) => { listeners.state.add(f); return () => listeners.state.delete(f); },
    },
    ai: {
      status: () => Promise.resolve({ hasKey }),
      setKey: () => { hasKey = true; return ok({ hasKey }); },
      forgetKey: () => { hasKey = false; return Promise.resolve({ hasKey }); },
      newChat: () => Promise.resolve(),
      send: ({ turnId }) => {
        const text = 'Gute Frage! Schau dir die Methode **durchschnittsalter()** an: Was passiert, wenn das Gehege noch leer ist?\n\n```java\nif (tiere.size() == 0) {\n    return 0;\n}\n```\n\nÜberleg dir, wo diese Prüfung hingehört.';
        let i = 0;
        setTimeout(() => emit('ai', { turnId, type: 'thinking' }), 100);
        const timer = setInterval(() => {
          if (i >= text.length) { clearInterval(timer); emit('ai', { turnId, type: 'done', usage: { input: 1840, output: 96 }, cost: 0.0093, stopReason: 'end_turn' }); return; }
          emit('ai', { turnId, type: 'delta', text: text.slice(i, i + 6) });
          i += 6;
        }, 30);
        return Promise.resolve(true);
      },
      stop: () => Promise.resolve(),
      continue: () => Promise.resolve(true),
      toolResult: () => Promise.resolve(true),
      editStop: () => Promise.resolve(),
      onTool: () => () => {},
      onEvent: (f) => { listeners.ai.add(f); return () => listeners.ai.delete(f); },
    },
    openExternal: () => Promise.resolve(),
    smoke: { capture: () => Promise.resolve(), log: () => Promise.resolve(), done: () => Promise.resolve() },
  };
}
