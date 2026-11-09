// A forgiving reader for one Java source file. It finds the class, what it extends and
// implements, its fields, constructors and methods with their Javadoc, so the diagram and
// the call dialogs work even before (or without) a successful compile.

const MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'final', 'abstract', 'synchronized', 'native', 'default', 'strictfp', 'transient', 'volatile', 'sealed', 'non-sealed']);

/** Replaces comments and string contents with spaces, keeping every index and line break. */
export function mask(src) {
  const n = src.length;
  const out = [];
  const docs = [];
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      const text = src.slice(i, end);
      if (text.startsWith('/**')) docs.push({ start: i, end, text });
      out.push(text.replace(/[^\n]/g, ' '));
      i = end;
      continue;
    }
    if (c === '"' && src.startsWith('"""', i)) {
      let j = src.indexOf('"""', i + 3);
      const end = j < 0 ? n : j + 3;
      out.push('"' + src.slice(i + 1, end - 1).replace(/[^\n]/g, ' ') + '"');
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      const end = j < n && src[j] === c ? j + 1 : j;
      const len = end - i;
      out.push(c + ' '.repeat(Math.max(0, len - (src[end - 1] === c && len > 1 ? 2 : 1))) + (src[end - 1] === c && len > 1 ? c : ''));
      i = end;
      continue;
    }
    out.push(c);
    i++;
  }
  return { masked: out.join(''), docs };
}

function stripGenerics(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^<>]*>/g, '');
  } while (s !== prev);
  return s;
}

function splitTop(s, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    if (ch === '>' || ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function visibilityOf(mods) {
  if (mods.includes('public')) return 'public';
  if (mods.includes('protected')) return 'protected';
  if (mods.includes('private')) return 'private';
  return 'package';
}

function cleanDoc(text) {
  const lines = text.replace(/^\/\*\*/, '').replace(/\*\/$/, '').split('\n').map((l) => l.replace(/^\s*\*?\s?/, ''));
  const desc = [];
  const params = {};
  let ret = null;
  let current = null;
  for (const line of lines) {
    const p = line.match(/^@param\s+(\w+)\s*(.*)$/);
    const r = line.match(/^@return\s*(.*)$/);
    if (p) { params[p[1]] = p[2]; current = ['p', p[1]]; continue; }
    if (r) { ret = r[1]; current = ['r']; continue; }
    if (/^@\w+/.test(line)) { current = ['x']; continue; }
    if (current && current[0] === 'p') params[current[1]] += (line ? ' ' + line : '');
    else if (current && current[0] === 'r') ret += (line ? ' ' + line : '');
    else if (!current) desc.push(line);
  }
  const strip = (s) => (s || '').replace(/<\/?[a-z][^>]*>/gi, '').replace(/\{@\w+\s+([^}]*)\}/g, '$1').trim();
  return { text: strip(desc.join(' ').replace(/\s+/g, ' ')), params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, strip(v)])), returns: ret ? strip(ret) : null };
}

function parseParams(s) {
  if (!s.trim()) return [];
  return splitTop(s).map((p) => {
    const clean = p.replace(/@\w+(\([^)]*\))?/g, '').replace(/\bfinal\b/g, '').trim();
    const m = clean.match(/^(.*?)\s*([A-Za-z_$][\w$]*)\s*((?:\[\s*\])*)$/s);
    if (!m) return { type: clean, name: '' };
    return { type: (m[1].trim() + m[3].replace(/\s/g, '')).replace(/\s+/g, ' '), name: m[2] };
  });
}

export function parseJava(src, fileClassName) {
  try {
    return parse(src, fileClassName);
  } catch {
    return { name: fileClassName, kind: 'class', abstract: false, extends: [], implements: [], fields: [], methods: [], ctors: [], constants: [], hasMain: false, masked: src, broken: true };
  }
}

