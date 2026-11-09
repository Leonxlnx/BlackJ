// What the editor knows about one Java file beyond colours: every name outside strings and
// comments, the blocks and brackets they sit in, and where each name is declared. Rename, go to
// definition, find references, highlights, the outline and quick fixes are built on it. It reads
// code that does not compile yet and never throws on half-typed input.
import { mask } from './javaParse.js';

export const JAVA_KEYWORDS = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null record sealed permits yield').split(' '));
export const PRIMITIVES = new Set(['int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'void', 'var']);
const MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'final', 'abstract', 'synchronized', 'native', 'default', 'strictfp', 'transient', 'volatile', 'sealed']);
const CONTROL = /^(if|for|while|switch|catch|synchronized|try|do|else|return|new|throw|case|assert|yield)$/;

const cache = new Map();

/** The analysis of one source text (cached by content, so every provider can call it freely). */
export function analyze(src) {
  let a = cache.get(src);
  if (a) return a;
  try {
    a = build(src);
  } catch {
    a = { src, masked: src, lineStarts: [0], tokens: [], blocks: [], parens: [], decls: [], members: [], classes: [] };
  }
  cache.set(src, a);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return a;
}

/** 1-based { lineNumber, column } of an offset. */
export function posAt(a, offset) {
  let lo = 0;
  let hi = a.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (a.lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { lineNumber: lo + 1, column: offset - a.lineStarts[lo] + 1 };
}

export function offsetAt(a, lineNumber, column) {
  const start = a.lineStarts[Math.max(0, Math.min(a.lineStarts.length - 1, lineNumber - 1))] || 0;
  return start + column - 1;
}

/** A range { startLineNumber, startColumn, endLineNumber, endColumn } for offsets [start, end). */
export function rangeOf(a, start, end) {
  const s = posAt(a, start);
  const e = posAt(a, end);
  return { startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: e.lineNumber, endColumn: e.column };
}

const prevChar = (m, i) => {
  let k = i - 1;
  while (k >= 0 && /\s/.test(m[k])) k--;
  return k >= 0 ? { ch: m[k], at: k } : { ch: '', at: -1 };
};
const nextChar = (m, i) => {
  let k = i;
  while (k < m.length && /\s/.test(m[k])) k++;
  return k < m.length ? { ch: m[k], at: k } : { ch: '', at: m.length };
};

function build(src) {
  const { masked } = mask(src);
  const n = masked.length;
  const lineStarts = [0];
  for (let i = 0; i < n; i++) if (src.charCodeAt(i) === 10) lineStarts.push(i + 1);

  // Braces and parentheses, matched (an unclosed one runs to the end of the file).
  const blocks = [];
  const parens = [];
  const bs = [];
  const ps = [];
  for (let i = 0; i < n; i++) {
    const c = masked[i];
    if (c === '{') bs.push(i);
    else if (c === '}') {
      const o = bs.pop();
      if (o !== undefined) blocks.push({ open: o, close: i });
    } else if (c === '(') ps.push(i);
    else if (c === ')') {
      const o = ps.pop();
      if (o !== undefined) parens.push({ open: o, close: i });
    }
  }
  for (const o of bs) blocks.push({ open: o, close: n });
  for (const o of ps) parens.push({ open: o, close: n });
  blocks.sort((x, y) => x.open - y.open);
  parens.sort((x, y) => x.open - y.open);

  // What opens each block, and which block it sits in.
  const open = [];
  for (const b of blocks) {
    while (open.length && open[open.length - 1].close < b.open) open.pop();
    b.parent = open.length ? open[open.length - 1] : null;
    open.push(b);
    let k = b.open - 1;
    while (k >= 0 && !/[;{}]/.test(masked[k])) k--;
    b.headStart = k + 1;
    const head = masked.slice(k + 1, b.open).replace(/@[\w$.]+(\s*\([^)]*\))?/g, ' ').replace(/\s+/g, ' ').trim();
    b.head = head;
    const inType = !b.parent || b.parent.kind === 'class';
    if (/(^|\s)(class|interface|enum|record)\s+[A-Za-z_$]/.test(head) && !/->/.test(head)) {
      b.kind = 'class';
      const m = head.match(/(?:^|\s)(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/);
      b.name = m ? m[1] : null;
    } else if (/\bnew\s+[A-Za-z_$][\w$.]*\s*(<[^>]*>)?\s*\([^]*\)$/.test(head)) b.kind = 'class';
    else if (/->$/.test(head)) b.kind = 'lambda';
    else if (/(^|\W)switch\s*\(/.test(head) && /\)$/.test(head)) b.kind = 'switch';
    else if (inType && /([A-Za-z_$][\w$]*)\s*\([^]*\)\s*(throws\s+[\w$.,\s<>]+)?$/.test(head) && !CONTROL.test(head.split(/[\s(]/)[0])) {
      b.kind = 'method';
      const m = head.match(/([A-Za-z_$][\w$]*)\s*\(/);
      b.name = m ? m[1] : null;
    } else if (inType && /^(static)?$/.test(head)) b.kind = 'init';
    else b.kind = 'block';
  }

  const innermostBlock = (at) => {
    let best = null;
    for (const b of blocks) {
      if (b.open > at) break;
      if (at > b.open && at <= b.close) best = b;
    }
    return best;
  };
  const innermostParen = (at, inside) => {
    let best = null;
    for (const p of parens) {
      if (p.open > at) break;
      if (at > p.open && at <= p.close && (!inside || p.open > inside.open)) best = p;
    }
    return best;
  };

  // Every name outside strings and comments.
  const tokens = [];
  const re = /(?<![\w$])[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(masked))) {
    const name = m[0];
    if (JAVA_KEYWORDS.has(name)) continue;
    const start = m.index;
    const end = start + name.length;
    const p = prevChar(masked, start);
    const q = nextChar(masked, end);
    const dot = p.ch === '.' || (p.ch === ':' && masked[p.at - 1] === ':');
    tokens.push({ name, start, end, dot, dotAt: dot ? p.at : -1, call: q.ch === '(', prev: p.ch, next: q.ch });
  }

  const statementEnd = (from) => {
    let depth = 0;
    for (let i = from; i < n; i++) {
      const c = masked[i];
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') {
        if (depth === 0) return i;
        depth--;
      } else if (c === ';' && depth === 0) return i;
    }
    return n;
  };
  const blockAfter = (i) => {
    const q = nextChar(masked, i + 1);
    let at = q.at;
    // A throws clause between ) and {.
    const rest = masked.slice(at, at + 200).match(/^throws\s+[\w$.,\s<>]+?(?=\{)/);
    if (rest) at = nextChar(masked, at + rest[0].length).at;
    if (masked[at] === '{') return blocks.find((b) => b.open === at) || null;
    return null;
  };

  // Declarations: Type name, Type<A, B> name, Type[] name, Type... name.
  const decls = [];
  const TYPE = String.raw`(?:[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)(?:\s*<[\w$\s.,?<>\[\]]*>)?(?:\s*\[\s*\])*`;
  const declRe = new RegExp(String.raw`(?<![\w$.])(${TYPE})(\s*\.\.\.)?\s+([A-Za-z_$][\w$]*)\s*(?=[=;,):]|\[)`, 'g');
  const seen = new Set();
  while ((m = declRe.exec(masked))) {
    const type = m[1].replace(/\s+/g, '');
    const base = type.replace(/[<[].*$/, '');
    const name = m[3];
    if ((JAVA_KEYWORDS.has(base) && !PRIMITIVES.has(base)) || JAVA_KEYWORDS.has(name) || base === 'void') {
      declRe.lastIndex = m.index + m[1].length;
      continue;
    }
    const start = m.index + m[0].trimEnd().length - name.length;
    addDecl(name, start, type + (m[2] ? '[]' : ''));
    declRe.lastIndex = start + name.length;
  }
  // Untyped lambda parameters: x -> …, (a, b) -> …
  const lamRe = /(?<![\w$])(?:\(([\w$\s,]*)\)|([A-Za-z_$][\w$]*))\s*->/g;
  while ((m = lamRe.exec(masked))) {
    const names = m[1] != null ? m[1].split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s)) : [m[2]];
    // case ROT -> … is a switch rule, not a lambda.
    if (/\bcase\s[^;:{}]*$|\bdefault\s*$/.test(masked.slice(Math.max(0, m.index - 80), m.index))) continue;
    for (const nm of names) {
      const at = m[1] != null ? masked.indexOf(nm, m.index) : m.index;
      if (seen.has(at) || JAVA_KEYWORDS.has(nm)) continue;
      const arrow = masked.indexOf('->', at);
      const body = blockAfter(arrow + 1);
      const p = innermostParen(m.index);
      const end = body ? body.close : p && p.close < n ? p.close : statementEnd(arrow + 2);
      seen.add(at);
      decls.push({ name: nm, start: at, end: at + nm.length, type: null, kind: 'param', scope: [at, end] });
    }
  }

  function addDecl(name, start, type) {
    if (seen.has(start)) return;
    seen.add(start);
    const b = innermostBlock(start);
    const p = innermostParen(start, b);
    const d = { name, start, end: start + name.length, type, kind: 'local', scope: [start, b ? b.close : n], block: b };
    if (p) {
      const head = masked.slice(Math.max(0, p.open - 40), p.open).match(/([A-Za-z_$][\w$]*)\s*$/);
      const word = head ? head[1] : '';
      const body = blockAfter(p.close);
      if (word === 'for') {
        d.scope = [p.open, body ? body.close : statementEnd(p.close + 1)];
      } else if (word === 'catch' || word === 'try') {
        d.kind = word === 'catch' ? 'param' : 'local';
        d.scope = [p.open, body ? body.close : d.scope[1]];
      } else if (body || masked.slice(nextChar(masked, p.close + 1).at, nextChar(masked, p.close + 1).at + 2) === '->') {
        d.kind = 'param';
        const arrow = masked.indexOf('->', p.close);
        const lambdaEnd = !body && arrow >= 0 ? (blockAfter(arrow + 1) || { close: statementEnd(arrow + 2) }).close : null;
        d.scope = [p.open, body ? body.close : lambdaEnd];
        if (body && body.kind === 'method') d.method = body;
      } else if (!b || b.kind === 'class') {
        // Parameters of an abstract or interface method: no body to live in.
        d.kind = 'param';
        d.scope = [p.open, p.close];
      }
    } else if (!b || b.kind === 'class') {
      d.kind = 'field';
      d.scope = [b ? b.open : 0, b ? b.close : n];
      d.owner = b;
    }
    decls.push(d);
    // int a = 1, b = 2; declares b as well.
    if (d.kind === 'local' || d.kind === 'field') {
      const endAt = statementEnd(d.end);
      let depth = 0;
      for (let i = d.end; i < endAt; i++) {
        const c = masked[i];
        if (c === '(' || c === '{' || c === '[' || c === '<') depth++;
        else if (c === ')' || c === '}' || c === ']' || c === '>') depth--;
        else if (c === ',' && depth === 0) {
          const mm = masked.slice(i + 1, endAt).match(/^\s*([A-Za-z_$][\w$]*)\s*(?=[=;,]|$|\[)/);
          if (mm && !JAVA_KEYWORDS.has(mm[1])) {
            const at = i + 1 + mm[0].indexOf(mm[1]);
            if (!seen.has(at)) {
              seen.add(at);
              decls.push({ ...d, name: mm[1], start: at, end: at + mm[1].length });
            }
          }
        }
      }
    }
  }

  // Members: methods and constructors (a name with parameters in a class body), fields, classes.
  const members = [];
  const classes = [];
  for (const b of blocks) {
    if (b.kind !== 'class' || !b.name) continue;
    const idx = masked.lastIndexOf(b.name, b.open);
    if (idx >= 0) classes.push({ name: b.name, kind: 'class', start: idx, end: idx + b.name.length, block: b, owner: b.parent && b.parent.kind === 'class' ? b.parent : null });
  }
  for (const t of tokens) {
    if (!t.call || t.dot) continue;
    const b = innermostBlock(t.start);
    if (!b || b.kind !== 'class') continue;
    const p = prevChar(masked, t.start);
    if (p.ch && !/[\w$>\]);{}]/.test(p.ch)) continue;
    // A call in a field initializer: = foo(…) is preceded by =, handled above; new Foo(…) by "new".
    const before = masked.slice(Math.max(0, t.start - 12), t.start);
    if (/\bnew\s+$/.test(before)) continue;
    const pr = parens.find((x) => x.open === nextChar(masked, t.end).at);
    const body = pr ? blockAfter(pr.close) : null;
    const kind = t.name === b.name ? 'ctor' : 'method';
    let type = null;
    if (kind === 'method') {
      const head = masked.slice(b.open + 1, t.start);
      const last = head.slice(Math.max(head.lastIndexOf(';'), head.lastIndexOf('}'), head.lastIndexOf('{')) + 1).replace(/@[\w$.]+(\s*\([^)]*\))?/g, ' ').trim().split(/\s+(?![^<]*>)/).filter((w) => w && !MODIFIERS.has(w) && !/^<.*>$/.test(w));
      type = last.length ? last[last.length - 1] : null;
      if (!type) continue;
    }
    members.push({ name: t.name, kind, start: t.start, end: t.end, type, owner: b, params: pr ? [pr.open, pr.close] : null, body });
  }
  for (const d of decls) if (d.kind === 'field') members.push({ name: d.name, kind: 'field', start: d.start, end: d.end, type: d.type, owner: d.owner || null });
  members.sort((x, y) => x.start - y.start);

  return { src, masked, lineStarts, tokens, blocks, parens, decls, members, classes, innermostBlock };
}

