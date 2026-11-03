// End-to-end check of JUnit support: compiles a tiny project with JUnit 4 and 5 tests
// and runs them through electron/tests.cjs. Needs the jars from scripts/fetch-junit.cjs.
// Run with: node scripts/test-junit.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { findJdks } = require('../electron/jdk.cjs');
const { junitJars, isTestSource, runTests, testTemplate } = require('../electron/tests.cjs');

const resDir = path.join(__dirname, '..', 'resources');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blackj-junit-test-'));
const src = path.join(tmp, 'src');
const classDir = path.join(tmp, 'classes');
const jdk = findJdks()[0];
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log('  ok   ' + name);
  } catch (err) {
    failures++;
    console.log('  FAIL ' + name + '\n       ' + (err && err.stack || err));
  }
}

const SOURCES = {
  'Konto.java': `public class Konto {
    private int kontostand;

    public void einzahlen(int betrag) {
        kontostand = kontostand + betrag;
    }

    public void abheben(int betrag) {
        kontostand = kontostand - betrag;
    }

    public int getKontostand() {
        return kontostand;
    }
}
`,
  'KontoTest.java': `import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

public class KontoTest {
    private Konto konto;

    @BeforeEach
    public void setUp() {
        konto = new Konto();
    }

    @Test
    public void testEinzahlen() {
        konto.einzahlen(5);
        assertEquals(5, konto.getKontostand());
    }

    @Test
    public void testAbheben() {
        konto.einzahlen(10);
        konto.abheben(6);
        assertEquals(5, konto.getKontostand(), "nach dem Abheben");
    }
}
`,
  'Konto4Test.java': `import static org.junit.Assert.*;

import org.junit.Before;
import org.junit.Test;

public class Konto4Test {
    private Konto konto;

    @Before
    public void setUp() {
        konto = new Konto();
    }

    @Test
    public void testAbheben() {
        konto.einzahlen(10);
        konto.abheben(4);
        assertEquals(6, konto.getKontostand());
    }
}
`,
};

