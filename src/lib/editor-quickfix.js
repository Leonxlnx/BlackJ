// Quick fixes for the compiler errors students meet most (Strg+. or the light bulb): a missing
// semicolon, a missing import, a misspelt name, a missing return, a lossy number conversion, a
// missing closing brace, methods an interface still wants, a variable without a start value.
// Each fix is { title, edits: [{ file, range: [startLine, startCol, endLine, endCol], text }], preferred }
// or { title, command: [name, ...args] } for fixes that are actions of the app.
import API from './jdkApi.json';
import { explainProblem } from './errors.js';
import { tokenAt, localsAt, offsetAt, posAt, methodAt, classAt, distance } from './editor-symbols.js';
import { findMember, makeCtx, projectClass } from './editor-resolve.js';
import { IMPORTS, JAVA_LANG, importEdit } from './editor-snippets.js';
import { libMembers } from './completion.js';

const DEFAULTS = { int: '0', long: '0', short: '0', byte: '0', double: '0.0', float: '0.0f', boolean: 'false', char: "' '", String: '""' };
export const defaultValue = (type) => DEFAULTS[String(type || '').replace(/\s+/g, '')] ?? 'null';

const T = {
  de: {
    semicolon: 'Semikolon ergänzen',
    import: 'Importieren: {q}',
    rename: '„{to}“ statt „{from}“',
    ret: 'return {v}; ergänzen',
    cast: 'In {t} umwandeln: ({t})',
    widen: 'Variable als {t} deklarieren',
    brace: 'Fehlende } am Ende ergänzen',
    rename_file: 'Datei in {f} umbenennen',
    stubs: 'Fehlende Methoden ergänzen ({n})',
    init: '{v} als Startwert geben',
    assign: 'Zuweisung statt neuer Variable (Typ weglassen)',
    void: 'Rückgabetyp void ergänzen',
    ctor: 'Als Konstruktor von {c} schreiben',
    todo: 'TODO',
  },
  en: {
    semicolon: 'Add the semicolon',
    import: 'Import {q}',
    rename: '“{to}” instead of “{from}”',
    ret: 'Add return {v};',
    cast: 'Convert to {t}: ({t})',
    widen: 'Declare the variable as {t}',
    brace: 'Add the missing } at the end',
    rename_file: 'Rename the file to {f}',
    stubs: 'Add the missing methods ({n})',
    init: 'Give it {v} as start value',
    assign: 'Assignment instead of a new variable (drop the type)',
    void: 'Add return type void',
    ctor: 'Make it a constructor of {c}',
    todo: 'TODO',
  },
};
const say = (lang, key, p = {}) => Object.entries(p).reduce((s, [k, v]) => s.split('{' + k + '}').join(String(v)), (T[lang] || T.de)[key]);

const lineOf = (text, n) => text.split('\n')[n - 1] || '';
const codeEnd = (line) => {
  // End of the code on a line, before a trailing // comment.
  let inStr = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === '/' && line[i + 1] === '/') return line.slice(0, i).replace(/\s+$/, '').length;
  }
  return line.replace(/\s+$/, '').length;
};

function symbolDetail(problem) {
  const line = (problem.details || []).find((d) => d.startsWith('symbol:')) || '';
  const m = line.match(/^symbol:\s*(class|variable|method|constructor)?\s*([\w$]+)(\(([^)]*)\))?/);
  const loc = (problem.details || []).find((d) => d.startsWith('location:')) || '';
  const lm = loc.match(/^location:\s*(?:variable\s+[\w$]+\s+of\s+type\s+([\w$.<>]+)|class\s+([\w$.<>]+)|interface\s+([\w$.<>]+))/);
  return { kind: m ? m[1] || 'variable' : null, name: m ? m[2] : null, args: m && m[4] != null ? m[4] : null, location: lm ? lm[1] || lm[2] || lm[3] : null };
}