/** The name at (or right before) an offset. */
export function tokenAt(a, offset) {
  let lo = 0;
  let hi = a.tokens.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = a.tokens[mid];
    if (offset < t.start) hi = mid - 1;
    else if (offset > t.end) lo = mid + 1;
    else return t;
  }
  return null;
}

/** The local variable or parameter a plain (undotted) name refers to, or null (then it is a member or a class). */
export function localFor(a, tok) {
  let best = null;
  for (const d of a.decls) {
    if (d.name !== tok.name || d.kind === 'field') continue;
    if (tok.start < d.scope[0] || tok.start > d.scope[1]) continue;
    // In scope from its declaration on (parameters: the whole method).
    if (d.kind === 'local' && tok.start < d.start) continue;
    if (!best || d.scope[0] >= best.scope[0]) best = d;
  }
  return best;
}

/** The class block a position is in (the innermost one), or null outside any class. */
export function classAt(a, offset) {
  let b = a.innermostBlock(offset);
  while (b && b.kind !== 'class') b = b.parent;
  return b;
}

/** The method or constructor body a position is in. */
export function methodAt(a, offset) {
  let b = a.innermostBlock(offset);
  while (b && b.kind !== 'method') b = b.parent;
  return b;
}

/** The declaration under a token, when the token is one: { kind, name, start, end, … } or null. */
export function declAt(a, tok) {
  return a.decls.find((d) => d.start === tok.start) || a.members.find((m) => m.start === tok.start) || a.classes.find((c) => c.start === tok.start) || null;
}

