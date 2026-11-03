// Compiles and runs the JUnit tests of a project (JUnit 4 and JUnit 5, like BlueJ).
// Tests run in the JUnit console launcher (resources/junit); its XML reports are read back
// into one result per test, with the line in the student's test class to jump to.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const STANDALONE = 'junit-platform-console-standalone-1.11.4.jar';
const JUNIT4 = 'junit-4.13.2.jar';
const HAMCREST = 'hamcrest-core-1.3.jar';
const TIMEOUT_MS = 60000;
const MAX_OUTPUT = 1 << 20;

/** Jars for the compile classpath. The standalone jar also holds the JUnit 5 API (org.junit.jupiter.api). */
function junitJars(resDir) {
  return [JUNIT4, HAMCREST, STANDALONE].map((j) => path.resolve(resDir, 'junit', j));
}

/** True if a Java source looks like a test class: imports JUnit or uses @Test. */
function isTestSource(content) {
  const code = String(content).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  return /^\s*import\s+(?:static\s+)?(?:org\.junit|junit\.framework)\./m.test(code) || /@(?:[\w.]+\.)?Test\b/.test(code);
}

// ---------------------------------------------------------------------------------------
// A small XML parser, enough for JUnit's legacy reports: elements, attributes, text, CDATA.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => {
  if (e[0] !== '#') return ENTITIES[e] ?? all;
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
});

function parseXml(text) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][\s\S]*?>|<\/[^>]*>|<([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = TOKEN.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      const el = { name: m[2], attrs: {}, children: [], text: '' };
      for (const a of m[3].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs[a[1]] = decode(a[2] ?? a[3]);
      top.children.push(el);
      if (!m[4]) stack.push(el);
    } else if (m[5] !== undefined) top.text += decode(m[5]);
    else if (m[0].startsWith('</') && stack.length > 1) stack.pop();
  }
  return root;
}

function* elements(node, name) {
  for (const c of node.children) {
    if (c.name === name) yield c;
    yield* elements(c, name);
  }
}

// ---------------------------------------------------------------------------------------
// Stack traces: find the student's line and drop the JUnit / reflection noise.

const FRAME = /^\s*at (?:.*\/)?([^\s/(]+)\.([^.\s(]+)\((?:([^:()]+):(\d+))?[^)]*\)\s*$/;
const FRAMEWORK = /^(?:org\.junit\.|junit\.|org\.opentest4j\.|org\.hamcrest\.|org\.apiguardian\.)/;
const outer = (cls) => cls.split('$')[0];

/** Names of all top-level classes compiled into classDir (with package, e.g. "bank.Konto"). */
function projectClasses(classDir) {
  const found = new Set();
  const walk = (dir, pkg) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* no such folder */ }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name), pkg + e.name + '.');
      else if (e.name.endsWith('.class')) found.add(outer(pkg + e.name.slice(0, -6)));
    }
  };
  walk(classDir, '');
  return found;
}

/** The first frame in the test class itself, otherwise the first one in any project class. */
function sourceFrame(trace, testClass, project) {
  const frames = trace.split(/\r?\n/).map((l) => l.match(FRAME)).filter((f) => f && f[4]);
  const hit = frames.find((f) => outer(f[1]) === outer(testClass)) || frames.find((f) => project.has(outer(f[1])));
  if (!hit) return { file: null, line: null };
  const pkg = outer(hit[1]).split('.').slice(0, -1);
  return { file: [...pkg, hit[3]].join('/'), line: Number(hit[4]) };
}

