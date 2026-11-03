// A project is a folder of .java files, the same layout BlueJ uses: packages are subfolders,
// jars in "+libs" are libraries, README.TXT is the project note. BlueJ projects open as they are;
// BlackJ keeps its class positions in .blackj.json and never touches BlueJ's package.bluej files.
const fs = require('fs');
const path = require('path');

const LAYOUT = '.blackj.json';
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SKIP_DIRS = new Set(['+libs', 'doc', 'docs', 'out', 'bin', 'target', 'node_modules']);
const README = 'README.TXT';

/** Every .java file below dir, as forward-slash paths relative to dir ("tiere/Hund.java"). */
function listJavaFiles(dir, rel = '', depth = 0, out = []) {
  if (depth > 8) return out;
  let entries;
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name) || !IDENT.test(e.name)) continue;
      listJavaFiles(dir, r, depth + 1, out);
    } else if (e.isFile() && e.name.endsWith('.java') && IDENT.test(e.name.slice(0, -5))) out.push(r);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

const classNameOf = (rel) => rel.slice(0, -5).split('/').join('.');
const packageOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')).split('/').join('.') : '');

/** Class positions from BlueJ's package.bluej files (one per package folder). */
function readBlueJLayout(dir, packages) {
  const positions = {};
  for (const pkg of ['', ...packages]) {
    const file = path.join(dir, ...pkg.split('.').filter(Boolean), 'package.bluej');
    if (!fs.existsSync(file)) continue;
    const props = {};
    for (const line of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
      const m = line.match(/^([^#=][^=]*)=(.*)$/);
      if (m) props[m[1].trim()] = m[2].trim();
    }
    for (const [k, v] of Object.entries(props)) {
      const m = k.match(/^(target\d+)\.name$/);
      if (!m) continue;
      const x = Number(props[m[1] + '.x']);
      const y = Number(props[m[1] + '.y']);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const isPackage = props[m[1] + '.type'] === 'PackageTarget';
      const name = isPackage ? 'pkg:' + (pkg ? pkg + '.' + v : v) : pkg ? pkg + '.' + v : v;
      positions[name] = { x, y };
    }
  }
  return positions;
}

function readLayout(dir, packages) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, LAYOUT), 'utf8'));
    return { positions: data.positions || {} };
  } catch {
    return { positions: readBlueJLayout(dir, packages) };
  }
}

function libsOf(dir) {
  const libDir = path.join(dir, '+libs');
  try {
    return fs.readdirSync(libDir).filter((f) => f.toLowerCase().endsWith('.jar')).map((f) => path.join(libDir, f));
  } catch {
    return [];
  }
}

function open(dir) {
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) throw new Error('not a folder');
  const rels = listJavaFiles(dir);
  const files = rels.map((rel) => ({
    name: rel,
    className: classNameOf(rel),
    pkg: packageOf(rel),
    content: fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'),
  }));
  const packages = [...new Set(files.flatMap((f) => {
    const parts = f.pkg ? f.pkg.split('.') : [];
    return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
  }))].sort();
  const layout = readLayout(dir, packages);
  let readme = null;
  for (const n of [README, 'README.md', 'readme.txt']) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) {
      readme = { name: n, content: fs.readFileSync(p, 'utf8') };
      break;
    }
  }
  let readOnly = false;
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    readOnly = true;
  }
  return {
    dir,
    name: path.basename(dir),
    files,
    packages,
    readme,
    libs: libsOf(dir).map((p) => path.basename(p)),
    positions: layout.positions,
    fromBlueJ: fs.existsSync(path.join(dir, 'package.bluej')),
    readOnly,
  };
}

/** Absolute path for a project-relative file, refusing anything outside the project. */
function safeFile(dir, rel) {
  const parts = String(rel).split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  const isReadme = parts.length === 1 && /^readme\.(txt|md)$/i.test(last);
  if (!isReadme) {
    if (!last.endsWith('.java') || !IDENT.test(last.slice(0, -5))) throw new Error('invalid file name');
    for (const p of parts.slice(0, -1)) if (!IDENT.test(p)) throw new Error('invalid folder name');
  }
  const full = path.resolve(dir, ...parts);
  if (!full.startsWith(path.resolve(dir) + path.sep)) throw new Error('outside project');
  return full;
}

