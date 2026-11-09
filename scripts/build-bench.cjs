// Compiles the Java helpers (java/*.java: the object bench and the debugger) into resources/bench.
// Targets Java 11 so they run on every JDK a school might have.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { findJdks } = require('../electron/jdk.cjs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'resources', 'bench');
const jdk = findJdks()[0];
if (!jdk) {
  console.error('No JDK found. Install one (for example Eclipse Temurin) or set JAVA_HOME.');
  process.exit(1);
}
const sources = fs.readdirSync(path.join(root, 'java')).filter((f) => f.endsWith('.java')).map((f) => path.join(root, 'java', f));
// Compiled next to it first, then copied over: a BlackJ that starts its bench meanwhile (a test
// or smoke run in parallel) never finds the folder empty, and a compile error changes nothing.
const tmp = out + '.build-' + process.pid;
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
try {
  execFileSync(jdk.javac, ['--release', '11', '-encoding', 'UTF-8', '-Xlint:-options', '-d', tmp, ...sources], { stdio: 'inherit' });
  fs.mkdirSync(out, { recursive: true });
  const fresh = new Set(fs.readdirSync(tmp));
  for (const f of fresh) fs.copyFileSync(path.join(tmp, f), path.join(out, f));
  for (const f of fs.readdirSync(out)) if (f.endsWith('.class') && !fresh.has(f)) fs.rmSync(path.join(out, f), { force: true });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`Compiled ${sources.map((s) => path.basename(s)).join(', ')} with JDK ${jdk.version} -> ${path.relative(root, out)}`);
