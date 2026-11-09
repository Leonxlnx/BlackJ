// Runs javac over a project and turns its output into structured problems.
// javac is forced to English so the friendly explanations can match its messages.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launcherPath } = require('./bench.cjs');

const HEADER = /^(.+\.java):(\d+): (error|warning): (.*)$/;

/** Parses javac output. `file` is relative to projectDir with forward slashes ("tiere/Hund.java"). */
function parseDiagnostics(text, projectDir) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(HEADER);
    if (m) {
      const rel = projectDir ? path.relative(projectDir, path.resolve(projectDir, m[1])).split(path.sep).join('/') : path.basename(m[1]);
      cur = { file: rel.startsWith('..') ? path.basename(m[1]) : rel, path: m[1], line: Number(m[2]), column: 1, severity: m[3], message: m[4], details: [], source: '' };
      out.push(cur);
      const src = lines[i + 1];
      const caret = lines[i + 2];
      if (src !== undefined && caret !== undefined && /^\s*\^\s*$/.test(caret)) {
        cur.source = src;
        cur.column = caret.indexOf('^') + 1;
        i += 2;
      }
      continue;
    }
    if (!cur) continue;
    if (/^\d+ (errors?|warnings?)$/.test(line.trim()) || /^Note: /.test(line)) { cur = null; continue; }
    if (line.trim()) cur.details.push(line.trim());
  }
  return out;
}

function clearClasses(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    else if (entry.name.endsWith('.class')) fs.rmSync(p, { force: true });
  }
}

/** Compiles every given .java file into outDir. Resolves with { ok, problems, output, ms }. */
function compile({ jdk, projectDir, outDir, files, classpath = [] }) {
  return new Promise((resolve) => {
    const started = Date.now();
    fs.mkdirSync(outDir, { recursive: true });
    clearClasses(outDir);
    if (files.length === 0) return resolve({ ok: true, problems: [], output: '', ms: 0 });
    const argFile = path.join(outDir, '..', 'javac-args.txt');
    const quote = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    // The sources relative to the project folder (javac runs there): a folder name outside the
    // ANSI code page (Cyrillic, say) never has to pass through the launcher or the argument file.
    const rel = (f) => {
      const r = path.relative(projectDir, f);
      return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : f;
    };
    fs.writeFileSync(argFile, files.map((f) => quote(rel(f))).join('\n'), 'utf8');
    const cp = [outDir, ...classpath].map(launcherPath).join(path.delimiter);
    // Everything in UTF-8: the argument file (Java 17 reads it in file.encoding) and the messages,
    // read as UTF-8 below, so umlauts in file names and in the quoted source line arrive intact
    // (stdout/stderr.encoding since Java 19, sun.* before).
    const utf8Out = ['-J-Dfile.encoding=UTF-8', '-J-Dstdout.encoding=UTF-8', '-J-Dstderr.encoding=UTF-8', '-J-Dsun.stdout.encoding=UTF-8', '-J-Dsun.stderr.encoding=UTF-8'];
    const args = ['-J-Duser.language=en', '-J-Duser.country=US', ...utf8Out, '-encoding', 'UTF-8', '-g', '-parameters', '-Xmaxerrs', '200', '-d', launcherPath(outDir), '-cp', cp, '-sourcepath', launcherPath(projectDir), '@' + launcherPath(argFile)];
    let output = '';
    let child;
    try {
      child = spawn(jdk.javac, args, { cwd: projectDir, windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, problems: [], output: String(err), ms: 0, failed: true });
    }
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', (d) => { output += d.toString('utf8'); });
    child.stderr.on('data', (d) => { output += d.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, problems: [], output: String(err), ms: Date.now() - started, failed: true });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const problems = parseDiagnostics(output, projectDir);
      resolve({ ok: code === 0, problems, output, ms: Date.now() - started });
    });
  });
}

module.exports = { compile, parseDiagnostics };