function writeFile(dir, rel, content) {
  const full = safeFile(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function createClass(dir, qualified, content) {
  const parts = String(qualified).split('.');
  if (!parts.every((p) => IDENT.test(p))) throw Object.assign(new Error('invalid class name'), { code: 'invalidName' });
  const rel = parts.join('/') + '.java';
  const full = safeFile(dir, rel);
  if (fs.existsSync(full)) throw Object.assign(new Error('class exists'), { code: 'exists' });
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return { name: rel, className: parts.join('.'), pkg: parts.slice(0, -1).join('.'), content };
}

function createPackage(dir, pkg) {
  const parts = String(pkg).split('.');
  if (!parts.every((p) => IDENT.test(p))) throw Object.assign(new Error('invalid package name'), { code: 'invalidName' });
  fs.mkdirSync(path.join(dir, ...parts), { recursive: true });
  return parts.join('.');
}

/** Renames a class file (for a class whose name no longer matches its file). */
function renameFile(dir, fromRel, toRel) {
  const from = safeFile(dir, fromRel);
  const to = safeFile(dir, toRel);
  if (fs.existsSync(to)) throw Object.assign(new Error('exists'), { code: 'exists' });
  fs.renameSync(from, to);
}

function savePositions(dir, positions) {
  fs.writeFileSync(path.join(dir, LAYOUT), JSON.stringify({ version: 1, positions }, null, 2), 'utf8');
}

/** Copies an example into a fresh folder so the original stays untouched. */
function copyExample(src, targetParent) {
  fs.mkdirSync(targetParent, { recursive: true });
  const target = freeDir(targetParent, path.basename(src));
  fs.cpSync(src, target, { recursive: true });
  return target;
}

/** Copies a .java file into the project (into package pkg) and fixes its package line, like BlueJ's "Add Class from File". */
function addFile(dir, file, pkg) {
  const name = path.basename(file);
  if (!name.endsWith('.java') || !IDENT.test(name.slice(0, -5))) throw Object.assign(new Error('invalid file name'), { code: 'invalidName' });
  const parts = pkg ? String(pkg).split('.') : [];
  const rel = [...parts, name].join('/');
  const full = safeFile(dir, rel);
  if (fs.existsSync(full)) throw Object.assign(new Error('class exists'), { code: 'exists' });
  let content = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const decl = /^(\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*)package\s+[\w.]+\s*;[ \t]*\r?\n?/;
  if (decl.test(content)) content = content.replace(decl, pkg ? `$1package ${pkg};\n` : '$1');
  else if (pkg) content = `package ${pkg};\n\n` + content;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return { name: rel, className: [...parts, name.slice(0, -5)].join('.'), pkg: parts.join('.'), content };
}

/** A free folder name below parent: "Name", "Name 2", ... */
function freeDir(parent, base) {
  let target = path.join(parent, base);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(parent, `${base} ${i}`);
  return target;
}

/** The project folder inside an unpacked archive: the shallowest folder with package.bluej or .java files. */
function projectRoot(dir) {
  let level = [dir];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const withJava = [];
    const next = [];
    for (const d of level) {
      let entries = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch { /* unreadable */ }
      if (entries.some((e) => e.isFile() && e.name === 'package.bluej')) return d;
      if (entries.some((e) => e.isFile() && e.name.endsWith('.java'))) withJava.push(d);
      for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== '__MACOSX') next.push(path.join(d, e.name));
    }
    if (withJava.length) return withJava[0];
    level = next;
  }
  return dir;
}

const ARCHIVE_SKIP = new Set(['.git', '.svn', 'node_modules', 'out', 'target', '__MACOSX']);

/** Files that belong in a project archive: sources, BlueJ files, libraries and notes, no compiled classes. */
function archiveFiles(dir, rel = '', depth = 0, out = []) {
  if (depth > 10) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (!ARCHIVE_SKIP.has(e.name)) archiveFiles(dir, r, depth + 1, out);
    } else if (e.isFile() && !/\.(class|ctxt)$/i.test(e.name) && !/^(\.DS_Store|Thumbs\.db|bluej\.pkh)$/i.test(e.name)) {
      out.push(r);
    }
  }
  return out;
}

function createProject(parent, name) {
  const clean = String(name || '').trim().replace(/[<>:"/\\|?*]/g, '');
  if (!clean) throw Object.assign(new Error('invalid name'), { code: 'invalidName' });
  const dir = path.join(parent, clean);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw Object.assign(new Error('folder not empty'), { code: 'exists' });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { open, writeFile, renameFile, createClass, createPackage, addFile, savePositions, copyExample, createProject, safeFile, listJavaFiles, libsOf, freeDir, projectRoot, archiveFiles, IDENT, SKIP_DIRS };
