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
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execFileSync(jdk.javac, ['--release', '11', '-encoding', 'UTF-8', '-Xlint:-options', '-d', out, ...sources], { stdio: 'inherit' });
console.log(`Compiled ${sources.map((s) => path.basename(s)).join(', ')} with JDK ${jdk.version} -> ${path.relative(root, out)}`);