function parse(src, fileClassName) {
  const { masked, docs } = mask(src);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const docBefore = (start) => {
    for (let k = docs.length - 1; k >= 0; k--) {
      const d = docs[k];
      if (d.end > start) continue;
      const between = src.slice(d.end, start);
      if (/^\s*(@[\w.]+(\([^)]*\))?\s*)*$/.test(between)) return cleanDoc(d.text);
      return null;
    }
    return null;
  };

  // The top-level type: prefer the one named like the file.
  const typeRe = /\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;
  let decl = null;
  let m;
  while ((m = typeRe.exec(masked))) {
    let depth = 0;
    for (let k = 0; k < m.index; k++) {
      if (masked[k] === '{') depth++;
      else if (masked[k] === '}') depth--;
    }
    if (depth !== 0) continue;
    if (!decl || m[2] === fileClassName) decl = m;
    if (m[2] === fileClassName) break;
  }
  const info = { name: fileClassName, kind: 'class', abstract: false, visibility: 'package', extends: [], implements: [], fields: [], methods: [], ctors: [], constants: [], hasMain: false, masked, doc: null, line: 1 };
  if (!decl) return info;

  const declStart = (() => {
    let k = decl.index;
    while (k > 0 && !/[;}]/.test(masked[k - 1])) k--;
    return k;
  })();
  const mods = masked.slice(declStart, decl.index).replace(/@\w+(\([^)]*\))?/g, ' ').trim().split(/\s+/);
  info.name = decl[2];
  info.kind = decl[1] === 'class' ? (mods.includes('abstract') ? 'abstract' : 'class') : decl[1] === 'record' ? 'class' : decl[1];
  info.abstract = mods.includes('abstract');
  info.visibility = visibilityOf(mods);
  const firstNonSpace = src.slice(declStart).search(/\S/);
  info.doc = docBefore(declStart + Math.max(0, firstNonSpace));
  info.line = lineOf(decl.index);

  const open = masked.indexOf('{', decl.index);
  if (open < 0) return info;
  const header = stripGenerics(masked.slice(decl.index + decl[0].length, open));
  const ext = header.match(/\bextends\s+([\w$.\s,]+?)(?=\bimplements\b|$)/);
  const impl = header.match(/\bimplements\s+([\w$.\s,]+)$/);
  const names = (s) => (s ? s.split(',').map((x) => x.trim().split('.').pop()).filter(Boolean) : []);
  info.extends = names(ext && ext[1]);
  info.implements = names(impl && impl[1]);

  // Walk the class body at depth 1.
  let depth = 0;
  let paren = 0;
  let stmtStart = open + 1;
  let firstStatement = true;
  for (let i = open; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(') paren++;
    else if (ch === ')') paren--;
    if (ch === '{') {
      depth++;
      if (depth === 2 && paren === 0) {
        const raw = masked.slice(stmtStart, i);
        const lead = raw.search(/\S/);
        handleMember(raw, lead < 0 ? i : stmtStart + lead, true);
      }
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 1) stmtStart = i + 1;
      if (depth === 0) {
        // An enum with only constants has no ";" before its closing brace.
        if (info.kind === 'enum' && firstStatement) handleMember(masked.slice(stmtStart, i), stmtStart, false);
        break;
      }
      continue;
    }
    if (depth === 1 && paren === 0 && ch === ';') {
      const raw = masked.slice(stmtStart, i);
      const lead = raw.search(/\S/);
      handleMember(raw, lead < 0 ? i : stmtStart + lead, false);
      stmtStart = i + 1;
    }
  }

  function handleMember(rawText, start, hasBody) {
    const text = rawText.replace(/@[\w.]+(\([^)]*\))?/g, ' ').trim();
    if (!text) return;
    if (info.kind === 'enum' && firstStatement) {
      firstStatement = false;
      if (/^[A-Za-z_$][\w$]*(\s*\([^)]*\))?(\s*,\s*[A-Za-z_$][\w$]*(\s*\([^)]*\))?)*\s*,?$/.test(text)) {
        info.constants = splitTop(text).map((c) => c.trim().replace(/\([\s\S]*$/, '')).filter(Boolean);
        return;
      }
    }
    firstStatement = false;
    if (/^(static\s*)?$/.test(text)) return; // initializer block
    if (/\b(class|interface|enum|record)\s+[A-Za-z_$]/.test(text)) return; // nested type
    const doc = docBefore(start);
    const line = lineOf(start);
    const parenIdx = text.indexOf('(');
    const eqIdx = text.indexOf('=');
    if (parenIdx >= 0 && (eqIdx < 0 || parenIdx < eqIdx)) {
      const mm = text.match(/^([\s\S]*?)([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*(throws[\s\S]*)?$/);
      if (!mm) return;
      const before = mm[1].trim();
      const tokens = before ? before.split(/\s+(?![^<]*>)/) : [];
      const mods = tokens.filter((t) => MODIFIERS.has(t));
      const rest = tokens.filter((t) => !MODIFIERS.has(t) && !/^<.*>$/.test(t));
      const params = parseParams(mm[3]);
      const entry = { name: mm[2], params, visibility: visibilityOf(mods), static: mods.includes('static'), abstract: mods.includes('abstract') || (!hasBody && info.kind !== 'interface') || (info.kind === 'interface' && !hasBody && !mods.includes('static')), doc, line };
      if (rest.length === 0 && mm[2] === info.name) info.ctors.push(entry);
      else if (rest.length > 0) {
        entry.returnType = rest.join(' ');
        if (info.kind === 'interface' && !mods.includes('private')) entry.visibility = 'public';
        info.methods.push(entry);
      }
      return;
    }
    const declText = (eqIdx >= 0 ? text.slice(0, eqIdx) : text).trim();
    for (const [k, part] of splitTop(declText).entries()) {
      const p = part.trim();
      if (k === 0) {
        const fm = p.match(/^([\s\S]*?)([A-Za-z_$][\w$]*)\s*((?:\[\s*\])*)$/);
        if (!fm) return;
        const tokens = fm[1].trim().split(/\s+(?![^<]*>)/).filter(Boolean);
        const mods = tokens.filter((t) => MODIFIERS.has(t));
        const type = tokens.filter((t) => !MODIFIERS.has(t)).join(' ') + fm[3].replace(/\s/g, '');
        if (!type) return;
        info.fields.push({ name: fm[2], type, visibility: info.kind === 'interface' ? 'public' : visibilityOf(mods), static: mods.includes('static') || info.kind === 'interface', final: mods.includes('final'), doc, line });
      } else {
        const prev = info.fields[info.fields.length - 1];
        const nm = p.split('=')[0].trim();
        if (prev && /^[A-Za-z_$][\w$]*$/.test(nm)) info.fields.push({ ...prev, name: nm });
      }
    }
  }

  info.hasMain = info.methods.some((x) => x.name === 'main' && x.static && x.params.length === 1);
  return info;
}

