// Every exercise in resources/exercises: the starter compiles, its tests fail, and the reference
// solution (scripts/exercise-solutions.cjs) makes all of them pass.
// Run with: node scripts/test-exercises.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { findJdks } = require('../electron/jdk.cjs');
const { compile } = require('../electron/compiler.cjs');
const { junitJars, runTests } = require('../electron/tests.cjs');
const solutions = require('./exercise-solutions.cjs');

const root = path.join(__dirname, '..');
const resDir = path.join(root, 'resources');
const exDir = path.join(resDir, 'exercises');
const tmp = path.join(root, '.cache', 'exercise-test-' + Date.now());
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

async function build(dir, out) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.java')).map((f) => path.join(dir, f));
  const r = await compile({ jdk, projectDir: dir, outDir: out, files, classpath: junitJars(resDir) });
  assert.ok(r.ok, r.output);
}

(async () => {
  const ids = fs.readdirSync(exDir).filter((d) => fs.statSync(path.join(exDir, d)).isDirectory()).sort();
  assert.ok(ids.length >= 6, 'exercises found: ' + ids.join(', '));
  for (const id of ids) {
    await check(id + ': starter fails, solution passes', async () => {
      const readme = fs.readFileSync(path.join(exDir, id, 'README.TXT'), 'utf8');
      assert.ok(/^Übung \d+: /.test(readme), 'README starts with "Übung n: title"');
      assert.ok(solutions[id], 'reference solution exists');
      const dir = path.join(tmp, id);
      fs.cpSync(path.join(exDir, id), dir, { recursive: true });
      await build(dir, path.join(tmp, id + '-out'));
      const before = await runTests({ jdk, resDir, classDir: path.join(tmp, id + '-out'), cwd: dir, select: { all: true } });
      assert.ok(before.summary.total >= 3, 'at least three tests');
      assert.ok(before.summary.failed + before.summary.errors > 0, 'the starter does not pass yet');
      for (const [file, content] of Object.entries(solutions[id])) fs.writeFileSync(path.join(dir, file), content);
      await build(dir, path.join(tmp, id + '-solved'));
      const after = await runTests({ jdk, resDir, classDir: path.join(tmp, id + '-solved'), cwd: dir, select: { all: true } });
      assert.strictEqual(after.summary.passed, after.summary.total, JSON.stringify(after.tests.filter((t) => t.status !== 'passed')));
    });
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch { /* leave it */ }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
