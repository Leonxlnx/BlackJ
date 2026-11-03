// Finds Java Development Kits on this computer. A school PC usually has BlueJ installed,
// and BlueJ ships its own JDK, so its folders are searched too. A "jdk" folder next to
// BlackJ.exe (for a USB stick) wins over everything except a path chosen in the settings.
const fs = require('fs');
const path = require('path');
const os = require('os');

const exe = process.platform === 'win32' ? '.exe' : '';

function readVersion(home) {
  try {
    const release = fs.readFileSync(path.join(home, 'release'), 'utf8');
    const m = release.match(/JAVA_VERSION="([^"]+)"/);
    if (m) return m[1];
  } catch { /* no release file */ }
  const m = path.basename(home).match(/(\d+(?:\.\d+)*)/);
  return m ? m[1] : '0';
}

function major(version) {
  const parts = String(version).split(/[._+-]/).map(Number);
  return parts[0] === 1 ? parts[1] : parts[0];
}

function asJdk(home, source) {
  if (!home) return null;
  home = path.resolve(home.replace(/[\\/]bin[\\/]?$/i, ''));
  const javac = path.join(home, 'bin', 'javac' + exe);
  const java = path.join(home, 'bin', 'java' + exe);
  if (!fs.existsSync(javac) || !fs.existsSync(java)) return null;
  const version = readVersion(home);
  return { home, javac, java, version, major: major(version), source };
}

function children(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

function candidates(extra = []) {
  const list = [];
  const add = (home, source) => list.push([home, source]);
  for (const e of extra) add(e.path, e.source);
  if (process.env.JAVA_HOME) add(process.env.JAVA_HOME, 'JAVA_HOME');
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, 'javac' + exe))) add(path.dirname(dir), 'PATH');
  }
  if (process.platform === 'win32') {
    const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean);
    const local = process.env.LOCALAPPDATA;
    const bluej = [];
    for (const p of pf) bluej.push(path.join(p, 'BlueJ', 'jdk'));
    if (local) bluej.push(path.join(local, 'Programs', 'BlueJ', 'jdk'));
    for (const drive of ['C:', 'D:', 'E:']) bluej.push(path.join(drive + '\\', 'BlueJ', 'jdk'));
    for (const b of bluej) add(b, 'BlueJ');
    const vendors = ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Eclipse Foundation', 'Semeru', 'OpenJDK'];
    for (const p of pf) for (const v of vendors) for (const c of children(path.join(p, v))) add(c, v);
  } else {
    for (const c of children('/usr/lib/jvm')) add(c, 'system');
    for (const c of children('/Library/Java/JavaVirtualMachines')) add(path.join(c, 'Contents', 'Home'), 'system');
  }
  for (const c of children(path.join(os.homedir(), '.jdks'))) add(c, 'IntelliJ');
  return list;
}

/** All usable JDKs (Java 11 or newer), best first: chosen path, portable folder, then newest. */
function findJdks({ preferred, portableDir } = {}) {
  const extra = [];
  if (preferred) extra.push({ path: preferred, source: 'settings' });
  if (portableDir) extra.push({ path: path.join(portableDir, 'jdk'), source: 'portable' });
  const seen = new Set();
  const found = [];
  for (const [home, source] of candidates(extra)) {
    const jdk = asJdk(home, source);
    if (!jdk || jdk.major < 11) continue;
    const key = jdk.home.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(jdk);
  }
  const rank = (j) => (j.source === 'settings' ? 2 : j.source === 'portable' ? 1 : 0);
  return found.sort((a, b) => rank(b) - rank(a) || b.major - a.major);
}

module.exports = { findJdks, asJdk };
