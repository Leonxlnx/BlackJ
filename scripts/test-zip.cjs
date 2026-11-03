// Project archives: writing, reading, unpacking safely, finding the project folder inside.
// Run with: npm run test:zip
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const zip = require('../electron/zip.cjs');
const project = require('../electron/project.cjs');

const root = path.join(__dirname, '..');
const tmp = path.join(root, '.cache', 'zip-test-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (err) {
    failures++;
    console.log('  FAIL ' + name + '\n       ' + (err && err.stack || err));
  }
}

const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const hasTar = spawnSync(tar, ['--version']).status === 0;

check('crc32 matches the reference value', () => {
  assert.strictEqual(zip.crc32(Buffer.from('123456789')), 0xcbf43926);
});

check('write and read back, with umlauts and empty files', () => {
  const files = [
    { name: 'Projekt/Hund.java', data: 'public class Hund { String laut = "Wuff"; }\n'.repeat(40) },
    { name: 'Projekt/tiere/Größe.txt', data: 'groß und klein' },
    { name: 'Projekt/leer.txt', data: '' },
  ];
  const buf = zip.writeZip(files);
  const entries = zip.readZip(buf);
  assert.deepStrictEqual(entries.map((e) => e.name), files.map((f) => f.name));
  for (const [i, e] of entries.entries()) assert.strictEqual(e.data().toString('utf8'), files[i].data);
  fs.writeFileSync(path.join(tmp, 'ours.zip'), buf);
});

check('unpacking skips paths that leave the target folder', () => {
  const buf = zip.writeZip([
    { name: 'ok/A.java', data: 'class A {}' },
    { name: '../boese.txt', data: 'x' },
    { name: 'ok/../../auch-boese.txt', data: 'x' },
    { name: 'C:/Windows/boese.txt', data: 'x' },
    { name: '__MACOSX/ok/._A.java', data: 'x' },
  ]);
  const file = path.join(tmp, 'slip.zip');
  fs.writeFileSync(file, buf);
  const dest = path.join(tmp, 'slip');
  zip.extractZip(file, dest);
  assert.ok(fs.existsSync(path.join(dest, 'ok', 'A.java')));
  assert.ok(!fs.existsSync(path.join(tmp, 'boese.txt')));
  assert.ok(!fs.existsSync(path.join(tmp, 'auch-boese.txt')));
  assert.ok(!fs.existsSync(path.join(dest, '__MACOSX')));
});

check('broken and foreign files are refused with badZip', () => {
  assert.throws(() => zip.readZip(Buffer.from('not a zip at all, just text')), (e) => e.code === 'badZip');
  const buf = zip.writeZip([{ name: 'A.java', data: 'class A {}'.repeat(100) }]);
  buf[38] ^= 0xff;
  assert.throws(() => zip.readZip(buf)[0].data(), (e) => e.code === 'badZip' || /invalid|incorrect/i.test(e.message));
});

check('the project folder inside an archive is found', () => {
  const a = path.join(tmp, 'root-a');
  fs.mkdirSync(path.join(a, 'Aufgabe 3', 'Tiere'), { recursive: true });
  fs.writeFileSync(path.join(a, 'Aufgabe 3', 'Tiere', 'package.bluej'), '');
  fs.writeFileSync(path.join(a, 'Aufgabe 3', 'Tiere', 'Hund.java'), 'class Hund {}');
  assert.strictEqual(project.projectRoot(a), path.join(a, 'Aufgabe 3', 'Tiere'));
  const b = path.join(tmp, 'root-b');
  fs.mkdirSync(path.join(b, 'src'), { recursive: true });
  fs.writeFileSync(path.join(b, 'Main.java'), 'class Main {}');
  assert.strictEqual(project.projectRoot(b), b);
});

check('archives leave out compiled classes', () => {
  const src = path.join(root, 'resources', 'examples', 'Bibliothek');
  const copy = project.copyExample(src, path.join(tmp, 'copy'));
  fs.writeFileSync(path.join(copy, 'Bibliothek.class'), 'cafebabe');
  fs.writeFileSync(path.join(copy, 'Bibliothek.ctxt'), 'ctxt');
  const list = project.archiveFiles(copy);
  assert.ok(list.includes('Bibliothek.java'));
  assert.ok(list.includes('medien/Buch.java'));
  assert.ok(list.includes('README.TXT'));
  assert.ok(!list.some((f) => /\.(class|ctxt)$/.test(f)), list.join(', '));
});

check('add class from file fixes the package line', () => {
  const proj = path.join(tmp, 'add');
  fs.mkdirSync(proj, { recursive: true });
  const src = path.join(tmp, 'Vogel.java');
  fs.writeFileSync(src, '/* Kopf */\npackage alt.zoo;\n\nimport java.util.List;\n\npublic class Vogel {}\n');
  const a = project.addFile(proj, src, 'tiere');
  assert.strictEqual(a.name, 'tiere/Vogel.java');
  assert.strictEqual(a.className, 'tiere.Vogel');
  assert.ok(a.content.startsWith('/* Kopf */\npackage tiere;\n'), a.content);
  assert.ok(!a.content.includes('alt.zoo'));
  const b = project.addFile(proj, src, '');
  assert.ok(!/package/.test(b.content), b.content);
  assert.ok(b.content.includes('import java.util.List;'));
  fs.writeFileSync(path.join(tmp, 'Nest.java'), 'class Nest {}\n');
  const c = project.addFile(proj, path.join(tmp, 'Nest.java'), 'tiere.voegel');
  assert.strictEqual(c.content, 'package tiere.voegel;\n\nclass Nest {}\n');
  assert.throws(() => project.addFile(proj, src, 'tiere'), (e) => e.code === 'exists');
});

if (hasTar) {
  check('our archives open in tar, and tar archives open in BlackJ', () => {
    const listed = spawnSync(tar, ['-tf', path.join(tmp, 'ours.zip')], { encoding: 'utf8' });
    assert.strictEqual(listed.status, 0, listed.stderr);
    assert.ok(listed.stdout.includes('Projekt/Hund.java'), listed.stdout);
    const made = spawnSync(tar, ['-a', '-c', '-f', path.join(tmp, 'theirs.zip'), '-C', path.join(root, 'resources', 'examples'), 'Tiere'], { encoding: 'utf8' });
    assert.strictEqual(made.status, 0, made.stderr);
    const dest = path.join(tmp, 'theirs');
    zip.extractZip(path.join(tmp, 'theirs.zip'), dest);
    const proj = project.projectRoot(dest);
    assert.strictEqual(path.basename(proj), 'Tiere');
    const want = fs.readFileSync(path.join(root, 'resources', 'examples', 'Tiere', 'Hund.java'), 'utf8');
    assert.strictEqual(fs.readFileSync(path.join(proj, 'Hund.java'), 'utf8'), want);
  });
} else {
  console.log('  skip tar round trip (no tar)');
}

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch { /* leave it */ }
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