/** Keeps exception lines and frames down to the last project frame of each block, minus JUnit's own. */
function shortTrace(trace, project) {
  const blocks = [];
  for (const line of trace.replace(/\s+$/, '').split(/\r?\n/)) {
    const f = line.match(FRAME);
    if (!f || !blocks.length) blocks.push({ head: line, frames: [] });
    else blocks[blocks.length - 1].frames.push({ line: line.replace(/^\s+/, '\t'), cls: f[1] });
  }
  const out = [];
  for (const b of blocks) {
    if (/^\s*\.\.\. \d+ more\s*$/.test(b.head)) continue;
    out.push(b.head);
    let last = -1;
    b.frames.forEach((f, i) => { if (project.has(outer(f.cls))) last = i; });
    for (let i = 0; i <= last; i++) if (!FRAMEWORK.test(b.frames[i].cls)) out.push(b.frames[i].line);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------
// Messages: "expected: <5> but was: <4>" (JUnit 5), "expected:<5> but was:<4>" (JUnit 4).

/** JUnit 4 marks the differing part of two strings: "Hallo W[elt]" / "Hallo W[ald]". */
function unmark(e, a) {
  let p = 0;
  while (p < e.length && p < a.length && e[p] === a[p]) p++;
  let s = 0;
  while (s < e.length - p && s < a.length - p && e[e.length - 1 - s] === a[a.length - 1 - s]) s++;
  if (e[p - 1] !== '[' || e[e.length - s] !== ']') return [e, a];
  const cut = (x) => x.slice(0, p - 1) + x.slice(p, x.length - s) + x.slice(x.length - s + 1);
  return [cut(e), cut(a)];
}

function expectedActual(message, type) {
  const cls = '(?:[\\w.$]+(?:@[0-9a-f]+)?)?';
  let m = message.match(new RegExp('expected: ?' + cls + '<([\\s\\S]*?)> but was: ?' + cls + '<([\\s\\S]*)>\\s*$'));
  if (m) {
    const [expected, actual] = /ComparisonFailure$/.test(type || '') ? unmark(m[1], m[2]) : [m[1], m[2]];
    return { expected, actual };
  }
  m = message.match(/Expected: ([\s\S]*?)\n\s*but: ([\s\S]*)$/); // Hamcrest assertThat
  if (m) return { expected: m[1].trim(), actual: m[2].trim() };
  return { expected: null, actual: null };
}

const simple = (type) => (type || '').split('.').pop();

function toResult(tc, project) {
  const className = tc.attrs.classname || '';
  const legacyName = tc.attrs.name || '';
  const sysout = tc.children.filter((c) => c.name === 'system-out').map((c) => c.text).join('\n');
  const display = sysout.match(/^display-name: (.*)$/m);
  const problem = tc.children.find((c) => c.name === 'failure' || c.name === 'error');
  const skipped = tc.children.find((c) => c.name === 'skipped');
  const result = {
    className,
    name: legacyName.replace(/[([][\s\S]*$/, ''),
    displayName: display ? display[1] : legacyName,
    status: problem ? (problem.name === 'failure' ? 'failed' : 'error') : skipped ? 'skipped' : 'passed',
    message: '',
    expected: null,
    actual: null,
    file: null,
    line: null,
    ms: Math.round(Number(tc.attrs.time || 0) * 1000),
    trace: '',
  };
  const node = problem || skipped;
  if (!node) return result;
  const trace = node.text.trim();
  if (problem) {
    const raw = problem.attrs.message || '';
    const type = simple(problem.attrs.type);
    result.message = problem.name === 'error' ? type + (raw ? ': ' + raw.trim() : '') : raw.trim() || type;
    Object.assign(result, expectedActual(raw, problem.attrs.type));
  } else {
    // A skip carries the @Disabled reason, or the stack trace of a failed assumption.
    result.message = node.attrs.message || trace.split(/\r?\n/)[0].replace(/^[\w.$]+(?:Exception|Error): /, '');
  }
  if (/^\s*at /m.test(trace)) {
    Object.assign(result, sourceFrame(trace, className, project));
    result.trace = shortTrace(trace, project);
  }
  return result;
}

// ---------------------------------------------------------------------------------------
// Selecting one method: JUnit needs the parameter types, so a @ParameterizedTest is found
// by reading the method descriptors straight from the .class file.

const PRIMITIVES = { B: 'byte', C: 'char', D: 'double', F: 'float', I: 'int', J: 'long', S: 'short', Z: 'boolean' };
const POOL_SIZES = { 3: 4, 4: 4, 7: 2, 8: 2, 9: 4, 10: 4, 11: 4, 12: 4, 15: 3, 16: 2, 17: 4, 18: 4, 19: 2, 20: 2 };

function methodDescriptors(classFile, name) {
  const b = fs.readFileSync(classFile);
  const utf8 = [];
  let p = 10;
  for (let i = 1, n = b.readUInt16BE(8); i < n; i++) {
    const tag = b[p++];
    if (tag === 1) {
      const len = b.readUInt16BE(p);
      utf8[i] = b.toString('utf8', p + 2, p + 2 + len);
      p += 2 + len;
    } else if (tag === 5 || tag === 6) {
      p += 8;
      i++; // long and double take two slots
    } else if (POOL_SIZES[tag]) p += POOL_SIZES[tag];
    else throw new Error('unknown constant pool tag ' + tag);
  }
  p += 6; // access flags, this class, super class
  p += 2 + 2 * b.readUInt16BE(p); // interfaces
  const members = () => {
    const list = [];
    const count = b.readUInt16BE(p);
    p += 2;
    for (let k = 0; k < count; k++) {
      list.push([utf8[b.readUInt16BE(p + 2)], utf8[b.readUInt16BE(p + 4)]]); // [name, descriptor]
      let attrs = b.readUInt16BE(p + 6);
      p += 8;
      while (attrs--) p += 6 + b.readUInt32BE(p + 2);
    }
    return list;
  };
  members(); // fields
  return members().filter(([n]) => n === name).map(([, d]) => d);
}

function paramTypes(descriptor) {
  const out = [];
  let dims = 0;
  for (let i = 1; descriptor[i] !== ')'; ) {
    if (descriptor[i] === '[') { dims++; i++; continue; }
    let type;
    if (descriptor[i] === 'L') {
      const end = descriptor.indexOf(';', i);
      type = descriptor.slice(i + 1, end).replace(/\//g, '.');
      i = end + 1;
    } else type = PRIMITIVES[descriptor[i++]];
    out.push(type + '[]'.repeat(dims));
    dims = 0;
  }
  return out.join(', ');
}

function selectors(select, classDir) {
  if (!select || select.all || !select.className) return ['--scan-class-path=' + classDir];
  const cls = select.className;
  if (!select.method) return ['--select-class=' + cls];
  if (select.method.includes('(')) return ['--select-method=' + cls + '#' + select.method];
  let found = [];
  try {
    found = methodDescriptors(path.join(classDir, ...cls.split('.')) + '.class', select.method);
  } catch { /* inherited or unreadable: let JUnit look for a method without parameters */ }
  if (!found.length) return ['--select-method=' + cls + '#' + select.method];
  return found.map((d) => '--select-method=' + cls + '#' + select.method + '(' + paramTypes(d) + ')');
}

// ---------------------------------------------------------------------------------------

/**
 * Runs JUnit 4 and 5 tests from classDir. select is { all: true }, { className } or { className, method }.
 * Resolves with { ok, summary: { total, passed, failed, errors, skipped, ms }, tests: [...], output, error }.
 */
function runTests({ jdk, resDir, classDir, cwd, classpath = [], select = { all: true } }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const finish = (tests, output, error) => {
      tests.sort((a, b) => a.className.localeCompare(b.className, 'en', { numeric: true }) || a._order.localeCompare(b._order, 'en', { numeric: true }));
      for (const t of tests) delete t._order;
      const count = (s) => tests.filter((t) => t.status === s).length;
      const summary = { total: tests.length, passed: count('passed'), failed: count('failed') + count('error'), errors: count('error'), skipped: count('skipped'), ms: Date.now() - started };
      resolve({ ok: !error && summary.failed === 0, summary, tests, output, error });
    };
    const launcher = path.resolve(resDir, 'junit', STANDALONE);
    if (!fs.existsSync(launcher)) return finish([], '', { code: 'noJunit', message: 'JUnit is missing: ' + launcher });

    classDir = path.resolve(classDir);
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackj-junit-'));
    const [junit4, hamcrest] = junitJars(resDir);
    const args = [
      '-Dfile.encoding=UTF-8',
      '-Dstdout.encoding=UTF-8',
      '-Dstderr.encoding=UTF-8',
      '-jar', launcher, 'execute',
      '--disable-banner',
      '--disable-ansi-colors',
      '--details=tree',
      '--details-theme=unicode',
      '--class-path=' + [classDir, junit4, hamcrest, ...classpath].join(path.delimiter),
      '--reports-dir=' + reportsDir,
      // Every class may hold tests, not only names ending in "Test".
      '--include-classname=.*',
      // An endless loop in a JUnit 5 test fails that test after 10 s instead of hanging the run.
      '--config=junit.jupiter.execution.timeout.default=10s',
      '--config=junit.jupiter.execution.timeout.thread.mode.default=SEPARATE_THREAD',
      ...selectors(select, classDir),
    ];
    let output = '';
    let timedOut = false;
    let child;
    const cleanup = () => fs.rmSync(reportsDir, { recursive: true, force: true });
    // Without TERM the launcher does not probe the terminal width with "stty" (noise under Git Bash).
    const env = { ...process.env };
    delete env.TERM;
    try {
      child = spawn(jdk.java, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      cleanup();
      return finish([], String(err), { code: 'startFailed', message: String(err) });
    }
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, TIMEOUT_MS);
    const collect = (d) => { if (output.length < MAX_OUTPUT) output += d.toString('utf8'); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      finish([], output + String(err), { code: 'startFailed', message: String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const project = projectClasses(classDir);
      const tests = [];
      let files = [];
      try {
        files = fs.readdirSync(reportsDir).filter((n) => /^TEST-.*\.xml$/.test(n));
        for (const f of files) {
          for (const tc of elements(parseXml(fs.readFileSync(path.join(reportsDir, f), 'utf8')), 'testcase')) {
            tests.push(Object.assign(toResult(tc, project), { _order: tc.attrs.name || '' }));
          }
        }
      } catch { /* missing reports are reported below */ }
      cleanup();
      // On an unknown class or method the launcher prints its whole help text; drop it.
      output = output.replace(/\r?\n\r?\nUsage: junit [\s\S]*$/, '\n');
      // Each engine writes its report when it is done, so a missing one means the run broke off.
      const complete = ['TEST-junit-jupiter.xml', 'TEST-junit-vintage.xml'].every((n) => files.includes(n));
      let error = null;
      if (timedOut) error = { code: 'timeout', message: 'Tests stopped after ' + TIMEOUT_MS / 1000 + ' s' };
      else if (!complete || (code !== 0 && code !== 1)) {
        const reason = output.match(/PreconditionViolationException: (.*)/);
        error = reason
          ? { code: 'launcher', message: reason[1].trim() }
          : { code: 'exited', message: 'JUnit stopped early with exit code ' + code + ' (System.exit() in a test?)' };
      }
      finish(tests, output, error);
    });
  });
}

// ---------------------------------------------------------------------------------------

const TEMPLATE_TEXT = {
  de: {
    about: (c) => `Testklasse für ${c}.\n * Jede Methode mit @Test ist ein eigener Test.`,
    field: 'Das Objekt, das getestet wird. setUp() erzeugt es vor jedem Test neu.',
    setUp: 'Läuft vor jedem einzelnen Test, damit jeder Test frisch anfängt.',
    create: 'Erzeuge hier das Objekt, zum Beispiel:',
    createAny: 'Erzeuge hier die Objekte, die jeder Test braucht.',
    test: 'Ein Beispieltest. Ersetze ihn durch deine eigenen Tests.\n     * assertEquals(erwartet, tatsächlich) prüft, ob beide Werte gleich sind.',
    method: 'testBeispiel',
  },
  en: {
    about: (c) => `Test class for ${c}.\n * Every method marked @Test is a test of its own.`,
    field: 'The object under test. setUp() creates it fresh before every test.',
    setUp: 'Runs before every single test, so each test starts fresh.',
    create: 'Create the object here, for example:',
    createAny: 'Create the objects here that every test needs.',
    test: 'An example test. Replace it with your own tests.\n     * assertEquals(expected, actual) checks that both values are equal.',
    method: 'testExample',
  },
};

/** Source of a new JUnit 5 test class. className may include a package ("bank.KontoTest"). */
function testTemplate({ className, testedClass, lang = 'de' }) {
  const t = TEMPLATE_TEXT[lang] || TEMPLATE_TEXT.de;
  const split = (q) => { const i = String(q || '').lastIndexOf('.'); return i < 0 ? ['', String(q || '')] : [q.slice(0, i), q.slice(i + 1)]; };
  const [pkg, name] = split(className);
  const [testedPkg, tested] = split(testedClass);
  const imports = ['import static org.junit.jupiter.api.Assertions.*;', ''];
  if (tested && testedPkg && testedPkg !== pkg) imports.push(`import ${testedClass};`);
  imports.push('import org.junit.jupiter.api.BeforeEach;', 'import org.junit.jupiter.api.Test;');
  const variable = tested ? tested[0].toLowerCase() + tested.slice(1) : '';
  const field = tested ? `    // ${t.field}\n    private ${tested} ${variable};\n\n` : '';
  const create = tested ? `        // ${t.create}\n        // ${variable} = new ${tested}();\n` : `        // ${t.createAny}\n`;
  return `${pkg ? `package ${pkg};\n\n` : ''}${imports.join('\n')}

/**
 * ${t.about(tested || name.replace(/Tests?$/, '') || name)}
 */
public class ${name} {
${field}    /**
     * ${t.setUp}
     */
    @BeforeEach
    public void setUp() {
${create}    }

    /**
     * ${t.test}
     */
    @Test
    public void ${t.method}() {
        assertEquals(2, 1 + 1);
    }
}
`;
}

module.exports = { junitJars, isTestSource, runTests, testTemplate };