/**
 * The receiver expression in front of the dot at `dotAt`: "gehege", "this.tiere", "liste.get(0)",
 * "new Hund(\"Rex\", 3)", "\"Hallo\"" (strings come back masked, which is enough to know their type).
 */
export function receiverBefore(a, dotAt) {
  const m = a.masked;
  const ws = (k) => {
    while (k >= 0 && /\s/.test(m[k])) k--;
    return k;
  };
  let i = dotAt - 1;
  let start = -1;
  for (let guard = 0; guard < 16; guard++) {
    i = ws(i);
    if (i < 0) return null;
    // Skip the brackets of a call or an index: liste.get(0). / feld[2].
    while (m[i] === ')' || m[i] === ']') {
      const close = m[i];
      const openCh = close === ')' ? '(' : '[';
      let depth = 0;
      for (; i >= 0; i--) {
        if (m[i] === close) depth++;
        else if (m[i] === openCh && --depth === 0) break;
      }
      i = ws(i - 1);
      if (i < 0) return null;
    }
    if (m[i] === '"') {
      const q = m.lastIndexOf('"', i - 1);
      if (q < 0) return null;
      start = q;
      break;
    }
    if (!/[\w$]/.test(m[i])) return null;
    let j = i;
    while (j >= 0 && /[\w$]/.test(m[j])) j--;
    start = j + 1;
    const k = ws(j);
    if (k >= 2 && m.slice(k - 2, k + 1) === 'new' && !/[\w$]/.test(m[k - 3] || '')) {
      start = k - 2;
      break;
    }
    if (k >= 0 && m[k] === '.') {
      i = k - 1;
      continue;
    }
    break;
  }
  return start < 0 ? null : m.slice(start, dotAt).replace(/\s+/g, ' ').trim();
}

