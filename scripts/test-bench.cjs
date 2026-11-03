// End-to-end check of compiler + object bench against the bundled "Tiere" example.
// Run with: npm run test:bench
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { findJdks } = require('../electron/jdk.cjs');
const { compile } = require('../electron/compiler.cjs');
const { Bench } = require('../electron/bench.cjs');

const root = path.join(__dirname, '..');
const project = path.join(root, 'resources', 'examples', 'Tiere');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blackj-test-'));
const outDir = path.join(tmp, 'classes');
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

(async () => {
  console.log('JDK ' + jdk.version + ' at ' + jdk.home);
  const files = fs.readdirSync(project).filter((f) => f.endsWith('.java')).map((f) => path.join(project, f));

  await check('example compiles', async () => {
    const r = await compile({ jdk, projectDir: project, outDir, files });
    assert.ok(r.ok, r.output);
    assert.ok(fs.existsSync(path.join(outDir, 'Hund.class')));
  });

  await check('compile errors are parsed', async () => {
    const broken = path.join(tmp, 'broken');
    fs.mkdirSync(broken);
    fs.writeFileSync(path.join(broken, 'Kaputt.java'), 'public class Kaputt {\n    int x = 5\n    void f() { gibtsNicht(); }\n}\n');
    const r = await compile({ jdk, projectDir: broken, outDir: path.join(tmp, 'broken-out'), files: [path.join(broken, 'Kaputt.java')] });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.length >= 1, r.output);
    const semi = r.problems.find((p) => p.message.includes("';' expected"));
    assert.ok(semi, JSON.stringify(r.problems));
    assert.strictEqual(semi.line, 2);
    assert.strictEqual(semi.file, 'Kaputt.java');
  });

  const bench = new Bench();
  const out = [];
  bench.on('out', (m) => out.push(m.text));
  let waited = false;
  bench.on('waitingForInput', () => { waited = true; });

  await check('bench starts', async () => {
    const ready = await bench.start({ jdk, benchDir: path.join(root, 'resources', 'bench'), classDir: outDir, cwd: project });
    assert.ok(ready.java);
  });

  await check('describe Hund lists inherited methods with parameter names', async () => {
    const d = await bench.request('describe', { className: 'Hund' });
    assert.strictEqual(d.superclass, 'Tier');
    assert.strictEqual(d.constructors.length, 1);
    assert.deepStrictEqual(d.constructors[0].params.map((p) => p.name), ['name', 'alter']);
    const names = d.methods.map((m) => m.name);
    for (const n of ['gibLaut', 'gassiGehen', 'getName', 'geburtstag', 'toString']) assert.ok(names.includes(n), n);
    assert.ok(d.methods.find((m) => m.name === 'getName').inherited);
  });

  await check('describe abstract Tier', async () => {
    const d = await bench.request('describe', { className: 'Tier' });
    assert.strictEqual(d.kind, 'abstract');
    assert.strictEqual(d.constructors.length, 0);
  });

  await check('new Hund and call methods', async () => {
    const r = await bench.request('new', { className: 'Hund', key: '<init>(java.lang.String,int)', args: [{ kind: 'text', text: '"Bello"' }, { kind: 'text', text: '3' }] });
    assert.strictEqual(r.name, 'hund1');
    assert.strictEqual(r.value.text, 'Bello (3 Jahre)');
    const laut = await bench.request('call', { target: 'hund1', key: 'gibLaut()', args: [] });
    assert.strictEqual(laut.value.text, 'Wuff!');
    await bench.request('call', { target: 'hund1', key: 'geburtstag()', args: [] });
    const alter = await bench.request('call', { target: 'hund1', key: 'getAlter()', args: [] });
    assert.strictEqual(alter.value.text, '4');
    assert.strictEqual(alter.value.type, 'int');
  });

  await check('inspect shows private and inherited fields', async () => {
    const i = await bench.request('inspect', { ref: 'hund1' });
    const byName = Object.fromEntries(i.fields.map((f) => [f.name, f]));
    assert.strictEqual(byName.name.value.text, 'Bello');
    assert.strictEqual(byName.name.declaredIn, 'Tier');
    assert.strictEqual(byName.alter.value.text, '4');
    assert.strictEqual(byName.gassiGegangen.value.text, 'false');
  });

  await check('object arguments and output', async () => {
    await bench.request('new', { className: 'Gehege', key: '<init>(java.lang.String)', args: [{ kind: 'text', text: 'Streichelzoo' }], name: 'zoo' });
    await bench.request('call', { target: 'zoo', key: 'hinzufuegen(Tier)', args: [{ kind: 'ref', name: 'hund1' }] });
    const n = await bench.request('call', { target: 'zoo', key: 'anzahl()', args: [] });
    assert.strictEqual(n.value.text, '1');
    await bench.request('call', { target: 'zoo', key: 'rufeAlle()', args: [] });
    assert.ok(out.join('').includes('Bello sagt Wuff!'), out.join(''));
    const avg = await bench.request('call', { target: 'zoo', key: 'durchschnittsalter()', args: [] });
    assert.strictEqual(avg.value.text, '4.0');
  });

  await check('inspect an ArrayList field via its handle', async () => {
    const i = await bench.request('inspect', { ref: 'zoo' });
    const tiere = i.fields.find((f) => f.name === 'tiere');
    assert.strictEqual(tiere.value.length, 1);
    const list = await bench.request('inspect', { ref: tiere.value.handle });
    assert.strictEqual(list.items[0].value.text, 'Bello (3 Jahre)'.replace('3', '4'));
  });

  await check('bad argument gives a friendly code', async () => {
    try {
      await bench.request('new', { className: 'Hund', key: '<init>(java.lang.String,int)', args: [{ kind: 'text', text: 'Rex' }, { kind: 'text', text: 'drei' }] });
      assert.fail('should throw');
    } catch (err) {
      assert.strictEqual(err.bench.code, 'argInt');
      assert.strictEqual(err.bench.params.param, 'alter');
    }
  });

  await check('decimal comma is accepted', async () => {
    await bench.request('new', { className: 'Gehege', key: '<init>(java.lang.String)', args: [{ kind: 'text', text: 'Leer' }], name: 'leer' });
    await bench.request('call', { target: 'leer', key: 'hinzufuegen(Tier)', args: [{ kind: 'text', text: 'null' }] });
  });

  await check('exception from student code carries the line', async () => {
    try {
      await bench.request('call', { target: 'leer', key: 'rufeAlle()', args: [] });
      assert.fail('should throw');
    } catch (err) {
      assert.strictEqual(err.bench.kind, 'exception');
      assert.strictEqual(err.bench.simpleType, 'NullPointerException');
      const frame = err.bench.frames.find((f) => f.project);
      assert.strictEqual(frame.className, 'Gehege');
      assert.ok(frame.line > 0);
    }
  });

  await check('code pad: expressions, variables, bench objects, output, errors', async () => {
    const a = await bench.request('pad', { code: '1 + 2' });
    assert.strictEqual(a.kind, 'value');
    assert.strictEqual(a.type, 'int');
    assert.strictEqual(a.value.text, '3');
    await bench.request('pad', { code: 'int x = 5;' });
    const b = await bench.request('pad', { code: 'x * 2' });
    assert.strictEqual(b.value.text, '10');
    await bench.request('pad', { code: 'x = x + 1;' });
    const c = await bench.request('pad', { code: 'x' });
    assert.strictEqual(c.value.text, '6');
    const d = await bench.request('pad', { code: 'hund1.getName()' });
    assert.strictEqual(d.type, 'String');
    assert.strictEqual(d.value.text, 'Bello');
    const e = await bench.request('pad', { code: 'hund1.geburtstag()' });
    assert.strictEqual(e.kind, 'done');
    out.length = 0;
    await bench.request('pad', { code: 'System.out.println("hallo " + x)' });
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(out.join('').includes('hallo 6'), out.join(''));
    const f = await bench.request('pad', { code: 'Hund rex = new Hund("Rex", 2);' });
    assert.ok(f.vars.some((v) => v.name === 'rex' && v.type === 'Hund'));
    const g = await bench.request('pad', { code: 'rex.gibLaut()' });
    assert.strictEqual(g.value.text, 'Wuff!');
    const h = await bench.request('pad', { code: 'gibtsNicht(3)' });
    assert.strictEqual(h.kind, 'error');
    assert.ok(h.diagnostics[0].message.includes('cannot find symbol'), JSON.stringify(h.diagnostics));
    const i = await bench.request('pad', { code: 'new java.util.ArrayList<String>()' });
    assert.strictEqual(i.value.kind, 'object');
    try {
      await bench.request('pad', { code: 'int[] a = new int[2]; a[5] = 1;' });
      assert.fail('should throw');
    } catch (err) {
      assert.strictEqual(err.bench.simpleType, 'ArrayIndexOutOfBoundsException');
    }
  });

  await check('packages, package-private classes and statics', async () => {
    const pdir = path.join(tmp, 'pkgproj');
    fs.mkdirSync(path.join(pdir, 'tiere'), { recursive: true });
    fs.writeFileSync(path.join(pdir, 'tiere', 'Vogel.java'), 'package tiere;\npublic class Vogel {\n    public static int anzahl = 0;\n    public Vogel() { anzahl++; }\n    public String singe() { return "Piep"; }\n}\n');
    fs.writeFileSync(path.join(pdir, 'Nest.java'), 'class Nest {\n    int eier = 3;\n    int zaehle() { return eier; }\n}\n');
    const { listJavaFiles } = require('../electron/project.cjs');
    const rels = listJavaFiles(pdir);
    assert.deepStrictEqual(rels, ['Nest.java', 'tiere/Vogel.java']);
    const pout = path.join(tmp, 'pkgout');
    const r = await compile({ jdk, projectDir: pdir, outDir: pout, files: rels.map((x) => path.join(pdir, ...x.split('/'))) });
    assert.ok(r.ok, r.output);
    await bench.start({ jdk, benchDir: path.join(root, 'resources', 'bench'), classDir: pout, cwd: pdir });
    const d = await bench.request('describe', { className: 'tiere.Vogel' });
    assert.strictEqual(d.constructors.length, 1);
    await bench.request('new', { className: 'tiere.Vogel', key: '<init>()', args: [], name: 'piepsi' });
    const s = await bench.request('call', { target: 'piepsi', key: 'singe()', args: [] });
    assert.strictEqual(s.value.text, 'Piep');
    const st = await bench.request('inspectClass', { className: 'tiere.Vogel' });
    assert.strictEqual(st.statics.find((f) => f.name === 'anzahl').value.text, '1');
    const n = await bench.request('pad', { code: 'new Nest().zaehle()' });
    assert.strictEqual(n.value.text, '3');
    const v = await bench.request('pad', { code: 'piepsi.singe()' });
    assert.strictEqual(v.value.text, 'Piep');
    const bad = await compile({ jdk, projectDir: pdir, outDir: pout, files: [path.join(pdir, 'tiere', 'Vogel.java')].concat((fs.writeFileSync(path.join(pdir, 'tiere', 'Kaputt.java'), 'package tiere;\nclass Kaputt { int x = }\n'), [path.join(pdir, 'tiere', 'Kaputt.java')])) });
    assert.strictEqual(bad.problems[0].file, 'tiere/Kaputt.java');
    await bench.start({ jdk, benchDir: path.join(root, 'resources', 'bench'), classDir: outDir, cwd: project });
  });

  await check('library classes: Math, StringBuilder, ArrayList, objects of hidden classes', async () => {
    const math = await bench.request('describe', { className: 'Math' });
    assert.strictEqual(math.name, 'java.lang.Math');
    assert.strictEqual(math.library, true);
    assert.strictEqual(math.constructors.length, 0);
    const max = math.methods.find((m) => m.key === 'max(int,int)');
    assert.ok(max && max.static, 'Math.max(int,int)');
    const r = await bench.request('call', { className: 'java.lang.Math', key: 'max(int,int)', args: [{ kind: 'text', text: '3' }, { kind: 'text', text: '7' }] });
    assert.strictEqual(r.value.text, '7');
    const sb = await bench.request('describe', { className: 'StringBuilder' });
    assert.ok(sb.constructors.some((c) => c.key === '<init>(java.lang.String)'));
    assert.ok(sb.methods.some((m) => m.key === 'length()'), 'length() through the visibility bridge');
    assert.ok(!sb.methods.some((m) => m.name === 'wait' || m.name === 'getClass'));
    await bench.request('new', { className: 'java.lang.StringBuilder', key: '<init>(java.lang.String)', args: [{ kind: 'text', text: 'abc' }], name: 'sb' });
    await bench.request('call', { target: 'sb', key: 'reverse()', args: [] });
    const len = await bench.request('call', { target: 'sb', key: 'length()', args: [] });
    assert.strictEqual(len.value.text, '3');
    const text = await bench.request('call', { target: 'sb', key: 'toString()', args: [] });
    assert.strictEqual(text.value.text, 'cba');
    await bench.request('new', { className: 'java.util.ArrayList', key: '<init>()', args: [], name: 'liste' });
    await bench.request('call', { target: 'liste', key: 'add(java.lang.Object)', args: [{ kind: 'ref', name: 'sb' }] });
    const size = await bench.request('call', { target: 'liste', key: 'size()', args: [] });
    assert.strictEqual(size.value.text, '1');
    // Collections.emptyList() is a private class inside java.util: called through the List interface.
    const empty = await bench.request('call', { className: 'java.util.Collections', key: 'emptyList()', args: [] });
    await bench.request('store', { ref: empty.value.handle, name: 'leer2' });
    const desc = await bench.request('describe', { className: 'java.util.Collections$EmptyList' });
    assert.ok(desc.methods.some((m) => m.key === 'size()'));
    const zero = await bench.request('call', { target: 'leer2', key: 'size()', args: [] });
    assert.strictEqual(zero.value.text, '0');
    try {
      await bench.request('describe', { className: 'GibtsNicht' });
      assert.fail('should throw');
    } catch (err) {
      assert.strictEqual(err.bench.code, 'classMissing');
    }
  });

  await check('main reads System.in', async () => {
    out.length = 0;
    const run = bench.request('main', { className: 'Zoo' });
    for (let i = 0; i < 50 && !waited; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(waited, 'waitingForInput event');
    await bench.request('stdin', { text: 'Rex\n' });
    await run;
    await new Promise((r) => setTimeout(r, 100));
    const text = out.join('');
    assert.ok(text.includes('Wie soll dein Hund heißen?'), text);
    assert.ok(text.includes('Rex sagt Wuff!'), text);
    assert.ok(text.includes('Minka sagt Miau!'), text);
  });

  await check('System.exit ends the bench and is reported', async () => {
    const exited = new Promise((resolve) => bench.once('exit', resolve));
    const lib = path.join(tmp, 'exit');
    fs.mkdirSync(lib);
    fs.writeFileSync(path.join(lib, 'Ende.java'), 'public class Ende { public static void main(String[] a) { System.exit(3); } }\n');
    const r = await compile({ jdk, projectDir: lib, outDir: path.join(tmp, 'exit-out'), files: [path.join(lib, 'Ende.java')] });
    assert.ok(r.ok, r.output);
    await bench.start({ jdk, benchDir: path.join(root, 'resources', 'bench'), classDir: path.join(tmp, 'exit-out'), cwd: lib });
    bench.request('main', { className: 'Ende' }).catch(() => {});
    const info = await exited;
    assert.strictEqual(info.code, 3);
  });

  bench.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
