// What a name in the editor means, across the whole project: the type of an expression in front of
// a dot, the declaration a name refers to, and every place that refers to the same declaration.
// Built on editor-symbols.js (one file) and the project model (all classes, from model.js).
import API from './jdkApi.json';
import { libMembers, libClass } from './completion.js';
import { analyze, tokenAt, localFor, declAt, receiverBefore, splitChain, isWrite, classAt } from './editor-symbols.js';

const PRIM = new Set(['int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'void', 'var']);

/** Context for one file: its text, analysis, the project model and its own class. */
export function makeCtx(model, name, text) {
  const cur = model.list.find((c) => c.file === name) || null;
  return { pm: model, name, text, a: analyze(text), cur };
}

export function projectClass(pm, simple, cur) {
  if (!simple) return null;
  const base = String(simple).split('.').pop();
  if (cur && pm.resolve) {
    const q = pm.resolve(cur, base);
    if (q) return pm.byName[q];
  }
  return pm.byName[simple] || pm.list.find((c) => c.simple === base) || null;
}

/** Is class `sub` the same as `sup` or below it (extends / implements, through the project)? */
export function isSub(pm, sub, sup) {
  if (!sub || !sup) return false;
  const seen = new Set();
  const queue = [sub];
  while (queue.length) {
    const c = queue.shift();
    if (!c || seen.has(c.fileClass)) continue;
    if (c.fileClass === sup.fileClass) return true;
    seen.add(c.fileClass);
    for (const p of c.parents || []) queue.push(pm.byName[p]);
  }
  return false;
}

/** A field (call false) or method (call true) of a project class or its project parents. */
export function findMember(pm, cls, name, call, argc = null) {
  const seen = new Set();
  const queue = [cls];
  while (queue.length) {
    const c = queue.shift();
    if (!c || seen.has(c.fileClass)) continue;
    seen.add(c.fileClass);
    if (call) {
      const list = c.methods.filter((m) => m.name === name);
      if (list.length) return { cls: c, m: (argc != null && list.find((m) => m.params.length === argc)) || list[0], kind: 'method' };
    } else {
      const f = c.fields.find((x) => x.name === name);
      if (f) return { cls: c, m: f, kind: 'field' };
    }
    for (const p of c.parents || []) queue.push(pm.byName[p]);
  }
  return null;
}

/** The highest project class that declares this method: renaming starts there so overrides follow. */
export function rootOwner(pm, cls, name, call) {
  let root = cls;
  const seen = new Set();
  const up = (c) => {
    if (!c || seen.has(c.fileClass)) return;
    seen.add(c.fileClass);
    for (const p of c.parents || []) {
      const pc = pm.byName[p];
      if (!pc) continue;
      const has = call ? pc.methods.some((m) => m.name === name) : pc.fields.some((f) => f.name === name);
      if (has) root = pc;
      up(pc);
    }
  };
  up(cls);
  return root;
}

function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    if (ch === '>' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A type name ("ArrayList<Tier>", "Hund", "int[]") as { kind: 'project'|'lib'|'array', … } or null. */
export function typeFromName(ctx, type) {
  if (!type) return null;
  const t = String(type).replace(/\s+/g, '').replace(/\.\.\.$/, '[]');
  if (/\[\]$/.test(t)) return { kind: 'array', of: t.slice(0, -2) };
  const lt = t.indexOf('<');
  const base = (lt < 0 ? t : t.slice(0, lt)).split('.').pop();
  if (PRIM.has(base)) return null;
  const pc = projectClass(ctx.pm, base, ctx.cur);
  if (pc) return { kind: 'project', cls: pc, statics: false };
  const lib = libClass(base);
  if (!lib) return null;
  const args = lt < 0 ? [] : splitArgs(t.slice(lt + 1, t.lastIndexOf('>')));
  const tp = API[lib].tp || (lib === 'Map' || lib === 'HashMap' ? ['K', 'V'] : ['List', 'Set', 'Iterator'].includes(lib) ? ['E'] : []);
  const map = {};
  tp.forEach((n, i) => {
    if (args[i]) map[n] = args[i];
  });
  return { kind: 'lib', cls: lib, statics: false, args: map };
}

/** The declared type of a plain name at an offset: local, parameter, field (also inherited). */
export function typeOfName(ctx, name, offset) {
  const local = localFor(ctx.a, { name, start: offset });
  if (local && local.type) return local.type;
  if (ctx.cur) {
    const f = findMember(ctx.pm, ctx.cur, name, false);
    if (f) return f.m.type;
  }
  const d = ctx.a.decls.find((x) => x.kind === 'field' && x.name === name);
  return d ? d.type : null;
}

function headType(ctx, seg, offset) {
  if (seg.startsWith('"')) return { kind: 'lib', cls: 'String', statics: false, args: {} };
  let m = seg.match(/^new\s+([\w$.]+)\s*(<[^(]*>)?\s*[([]/);
  if (m) return /\[/.test(seg.slice(m[0].length - 1, m[0].length)) ? { kind: 'array', of: m[1] } : typeFromName(ctx, m[1] + (m[2] || ''));
  if (seg === 'this') return ctx.cur ? { kind: 'project', cls: ctx.cur, statics: false } : null;
  if (seg === 'super') {
    const p = ctx.cur && ctx.cur.parents && ctx.cur.parents[0];
    return p && ctx.pm.byName[p] ? { kind: 'project', cls: ctx.pm.byName[p], statics: false } : null;
  }
  m = seg.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (m) {
    const mm = ctx.cur && findMember(ctx.pm, ctx.cur, m[1], true);
    return mm ? typeFromName(ctx, mm.m.returnType) : null;
  }
  m = seg.match(/^([A-Za-z_$][\w$]*)\s*((?:\[[^\]]*\]\s*)*)$/);
  if (!m) return null;
  const name = m[1];
  const index = (m[2].match(/\[/g) || []).length;
  let type = typeOfName(ctx, name, offset);
  if (type) {
    for (let i = 0; i < index; i++) type = type.replace(/\[\s*\]$/, '');
    return typeFromName(ctx, type);
  }
  if (/^[A-Z]/.test(name)) {
    const pc = projectClass(ctx.pm, name, ctx.cur);
    if (pc) return { kind: 'project', cls: pc, statics: true };
    if (API[name]) return { kind: 'lib', cls: name, statics: true, args: {} };
  }
  return null;
}

function memberType(ctx, t, seg) {
  if (!t) return null;
  const m = seg.match(/^([A-Za-z_$][\w$]*)\s*(\()?/);
  if (!m) return null;
  const name = m[1];
  const call = !!m[2];
  if (t.kind === 'array') return null;
  if (t.kind === 'project') {
    const mm = findMember(ctx.pm, t.cls, name, call);
    if (!mm) return null;
    return typeFromName(ctx, call ? mm.m.returnType : mm.m.type);
  }
  if (t.kind === 'lib') {
    if (t.cls === 'System' && (name === 'out' || name === 'err')) return { kind: 'lib', cls: 'PrintStream', statics: false, args: {} };
    const hit = libMembers(t.cls, t.statics, t.args || {}, 'de').find((x) => x.name === name && !!x.field === !call);
    return hit ? typeFromName(ctx, hit.ret) : null;
  }
  return null;
}

/** The type of an expression in front of a dot: "gehege", "this.tiere.get(0)", "new Hund()". */
export function typeOfExpr(ctx, expr, offset) {
  if (!expr) return null;
  if (expr === 'System.out' || expr === 'System.err') return { kind: 'lib', cls: 'PrintStream', statics: false, args: {} };
  const segs = splitChain(expr);
  let t = headType(ctx, segs[0], offset);
  for (const seg of segs.slice(1)) t = memberType(ctx, t, seg);
  return t;
}

/** Offsets [start, end) of each argument of the call whose name ends at `nameEnd`, or null. */
export function argRanges(a, nameEnd) {
  const m = a.masked;
  let i = nameEnd;
  while (i < m.length && /\s/.test(m[i])) i++;
  if (m[i] !== '(') return null;
  const out = [];
  let depth = 0;
  let start = i + 1;
  for (let k = i; k < m.length; k++) {
    const c = m[k];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        if (m.slice(start, k).trim()) out.push([start, k]);
        return out.map(([s, e]) => {
          let ss = s;
          let ee = e;
          while (ss < ee && /\s/.test(m[ss])) ss++;
          while (ee > ss && /\s/.test(m[ee - 1])) ee--;
          return [ss, ee];
        });
      }
    } else if (c === ',' && depth === 1) {
      out.push([start, k]);
      start = k + 1;
    } else if (c === ';' && depth === 1) return null;
  }
  return null;
}

/**
 * The symbol under an offset: { tok, kind: 'local'|'field'|'method'|'class'|'lib'|'libClass', name, … }.
 * Members carry their declaring project class as `owner` (null: only this file knows it).
 */
export function symbolAt(ctx, offset) {
  const { a, pm, cur } = ctx;
  const tok = tokenAt(a, offset);
  if (!tok) return null;
  const decl = declAt(a, tok);
  if (decl) {
    if (decl.kind === 'local' || decl.kind === 'param') return { tok, kind: 'local', decl, name: tok.name };
    if (decl.kind === 'class' || decl.kind === 'ctor') return { tok, kind: 'class', name: tok.name, cls: projectClass(pm, tok.name, cur), ctor: decl.kind === 'ctor' };
    const own = decl.owner && !decl.owner.parent && cur && decl.owner.name === cur.simple ? cur : null;
    const member = own ? findMember(pm, own, tok.name, decl.kind === 'method') : null;
    return { tok, kind: decl.kind, name: tok.name, owner: own, member: member && member.m, call: decl.kind === 'method', fileOnly: !own };
  }
  const argc = tok.call ? (argRanges(a, tok.end) || []).length : null;
  if (tok.dot) {
    const expr = receiverBefore(a, tok.dotAt);
    const t = expr ? typeOfExpr(ctx, expr, tok.start) : null;
    if (!t) {
      if (/^[A-Z]/.test(tok.name)) {
        const pc = projectClass(pm, tok.name, cur);
        if (pc) return { tok, kind: 'class', name: tok.name, cls: pc };
      }
      return null;
    }
    if (t.kind === 'project') {
      const mm = findMember(pm, t.cls, tok.name, tok.call, argc);
      return mm ? { tok, kind: mm.kind, name: tok.name, owner: mm.cls, member: mm.m, call: tok.call, via: t.cls } : null;
    }
    if (t.kind === 'lib') return { tok, kind: 'lib', name: tok.name, lib: t.cls, statics: t.statics, args: t.args, call: tok.call };
    return null;
  }
  const local = localFor(a, tok);
  if (local) return { tok, kind: 'local', decl: local, name: tok.name };
  if (/\bnew\s+$/.test(a.masked.slice(Math.max(0, tok.start - 8), tok.start))) {
    const pc = projectClass(pm, tok.name, cur);
    if (pc) return { tok, kind: 'class', name: tok.name, cls: pc, ctorCall: true, argc };
    return API[tok.name] ? { tok, kind: 'libClass', name: tok.name } : null;
  }
  if (cur) {
    const mm = findMember(pm, cur, tok.name, tok.call, argc);
    if (mm) return { tok, kind: mm.kind, name: tok.name, owner: mm.cls, member: mm.m, call: tok.call };
  }
  const inFile = a.members.find((m) => m.name === tok.name && (tok.call ? m.kind === 'method' : m.kind === 'field'));
  if (inFile) return { tok, kind: inFile.kind, name: tok.name, owner: null, fileOnly: true, call: tok.call };
  if (/^[A-Z]/.test(tok.name)) {
    const pc = projectClass(pm, tok.name, cur);
    if (pc) return { tok, kind: 'class', name: tok.name, cls: pc };
    if (API[tok.name]) return { tok, kind: 'libClass', name: tok.name };
  }
  return null;
}

/** Where a symbol is declared: { file, start, end } in that file's text (texts: name → text). */
export function locate(ctx, sym, textOf) {
  if (sym.kind === 'local') return { file: ctx.name, start: sym.decl.start, end: sym.decl.end };
  if (sym.kind === 'class') {
    if (!sym.cls) return null;
    const text = textOf(sym.cls.file);
    if (text == null) return null;
    const a = analyze(text);
    if (sym.ctorCall) {
      const ctors = a.members.filter((m) => m.kind === 'ctor' && m.name === sym.name);
      const pick = ctors.find((m) => (argRanges(a, m.end) || []).filter((r) => r[1] > r[0]).length === sym.argc) || ctors[0];
      if (pick) return { file: sym.cls.file, start: pick.start, end: pick.end };
    }
    const c = a.classes.find((x) => x.name === sym.name);
    return c ? { file: sym.cls.file, start: c.start, end: c.end } : null;
  }
  if (sym.kind === 'field' || sym.kind === 'method') {
    const file = sym.owner ? sym.owner.file : ctx.name;
    const text = textOf(file);
    if (text == null) return null;
    const a = analyze(text);
    const list = a.members.filter((m) => m.name === sym.name && (sym.kind === 'field' ? m.kind === 'field' : m.kind === 'method'));
    if (!list.length) return null;
    let pick = list[0];
    if (sym.member && sym.member.params && list.length > 1) {
      const n = sym.member.params.length;
      pick = list.find((m) => (m.params ? (argRanges(a, m.end) || []).length : 0) === n) || pick;
    }
    return { file, start: pick.start, end: pick.end };
  }
  return null;
}

/**
 * Every place that refers to the symbol: [{ file, start, end, write, decl }]. `files` lists the
 * project files to search ([name, text] pairs); `onlyFile` limits it to one of them.
 */
export function referencesOf(ctx, sym, files, onlyFile = null) {
  const { pm } = ctx;
  const out = [];
  const add = (file, a, t) => out.push({ file, start: t.start, end: t.end, write: isWrite(a, t) || !!declAt(a, t), decl: !!declAt(a, t) });
  if (sym.kind === 'local') {
    const a = ctx.a;
    for (const t of a.tokens) {
      if (t.name !== sym.name || t.dot) continue;
      if (t.start === sym.decl.start) add(ctx.name, a, t);
      else {
        const d = localFor(a, t);
        if (d && d.start === sym.decl.start) add(ctx.name, a, t);
      }
    }
    return out;
  }
  const list = onlyFile ? files.filter(([f]) => f === onlyFile) : files;
  if (sym.kind === 'class') {
    for (const [file, text] of list) {
      if (!text || !text.includes(sym.name)) continue;
      const a = analyze(text);
      for (const t of a.tokens) {
        if (t.name !== sym.name) continue;
        if (t.dot) {
          const r = receiverBefore(a, t.dotAt) || '';
          if (!/^[a-z_$][\w$]*(\.[a-z_$][\w$]*)*$/.test(r)) continue;
        } else if (localFor(a, t)) continue;
        add(file, a, t);
      }
    }
    return out;
  }
  if (sym.kind === 'lib') {
    // Library members: only the same name after a dot in this file (for highlights).
    for (const t of ctx.a.tokens) if (t.name === sym.name && t.dot) add(ctx.name, ctx.a, t);
    return out;
  }
  if (sym.kind !== 'field' && sym.kind !== 'method') return out;
  const call = sym.kind === 'method';
  if (!sym.owner) {
    const a = ctx.a;
    for (const t of a.tokens) {
      if (t.name !== sym.name || !!t.call !== call) continue;
      if (t.dot && receiverBefore(a, t.dotAt) !== 'this') continue;
      if (!t.dot && localFor(a, t)) continue;
      add(ctx.name, a, t);
    }
    return out;
  }
  const owner = rootOwner(pm, sym.owner, sym.name, call);
  for (const [file, text] of list) {
    if (!text || !text.includes(sym.name)) continue;
    const fctx = makeCtx(pm, file, text);
    const a = fctx.a;
    for (const t of a.tokens) {
      if (t.name !== sym.name) continue;
      // this::name is a method reference.
      const isRef = t.dot && a.masked[t.dotAt] === ':';
      if (!!t.call !== call && !(call && isRef)) continue;
      if (!t.dot) {
        if (localFor(a, t)) continue;
        const inClass = classAt(a, t.start);
        const cls = inClass && fctx.cur && inClass.name === fctx.cur.simple ? fctx.cur : null;
        if (cls && isSub(pm, cls, owner)) add(file, a, t);
        continue;
      }
      const expr = receiverBefore(a, t.dotAt);
      if (expr === 'this' || expr === 'super') {
        if (fctx.cur && isSub(pm, fctx.cur, owner)) add(file, a, t);
        continue;
      }
      const ty = typeOfExpr(fctx, expr, t.start);
      if (ty && ty.kind === 'project' && (isSub(pm, ty.cls, owner) || isSub(pm, owner, ty.cls))) add(file, a, t);
    }
  }
  return out;
}

/** A short line that says what a symbol is, for hovers: "int alter", "void bellen(int mal)". */
export function signatureOf(sym) {
  if (sym.kind === 'local') return `${sym.decl.type || 'var'} ${sym.name}`;
  if (sym.kind === 'field' && sym.member) return `${sym.member.type} ${sym.owner ? sym.owner.simple + '.' : ''}${sym.name}`;
  if (sym.kind === 'method' && sym.member) return `${sym.member.returnType || 'void'} ${sym.owner ? sym.owner.simple + '.' : ''}${sym.name}(${sym.member.params.map((p) => `${p.type} ${p.name}`).join(', ')})`;
  if (sym.kind === 'class' && sym.cls) {
    const c = sym.cls;
    const kw = c.kind === 'interface' ? 'interface' : c.kind === 'enum' ? 'enum' : c.abstract ? 'abstract class' : 'class';
    return `${kw} ${c.simple}${c.extends.length && c.kind !== 'interface' ? ' extends ' + c.extends.join(', ') : ''}${c.implements.length ? ' implements ' + c.implements.join(', ') : ''}`;
  }
  return null;
}