/** Project classes this source mentions, other than its own parents. */
export function usesOf(info, classNames) {
  const own = new Set([info.name, ...info.extends, ...info.implements]);
  const out = [];
  for (const n of classNames) {
    if (own.has(n)) continue;
    if (new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b').test(info.masked)) out.push(n);
  }
  return out;
}

/**
 * Code blocks for scope colouring, like BlueJ: [{ kind: 'class'|'method'|'block', start, end, depth }]
 * with 1-based start/end lines (the lines of the opening and closing brace).
 */
export function scopeRanges(src) {
  const { masked } = mask(src);
  const out = [];
  const stack = [];
  let line = 1;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '\n') {
      line++;
      continue;
    }
    if (ch === '{') {
      // What opens this block: look back to the previous statement boundary.
      let k = i - 1;
      while (k >= 0 && !/[;{}]/.test(masked[k])) k--;
      const head = masked.slice(k + 1, i).replace(/\s+/g, ' ').trim();
      let kind = 'block';
      if (/\b(class|interface|enum|record)\s+[A-Za-z_$]/.test(head)) kind = 'class';
      else if (/\)\s*(throws\s+[\w.,\s]+)?$/.test(head) && !/^(if|for|while|switch|catch|synchronized|else\s+if)\b/.test(head) && !/->/.test(head) && /[A-Za-z_$][\w$]*\s*\(/.test(head) && !/\bnew\s/.test(head)) kind = 'method';
      else if (head === '' && stack.length && stack[stack.length - 1].kind === 'class') kind = 'method';
      stack.push({ kind, start: line, depth: stack.length });
    } else if (ch === '}') {
      const open = stack.pop();
      if (open) out.push({ ...open, end: line });
    }
  }
  return out;
}

/** "int alter" style signature used in menus and the diagram. */
export function signature(m, withNames = true) {
  const ps = m.params.map((p) => (withNames && p.name ? `${p.type} ${p.name}` : p.type)).join(', ');
  return `${m.name}(${ps})`;
}
