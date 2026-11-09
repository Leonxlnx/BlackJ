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

  await check('a folder outside the ANSI code page and umlauts in file names compile, errors arrive intact', async () => {
    const dir = path.join(tmp, 'Проект Тест');
    fs.mkdirSync(path.join(dir, 'tiere'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Haupt.java'), 'public class Haupt { String s = new tiere.Bär().name(); }\n');
    fs.writeFileSync(path.join(dir, 'tiere', 'Bär.java'), 'package tiere;\npublic class Bär { public String name() { return "Größe"; } }\n');
    const files = [path.join(dir, 'Haupt.java'), path.join(dir, 'tiere', 'Bär.java')];
    const outCyr = path.join(dir, 'out');
    const r = await compile({ jdk, projectDir: dir, outDir: outCyr, files });
    assert.ok(r.ok, r.output);
    assert.ok(fs.existsSync(path.join(outCyr, 'tiere', 'Bär.class')));
    fs.writeFileSync(path.join(dir, 'tiere', 'Bär.java'), 'package tiere;\npublic class Bär { String größe = }\n');
    const bad = await compile({ jdk, projectDir: dir, outDir: outCyr, files });
    assert.strictEqual(bad.ok, false);
    assert.deepStrictEqual(bad.problems.map((p) => [p.file, p.line, p.source.trim()]), [['tiere/Bär.java', 2, 'public class Bär { String größe = }']], bad.output);
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
    assert.strictEqual(info.systemExit, true, 'System.exit is told apart from a crash');
  });

  // ---------------------------------------------------------------- starting reliably

  const benchDir = path.join(root, 'resources', 'bench');
  const progDir = path.join(tmp, 'prog');
  const progOut = path.join(tmp, 'prog-out');
  fs.mkdirSync(progDir);
  const progs = {
    'Roh.java': 'import java.io.*;\npublic class Roh {\n    public static void main(String[] a) throws Exception {\n        FileOutputStream raw = new FileOutputStream(FileDescriptor.out);\n        raw.write("ohne Umbruch".getBytes("UTF-8"));\n        raw.flush();\n        System.out.println("danach");\n        System.err.println("fehler");\n        System.out.println("zuletzt");\n    }\n}\n',
    'Faden.java': 'public class Faden {\n    public static void main(String[] a) {\n        new Thread(() -> {\n            try { Thread.sleep(700); } catch (InterruptedException e) { }\n            System.out.println("Faden fertig");\n        }).start();\n    }\n}\n',
    'Viel.java': 'public class Viel {\n    public static void main(String[] a) {\n        for (int i = 0; i < 100000; i++) System.out.println("Zeile " + i);\n    }\n}\n',
    // pack(), then a place of its own (stands in for setLocationRelativeTo(null), but is off the
    // screen too, so no test window ever shows), then setVisible(true).
    'Mitte.java': [
      'import javax.swing.*;',
      'import java.awt.event.*;',
      '',
      'public class Mitte {',
      '    public static void main(String[] args) {',
      '        SwingUtilities.invokeLater(() -> {',
      '            JFrame f = new JFrame("Mitte");',
      '            f.add(new JLabel("mitte"));',
      '            f.pack();',
      '            String nachPack = f.getX() + "," + f.getY();',
      '            f.setLocation(-2500, -2500);',
      '            f.addWindowListener(new WindowAdapter() {',
      '                @Override public void windowOpened(WindowEvent e) {',
      '                    java.awt.Point p = f.getLocationOnScreen();',
      '                    System.out.println("geoeffnet " + p.x + "," + p.y);',
      '                }',
      '            });',
      '            f.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);',
      '            f.setVisible(true);',
      '            System.out.println("pack " + nachPack + " show " + f.getX() + "," + f.getY() + " fokus " + f.isAutoRequestFocus() + " typ " + f.getType());',
      '        });',
      '    }',
      '}',
      '',
    ].join('\n'),
    'Fenster.java': [
      'import javax.swing.*;',
      'import java.awt.*;',
      'import java.awt.event.*;',
      '',
      'public class Fenster {',
      '    static volatile int taste = -1;',
      '    static volatile int klicks = 0;',
      '    static volatile String getippt = "";',
      '',
      '    public static void main(String[] args) {',
      '        SwingUtilities.invokeLater(() -> {',
      '            JFrame f = new JFrame("Testfenster");',
      '            JPanel p = new JPanel() {',
      '                @Override protected void paintComponent(Graphics g) {',
      '                    super.paintComponent(g);',
      '                    g.setColor(Color.RED);',
      '                    g.fillRect(10, 10, 50, 30);',
      '                }',
      '            };',
      '            p.setPreferredSize(new Dimension(320, 200));',
      '            p.setBackground(Color.WHITE);',
      '            p.setFocusable(true);',
      '            p.addKeyListener(new KeyAdapter() {',
      '                @Override public void keyPressed(KeyEvent e) { taste = e.getKeyCode(); System.out.println("taste " + e.getKeyCode()); }',
      '                @Override public void keyTyped(KeyEvent e) { getippt += e.getKeyChar(); }',
      '            });',
      '            p.addMouseListener(new MouseAdapter() {',
      '                @Override public void mouseClicked(MouseEvent e) { klicks++; System.out.println("klick " + e.getX() + "," + e.getY()); }',
      '            });',
      '            f.setContentPane(p);',
      '            f.pack();',
      '            f.setLocation(-4000, -4000);',
      '            f.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);',
      '            f.setVisible(true);',
      '            p.requestFocusInWindow();',
      '        });',
      '    }',
      '',
      '    public static int getTaste() { return taste; }',
      '    public static int getKlicks() { return klicks; }',
      '    public static String getGetippt() { return getippt; }',
      '}',
      '',
    ].join('\n'),
  };
  for (const [f, text] of Object.entries(progs)) fs.writeFileSync(path.join(progDir, f), text);

  await check('test programs compile', async () => {
    const r = await compile({ jdk, projectDir: progDir, outDir: progOut, files: Object.keys(progs).map((f) => path.join(progDir, f)) });
    assert.ok(r.ok, r.output);
  });

  await check('a JVM that cannot start says why (no raw exit code)', async () => {
    const b = new Bench();
    let retried = 0;
    b.on('retry', () => { retried++; });
    try {
      await b.start({ jdk, benchDir: path.join(tmp, 'gibts-nicht'), classDir: progOut, cwd: progDir });
      assert.fail('should not start');
    } catch (err) {
      assert.strictEqual(err.reason && err.reason.code, 'benchMissing', JSON.stringify(err.reason));
      assert.ok(retried >= 1, 'tried again');
    }
    b.stop();
  });

  await check('a newer start replaces one in progress; stop ends a start', async () => {
    const b = new Bench();
    const first = b.start({ jdk, benchDir, classDir: progOut, cwd: progDir, debug: true });
    const second = b.start({ jdk, benchDir, classDir: progOut, cwd: progDir, debug: true });
    await assert.rejects(first, (err) => err.superseded === true);
    const ready = await second;
    assert.ok(ready.java);
    assert.ok(b.jdwpPort > 0, 'the debug agent announced its port');
    assert.strictEqual(await b.request('ping'), 'pong');
    const third = b.start({ jdk, benchDir, classDir: progOut, cwd: progDir });
    b.stop();
    await assert.rejects(third, (err) => err.superseded === true);
    assert.strictEqual(b.alive, false);
  });

  const b2 = new Bench();
  const out2 = [];
  const events2 = [];
  b2.on('out', (m) => out2.push(m));
  for (const ev of ['running', 'program', 'window']) b2.on(ev, (m) => events2.push(m));
  const text2 = () => out2.map((m) => m.text).join('');

  await check('text written straight to stdout cannot break the protocol', async () => {
    await b2.start({ jdk, benchDir, classDir: progOut, cwd: progDir });
    await b2.request('main', { className: 'Roh' });
    assert.strictEqual(await b2.request('ping'), 'pong');
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(text2().includes('ohne Umbruch'), text2());
    // System.out and System.err keep their order.
    const order = out2.filter((m) => m.text.trim()).map((m) => m.stream + ':' + m.text.trim().split('\n').join('|'));
    const i = order.findIndex((x) => x.includes('danach'));
    assert.ok(i >= 0 && order[i + 1] === 'err:fehler' && order[i + 2].includes('zuletzt'), JSON.stringify(order));
  });

  await check('a program whose thread runs on is reported as running, then ended', async () => {
    events2.length = 0;
    await b2.request('main', { className: 'Faden' });
    const idle = events2.filter((e) => e.event === 'running' && !e.running).pop();
    assert.ok(idle, 'end of the call');
    assert.strictEqual(idle.threads, 1, JSON.stringify(idle));
    for (let i = 0; i < 60 && !events2.some((e) => e.event === 'program' && e.threads === 0); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(events2.some((e) => e.event === 'program' && e.threads === 0), JSON.stringify(events2));
    assert.ok(text2().includes('Faden fertig'));
  });

  await check('100 000 printed lines arrive quickly and complete', async () => {
    out2.length = 0;
    const t0 = Date.now();
    await b2.request('main', { className: 'Viel' });
    await new Promise((r) => setTimeout(r, 200));
    const ms = Date.now() - t0;
    const all = text2().replace(/\r\n/g, '\n');
    assert.ok(all.includes('Zeile 0\n') && all.includes('Zeile 99999\n'), 'first and last line');
    assert.strictEqual(all.split('\n').filter((l) => l.startsWith('Zeile ')).length, 100000);
    assert.ok(ms < 8000, 'took ' + ms + ' ms');
    // Batched: far fewer messages than lines.
    assert.ok(out2.length < 2000, out2.length + ' out events');
  });

  // ---------------------------------------------------------------- the program's windows (off-screen)

  let shot = null;
  await check('a window program: running state lives on, the window is listed', async () => {
    assert.deepStrictEqual(await b2.request('windows'), { windows: [] });
    await b2.request('offscreen', { on: true });
    events2.length = 0;
    await b2.request('main', { className: 'Fenster' });
    const idle = events2.filter((e) => e.event === 'running' && !e.running).pop();
    assert.ok(idle && idle.windows.length === 1, 'main returned with its window open: ' + JSON.stringify(idle));
    assert.strictEqual(idle.windows[0].title, 'Testfenster');
    const w = await b2.request('windows');
    assert.strictEqual(w.windows.length, 1);
    assert.deepStrictEqual({ title: w.windows[0].title, width: w.windows[0].width, height: w.windows[0].height }, { title: 'Testfenster', width: 320, height: 200 });
    assert.ok(Number.isInteger(w.windows[0].id));
    assert.strictEqual(typeof w.windows[0].focused, 'boolean');
  });

  await check('capture renders the window off-screen into a PNG', async () => {
    shot = await b2.request('capture', {});
    assert.strictEqual(shot.title, 'Testfenster');
    assert.strictEqual(shot.width, 320);
    assert.strictEqual(shot.height, 200);
    const png = Buffer.from(shot.png, 'base64');
    assert.deepStrictEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
    assert.strictEqual(png.readUInt32BE(16), 320, 'IHDR width');
    assert.strictEqual(png.readUInt32BE(20), 200, 'IHDR height');
    const small = await b2.request('capture', { window: shot.id, maxWidth: 160 });
    const sp = Buffer.from(small.png, 'base64');
    assert.strictEqual(sp.readUInt32BE(16), 160);
    assert.strictEqual(sp.readUInt32BE(20), 100);
    assert.strictEqual(small.width, 320, 'coordinates stay at scale 1');
  });

  await check('a key reaches the KeyListener, typed text too', async () => {
    const r = await b2.request('input', { events: [{ type: 'key', key: 'LEFT' }] });
    assert.strictEqual(r.delivered, 1);
    const k = await b2.request('call', { className: 'Fenster', key: 'getTaste()', args: [] });
    assert.strictEqual(k.value.text, '37', 'VK_LEFT');
    await b2.request('input', { events: [{ type: 'key', key: 'W', action: 'press', holdMs: 40 }, { type: 'type', text: 'hi' }, { type: 'wait', ms: 20 }] });
    const typed = await b2.request('call', { className: 'Fenster', key: 'getGetippt()', args: [] });
    assert.strictEqual(typed.value.text, 'whi');
    await assert.rejects(b2.request('input', { events: [{ type: 'key', key: 'GIBTSNICHT' }] }), (err) => err.bench && err.bench.code === 'badKey');
  });

  await check('a click reaches the MouseListener at window content coordinates', async () => {
    const r = await b2.request('input', { window: shot.id, events: [{ type: 'click', x: 100, y: 60 }] });
    assert.strictEqual(r.delivered, 1);
    const n = await b2.request('call', { className: 'Fenster', key: 'getKlicks()', args: [] });
    assert.strictEqual(n.value.text, '1');
    await new Promise((res) => setTimeout(res, 150));
    assert.ok(text2().includes('klick 100,60'), text2().slice(-200));
  });

  await check('closeWindows closes the window and the program ends', async () => {
    events2.length = 0;
    const r = await b2.request('closeWindows');
    assert.strictEqual(r.closed, 1);
    assert.deepStrictEqual((await b2.request('windows')).windows, []);
    for (let i = 0; i < 40 && !events2.some((e) => e.event === 'program' && !e.windows.length); i++) await new Promise((res) => setTimeout(res, 50));
    assert.ok(events2.some((e) => e.event === 'program' && e.windows.length === 0 && e.threads === 0), JSON.stringify(events2));
    await assert.rejects(b2.request('capture', {}), (err) => err.bench && err.bench.code === 'noWindow');
  });

  await check('out of sight: a window the program places after pack() is moved away before it shows', async () => {
    out2.length = 0;
    await b2.request('main', { className: 'Mitte' });
    for (let i = 0; i < 60 && !text2().includes('geoeffnet'); i++) await new Promise((res) => setTimeout(res, 50));
    const t = text2().replace(/\r\n/g, '\n');
    assert.ok(t.includes('pack -4000,-4000 show -4000,-4000 fokus false typ UTILITY'), t);
    assert.ok(t.includes('geoeffnet -4000,-4000'), t);
    assert.strictEqual((await b2.request('closeWindows')).closed, 1);
  });

  b2.stop();
  bench.stop();
  // The JVMs end a moment after the kill; until then Windows keeps their working folders busy.
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
  } catch { /* the temp folder goes later */ }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