function best(name, candidates, max = 2) {
  const seen = new Set();
  return candidates
    .filter((c) => c && c !== name && !seen.has(c) && seen.add(c))
    .map((c) => ({ c, d: distance(name, c, max) }))
    .filter((x) => x.d <= Math.max(1, Math.min(max, Math.floor(name.length / 3))) || x.c.toLowerCase() === name.toLowerCase())
    .sort((x, y) => x.d - y.d)
    .slice(0, 3)
    .map((x) => x.c);
}

/** Quick fixes for one javac problem in `file` (its current text), or []. */
export function quickFixes(problem, { pm, file, text, lang }) {
  const ex = explainProblem(problem, lang);
  const out = [];
  const ctx = makeCtx(pm, file, text);
  const a = ctx.a;
  const lines = text.split('\n');
  const L = Math.min(Math.max(1, problem.line), lines.length);
  const line = lines[L - 1] || '';
  const at = offsetAt(a, L, Math.max(1, problem.column));
  const edit = (sl, sc, el, ec, t) => ({ file, range: [sl, sc, el, ec], text: t });

  switch (ex.id) {
    case 'semicolon': {
      // javac points just behind the last token of the statement.
      let l = L;
      let col = Math.max(1, problem.column);
      const before = line.slice(0, col - 1);
      if (!before.trim()) {
        // At the start of a line: the semicolon belongs at the end of the code line above.
        l = L - 1;
        while (l > 1 && !lineOf(text, l).trim()) l--;
        col = codeEnd(lineOf(text, l)) + 1;
      } else if (/\s$/.test(before)) col = before.replace(/\s+$/, '').length + 1;
      out.push({ title: say(lang, 'semicolon'), preferred: true, edits: [edit(l, col, l, col, ';')] });
      break;
    }
    case 'symbol': {
      const sym = symbolDetail(problem);
      if (!sym.name) break;
      if (sym.kind === 'class') {
        const known = IMPORTS[sym.name] ? IMPORTS[sym.name] + '.' + sym.name : API[sym.name] && API[sym.name].pkg !== 'java.lang' ? API[sym.name].pkg + '.' + sym.name : null;
        const projectOther = pm.list.find((c) => c.simple === sym.name && c.pkg && ctx.cur && c.pkg !== ctx.cur.pkg);
        const q = projectOther ? projectOther.fileClass : known;
        if (q && !JAVA_LANG.has(sym.name)) {
          const e = importEdit(text, q);
          if (e) out.push({ title: say(lang, 'import', { q }), preferred: true, edits: [edit(e.line, 1, e.line, 1, e.text)] });
        }
        const names = [...pm.list.map((c) => c.simple), ...Object.keys(API), ...Object.keys(IMPORTS), ...JAVA_LANG];
        for (const to of best(sym.name, names)) out.push(renameAt(to));
        break;
      }
      if (sym.kind === 'method') {
        let names = [];
        const owner = sym.location ? projectClass(pm, sym.location.replace(/<.*>/, ''), ctx.cur) : ctx.cur;
        if (owner) {
          const seen = new Set();
          const queue = [owner];
          while (queue.length) {
            const c = queue.shift();
            if (!c || seen.has(c.fileClass)) continue;
            seen.add(c.fileClass);
            names.push(...c.methods.map((m) => m.name));
            for (const p of c.parents || []) queue.push(pm.byName[p]);
          }
        } else if (sym.location) {
          const lib = sym.location.replace(/<.*>/, '').split('.').pop();
          if (API[lib]) names = libMembers(lib, false, {}, lang).concat(libMembers(lib, true, {}, lang)).filter((m) => !m.field).map((m) => m.name);
        }
        for (const to of best(sym.name, names)) out.push(renameAt(to));
        break;
      }
      // A variable (or a field of another object).
      let names = [];
      if (sym.location && !ctx.cur || (sym.location && ctx.cur && sym.location !== ctx.cur.simple && sym.location !== ctx.cur.fileClass)) {
        const owner = projectClass(pm, sym.location.replace(/<.*>/, ''), ctx.cur);
        if (owner) names = collectFields(owner);
      } else {
        names = localsAt(a, at).map((d) => d.name);
        if (ctx.cur) names.push(...collectFields(ctx.cur));
        names.push(...a.decls.filter((d) => d.kind === 'field').map((d) => d.name));
      }
      for (const to of best(sym.name, names)) out.push(renameAt(to));
      break;
    }
    case 'missingReturn': {
      // javac points at the method's closing brace.
      const m = methodAt(a, Math.max(0, at - 1)) || methodAt(a, at);
      const member = m && a.members.find((x) => x.body === m);
      const type = member ? member.type : null;
      if (!type || type === 'void') break;
      const v = defaultValue(type);
      const closeLine = posAt(a, m.close).lineNumber;
      const indent = (lineOf(text, closeLine).match(/^\s*/) || [''])[0] + '    ';
      out.push({ title: say(lang, 'ret', { v }), preferred: true, edits: [edit(closeLine, 1, closeLine, 1, `${indent}return ${v};\n`)] });
      break;
    }
    case 'lossy': {
      const mm = problem.message.match(/from (\S+) to (\S+)$/);
      if (!mm) break;
      const target = mm[2];
      // The expression runs from javac's column to the end of the argument or statement.
      const m = a.masked;
      let depth = 0;
      let end = at;
      for (; end < m.length; end++) {
        const c = m[end];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') {
          if (depth === 0) break;
          depth--;
        } else if ((c === ';' || c === ',') && depth === 0) break;
      }
      const exprText = text.slice(at, end).replace(/\s+$/, '');
      if (!exprText) break;
      const simple = /^[\w$.]+(\([^()]*\))?$/.test(exprText);
      const s = posAt(a, at);
      const e = posAt(a, at + exprText.length);
      out.push({ title: say(lang, 'cast', { t: target }), preferred: true, edits: [edit(s.lineNumber, s.column, e.lineNumber, e.column, `(${target}) ${simple ? exprText : '(' + exprText + ')'}`)] });
      // Or: the variable on the left takes the wider type.
      const decl = line.match(new RegExp(`^(\\s*(?:final\\s+)?)(${target})(\\s+[\\w$]+\\s*=)`));
      if (decl) out.push({ title: say(lang, 'widen', { t: mm[1] }), edits: [edit(L, decl[1].length + 1, L, decl[1].length + 1 + target.length, mm[1])] });
      break;
    }
    case 'eof': {
      const last = lines.length;
      out.push({ title: say(lang, 'brace'), preferred: true, edits: [edit(last, lines[last - 1].length + 1, last, lines[last - 1].length + 1, (lines[last - 1].trim() ? '\n' : '') + '}\n')] });
      break;
    }
    case 'fileName': {
      const mm = problem.message.match(/^class (\S+) is public/);
      if (mm) out.push({ title: say(lang, 'rename_file', { f: mm[1] + '.java' }), preferred: true, command: ['renameToClass', problem.file, mm[1]] });
      break;
    }
    case 'notOverride': {
      const mm = problem.message.match(/^(\S+) is not abstract and does not override abstract method (\S+?)\((.*)\) in (\S+)$/);
      if (!mm || !ctx.cur) break;
      const missing = [];
      const seen = new Set();
      const queue = (ctx.cur.parents || []).map((p) => pm.byName[p]);
      while (queue.length) {
        const c = queue.shift();
        if (!c || seen.has(c.fileClass)) continue;
        seen.add(c.fileClass);
        for (const m of c.methods) {
          if (!m.abstract || m.static) continue;
          if (findMember(pm, ctx.cur, m.name, true, m.params.length) && findMember(pm, ctx.cur, m.name, true, m.params.length).cls !== c) continue;
          if (missing.some((x) => x.name === m.name && x.params.length === m.params.length)) continue;
          missing.push(m);
        }
        for (const p of c.parents || []) queue.push(pm.byName[p]);
      }
      if (!missing.length) break;
      const cls = a.blocks.find((b) => b.kind === 'class' && b.name === ctx.cur.simple);
      if (!cls) break;
      const closeLine = posAt(a, cls.close).lineNumber;
      const body = missing.map((m) => {
        const ret = m.returnType || 'void';
        const params = m.params.map((p) => `${p.type} ${p.name}`).join(', ');
        const stmt = ret === 'void' ? `        // ${say(lang, 'todo')}` : `        return ${defaultValue(ret)}; // ${say(lang, 'todo')}`;
        return `\n    @Override\n    public ${ret} ${m.name}(${params}) {\n${stmt}\n    }\n`;
      }).join('');
      out.push({ title: say(lang, 'stubs', { n: missing.length }), preferred: true, edits: [edit(closeLine, 1, closeLine, 1, body)] });
      break;
    }
    case 'uninit': {
      const name = (problem.message.match(/^variable (\S+)/) || [])[1];
      const d = name && localsAt(a, at).find((x) => x.name === name);
      if (!d || d.kind !== 'local') break;
      const after = a.masked.slice(d.end).match(/^\s*[;,]/);
      if (!after) break;
      const v = defaultValue(d.type);
      const p = posAt(a, d.end);
      out.push({ title: say(lang, 'init', { v }), preferred: true, edits: [edit(p.lineNumber, p.column, p.lineNumber, p.column, ' = ' + v)] });
      break;
    }
    case 'already': {
      const name = (problem.message.match(/^variable (\S+)/) || [])[1];
      if (!name) break;
      const m = line.match(new RegExp(`^(\\s*)((?:final\\s+)?[\\w$.<>,\\[\\]\\s]+?\\s+)(${name.replace(/\$/g, '\\$')}\\s*=)`));
      if (m) out.push({ title: say(lang, 'assign'), preferred: true, edits: [edit(L, m[1].length + 1, L, m[1].length + m[2].length + 1, '')] });
      break;
    }
    case 'returnType': {
      const tok = tokenAt(a, at);
      const cls = tok && classAt(a, tok.start);
      if (!tok) break;
      if (cls && cls.name && cls.name !== tok.name && distance(tok.name, cls.name, 3) <= 3) out.push({ title: say(lang, 'ctor', { c: cls.name }), preferred: true, edits: [replaceTok(tok, cls.name)] });
      const p = posAt(a, tok.start);
      out.push({ title: say(lang, 'void'), edits: [edit(p.lineNumber, p.column, p.lineNumber, p.column, 'void ')] });
      break;
    }
    default:
      break;
  }
  return out;

  function collectFields(cls) {
    const names = [];
    const seen = new Set();
    const queue = [cls];
    while (queue.length) {
      const c = queue.shift();
      if (!c || seen.has(c.fileClass)) continue;
      seen.add(c.fileClass);
      names.push(...c.fields.map((f) => f.name));
      for (const p of c.parents || []) queue.push(pm.byName[p]);
    }
    return names;
  }
  function replaceTok(tok, to) {
    const s = posAt(a, tok.start);
    const e = posAt(a, tok.end);
    return edit(s.lineNumber, s.column, e.lineNumber, e.column, to);
  }
  function renameAt(to) {
    const sym = symbolDetail(problem);
    // javac points at the unknown name (for a method call: at the dot or the name).
    let tok = tokenAt(a, at);
    if (!tok || tok.name !== sym.name) tok = a.tokens.find((t) => t.name === sym.name && posAt(a, t.start).lineNumber === L) || tok;
    if (!tok || tok.name !== sym.name) return { title: say(lang, 'rename', { from: sym.name, to }), edits: [] };
    return { title: say(lang, 'rename', { from: sym.name, to }), preferred: false, edits: [replaceTok(tok, to)] };
  }
}