/** Compiles the given files with javac, JUnit on the classpath. Returns javac's output. */
function javac(files) {
  const r = spawnSync(jdk.javac, ['-encoding', 'UTF-8', '-g', '-d', classDir, '-cp', [classDir, ...junitJars(resDir)].join(path.delimiter), ...files], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
}

const byName = (r) => Object.fromEntries(r.tests.map((t) => [t.className + '#' + t.name, t]));

(async () => {
  console.log('JDK ' + jdk.version + ' at ' + jdk.home);
  fs.mkdirSync(src, { recursive: true });
  for (const [name, text] of Object.entries(SOURCES)) fs.writeFileSync(path.join(src, name), text);
  const failingLine = SOURCES['KontoTest.java'].split('\n').findIndex((l) => l.includes('"nach dem Abheben"')) + 1;

  await check('JUnit jars are there', async () => {
    const jars = junitJars(resDir);
    assert.strictEqual(jars.length, 3);
    for (const j of jars) assert.ok(path.isAbsolute(j) && fs.existsSync(j), j + ' (run node scripts/fetch-junit.cjs)');
  });

  await check('isTestSource tells test classes apart', async () => {
    assert.strictEqual(isTestSource(SOURCES['KontoTest.java']), true);
    assert.strictEqual(isTestSource(SOURCES['Konto4Test.java']), true);
    assert.strictEqual(isTestSource(SOURCES['Konto.java']), false);
    assert.strictEqual(isTestSource('public class A {\n    @Test void t() {}\n}'), true);
    assert.strictEqual(isTestSource('// import org.junit.Test;\npublic class B { }'), false);
  });

  await check('project with JUnit 4 and 5 tests compiles', async () => {
    javac(Object.keys(SOURCES).map((n) => path.join(src, n)));
    assert.ok(fs.existsSync(path.join(classDir, 'KontoTest.class')));
  });

  await check('run all tests', async () => {
    const r = await runTests({ jdk, resDir, classDir, cwd: src, select: { all: true } });
    assert.strictEqual(r.error, null, JSON.stringify(r.error) + '\n' + r.output);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual({ ...r.summary, ms: 0 }, { total: 3, passed: 2, failed: 1, errors: 0, skipped: 0, ms: 0 });
    const t = byName(r);
    assert.strictEqual(t['KontoTest#testEinzahlen'].status, 'passed');
    assert.strictEqual(t['Konto4Test#testAbheben'].status, 'passed');
    const bad = t['KontoTest#testAbheben'];
    assert.strictEqual(bad.status, 'failed');
    assert.strictEqual(bad.displayName, 'testAbheben()');
    assert.strictEqual(bad.message, 'nach dem Abheben ==> expected: <5> but was: <4>');
    assert.strictEqual(bad.expected, '5');
    assert.strictEqual(bad.actual, '4');
    assert.strictEqual(bad.file, 'KontoTest.java');
    assert.strictEqual(bad.line, failingLine);
    assert.ok(bad.trace.includes('KontoTest.testAbheben(KontoTest.java:' + failingLine + ')'), bad.trace);
    assert.ok(!bad.trace.includes('org.junit'), bad.trace);
    assert.ok(r.tests.every((x) => typeof x.ms === 'number' && x.ms >= 0));
    assert.ok(r.output.includes('testEinzahlen()'), r.output);
  });

  await check('run one class (JUnit 5)', async () => {
    const r = await runTests({ jdk, resDir, classDir, cwd: src, select: { className: 'KontoTest' } });
    assert.strictEqual(r.error, null, JSON.stringify(r.error));
    assert.deepStrictEqual([r.summary.total, r.summary.passed, r.summary.failed], [2, 1, 1]);
    assert.ok(r.tests.every((x) => x.className === 'KontoTest'));
  });

  await check('run one class (JUnit 4)', async () => {
    const r = await runTests({ jdk, resDir, classDir, cwd: src, select: { className: 'Konto4Test' } });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual([r.summary.total, r.summary.passed], [1, 1]);
    assert.strictEqual(r.tests[0].name, 'testAbheben');
  });

  await check('run one method', async () => {
    const r = await runTests({ jdk, resDir, classDir, cwd: src, select: { className: 'KontoTest', method: 'testEinzahlen' } });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.tests.length, 1);
    assert.strictEqual(r.tests[0].name, 'testEinzahlen');
    assert.strictEqual(r.tests[0].status, 'passed');
    const bad = await runTests({ jdk, resDir, classDir, cwd: src, select: { className: 'KontoTest', method: 'testAbheben' } });
    assert.strictEqual(bad.tests.length, 1);
    assert.strictEqual(bad.tests[0].line, failingLine);
  });

  await check('unknown class is reported, not thrown', async () => {
    const r = await runTests({ jdk, resDir, classDir, cwd: src, select: { className: 'GibtsNicht' } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, 'launcher');
    assert.ok(r.error.message.includes('GibtsNicht'), r.error.message);
  });

  await check('testTemplate compiles and runs (German, default package)', async () => {
    const text = testTemplate({ className: 'KontoVorlageTest', testedClass: 'Konto', lang: 'de' });
    assert.ok(text.includes('Testklasse für Konto'), text);
    assert.ok(text.includes('@BeforeEach') && text.includes('assertEquals') && !text.includes('package '), text);
    assert.strictEqual(isTestSource(text), true);
    fs.writeFileSync(path.join(src, 'KontoVorlageTest.java'), text);
    javac([path.join(src, 'KontoVorlageTest.java')]);
    const r = await runTests({ jdk, resDir, classDir, cwd: src, select: { className: 'KontoVorlageTest' } });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.summary.passed, 1);
  });

  await check('testTemplate compiles (English, in a package)', async () => {
    const bank = path.join(src, 'bank');
    fs.mkdirSync(bank);
    fs.writeFileSync(path.join(bank, 'Sparbuch.java'), 'package bank;\n\npublic class Sparbuch {\n    public Sparbuch(String inhaber) { }\n}\n');
    const text = testTemplate({ className: 'bank.SparbuchTest', testedClass: 'bank.Sparbuch', lang: 'en' });
    assert.ok(text.startsWith('package bank;') && text.includes('Test class for Sparbuch') && text.includes('public class SparbuchTest'), text);
    fs.writeFileSync(path.join(bank, 'SparbuchTest.java'), text);
    javac([path.join(bank, 'Sparbuch.java'), path.join(bank, 'SparbuchTest.java')]);
    assert.ok(fs.existsSync(path.join(classDir, 'bank', 'SparbuchTest.class')));
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