/** Splits "this.a.b(x, y).c" into ["this", "a", "b(x, y)", "c"] (only top-level dots). */
export function splitChain(expr) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of expr) {
    if (ch === '(' || ch === '[' || ch === '<') depth++;
    if (ch === ')' || ch === ']' || ch === '>') depth--;
    if (ch === '.' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Writes to a name: the declaration with a value, x = …, x += …, x++, ++x. */
export function isWrite(a, tok) {
  const m = a.masked;
  const q = nextChar(m, tok.end);
  const two = m.slice(q.at, q.at + 3);
  if (/^=[^=]/.test(two) || /^[+\-*/%&|^]=/.test(two) || /^<<=|^>>=/.test(two) || /^\+\+|^--/.test(two)) return true;
  const p = prevChar(m, tok.start);
  if ((p.ch === '+' && m[p.at - 1] === '+') || (p.ch === '-' && m[p.at - 1] === '-')) return true;
  return false;
}

/** Levenshtein distance, for "did you mean" suggestions (capped: anything above `max` is max + 1). */
export function distance(x, y, max = 3) {
  if (Math.abs(x.length - y.length) > max) return max + 1;
  const prev = new Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      const cost = x[i - 1] === y[j - 1] ? 0 : x[i - 1].toLowerCase() === y[j - 1].toLowerCase() ? 0.5 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + cost);
      diag = tmp;
      rowMin = Math.min(rowMin, prev[j]);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[y.length];
}

/** Every name declared before `offset` that is visible there: locals and parameters, nearest first. */
export function localsAt(a, offset) {
  const out = [];
  const names = new Set();
  const list = a.decls.filter((d) => d.kind !== 'field' && offset >= d.scope[0] && offset <= d.scope[1] && (d.kind !== 'local' || d.end <= offset));
  list.sort((x, y) => y.start - x.start);
  for (const d of list) {
    if (names.has(d.name)) continue;
    names.add(d.name);
    out.push(d);
  }
  return out;
}
