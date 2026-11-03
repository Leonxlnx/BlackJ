// What comes after a dot: finds the type of the expression in front of it (a variable, a field,
// a parameter, `this`, a class name, a string literal, System.out) in the source text, then lists
// that type's members, for project classes from the model and for library classes from jdkApi.json.
import API from './jdkApi.json';
import { jdkDoc } from './jdkDocs.js';

const PRIMITIVES = new Set(['int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short']);

/** The library entry for a type name: the class itself or its interface (TreeMap → Map). */
export function libClass(name) {
  if (API[name]) return name;
  if (/Map$/.test(name)) return 'Map';
  if (/Set$/.test(name)) return 'Set';
  if (/List$/.test(name)) return 'List';
  return null;
}

/** The expression in front of the trailing dot of `before` (the line up to the cursor's word). */
export function receiverOf(before) {
  const m = before.match(/("(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*$/);
  return m ? m[1].replace(/\s+/g, '') : null;
}

const esc = (s) => s.replace(/[$]/g, '\\$');

/** The declared type of `ident` in `text`: the nearest declaration before `offset`, else one after it (a field). */
export function declaredType(text, ident, offset) {
  const re = new RegExp(`(?:^|[\\s(,;{])((?:[A-Z][\\w$]*(?:\\.[A-Z][\\w$]*)*|int|long|double|float|boolean|char|byte|short)(?:\\s*<[^;=(){}]*?>)?(?:\\s*\\[\\s*\\])*)\\s+${esc(ident)}\\s*(?=[=;,):\\[])`, 'g');
  let before = null;
  let after = null;
  let m;
  while ((m = re.exec(text))) {
    if (m.index < offset) before = m[1];
    else if (!after) after = m[1];
  }
  return (before || after || '').replace(/\s+/g, ' ').trim() || null;
}

/** Splits "Map<String, List<Tier>>" into the base name and its type arguments. */
function splitType(type) {
  const t = type.replace(/\s+/g, '');
  const lt = t.indexOf('<');
  if (lt < 0) return { base: t, args: [] };
  const inner = t.slice(lt + 1, t.lastIndexOf('>'));
  const args = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '<') depth++;
    if (ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      args.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) args.push(cur);
  return { base: t.slice(0, lt), args };
}

function projectClass(model, name) {
  return model.byName[name] || model.list.find((c) => c.simple === name.split('.').pop()) || null;
}

/**
 * Resolves the receiver to { kind: 'lib' | 'project' | 'array', cls, statics, args }, or null when unknown.
 * `cur` is the project class of the open file.
 */
export function resolveReceiver(text, offset, expr, model, cur) {
  if (!expr) return null;
  if (expr.startsWith('"')) return { kind: 'lib', cls: 'String', statics: false, args: {} };
  if (expr === 'System.out' || expr === 'System.err') return { kind: 'lib', cls: 'PrintStream', statics: false, args: {} };
  if (expr === 'this' && cur) return { kind: 'project', cls: cur, statics: false };
  const parts = expr.split('.');
  let ident = parts[parts.length - 1];
  if (parts.length === 2 && parts[0] === 'this') ident = parts[1];
  else if (parts.length > 1) return null;
  const type = ident === 'this' ? null : declaredType(text, ident, offset);
  if (!type) {
    // A class name: static members (Math.max, Integer.parseInt, Hund.anzahl).
    if (!/^[A-Z]/.test(ident)) return null;
    const pc = projectClass(model, ident);
    if (pc) return { kind: 'project', cls: pc, statics: true };
    const lib = API[ident] ? ident : null;
    return lib ? { kind: 'lib', cls: lib, statics: true, args: {} } : null;
  }
  if (/\[\s*\]$/.test(type)) return { kind: 'array' };
  if (PRIMITIVES.has(type)) return null;
  const { base, args } = splitType(type);
  const pc = projectClass(model, base);
  if (pc) return { kind: 'project', cls: pc, statics: false };
  const lib = libClass(base.split('.').pop());
  if (!lib) return null;
  const tp = API[lib].tp || (lib === 'Map' || lib === 'HashMap' ? ['K', 'V'] : lib === 'List' || lib === 'Set' || lib === 'Iterator' ? ['E'] : []);
  const map = {};
  tp.forEach((name, i) => { if (args[i]) map[name] = args[i]; });
  return { kind: 'lib', cls: lib, statics: false, args: map };
}

/** Replaces type variables (E, K, V, T) with the declared type arguments. */
function fill(type, args) {
  return type.replace(/\b[A-Z]\b/g, (v) => args[v] || (v.length === 1 ? 'Object' : v)).replace(/\? extends |\? super /g, '');
}

/** Members of a library class: [{ name, ret, params, isStatic, field, doc, overloads }]. */
export function libMembers(cls, statics, args, lang) {
  const entry = API[cls];
  if (!entry) return [];
  const out = [];
  for (const [name, ret, params, st] of entry.m) {
    if (!!st !== statics) continue;
    out.push({ name, ret: fill(ret, args), params: params.map((p) => fill(p, args)), isStatic: !!st, doc: jdkDoc(cls, name, lang) });
  }
  if (statics) for (const [name, type] of entry.f) out.push({ name, ret: type, field: true, isStatic: true, doc: jdkDoc(cls, name, lang) });
  return out;
}

/** Members of a project class and its project superclasses, as seen from outside or via this. */
export function projectMembers(model, cls, statics, inside) {
  const out = [];
  const seen = new Set();
  const stack = [cls];
  while (stack.length) {
    const c = stack.shift();
    if (!c || seen.has(c.fileClass)) continue;
    seen.add(c.fileClass);
    for (const m of c.methods) {
      if ((!inside && m.visibility === 'private') || (statics && !m.static) || m.name === 'main') continue;
      out.push({ name: m.name, ret: m.returnType || 'void', params: m.params.map((p) => p.type), names: m.params.map((p) => p.name), isStatic: m.static, doc: m.doc ? m.doc.text : null, owner: c.simple });
    }
    for (const f of c.fields) {
      if ((!inside && f.visibility === 'private') || (statics && !f.static)) continue;
      out.push({ name: f.name, ret: f.type, field: true, isStatic: f.static, doc: f.doc ? f.doc.text : null, owner: c.simple });
    }
    for (const p of c.parents || []) stack.push(model.byName[p]);
  }
  return out;
}
