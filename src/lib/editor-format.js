// Java indentation for "Einrücken", for pasted code and for a } typed at the start of a line.
// Only the leading whitespace of a line changes, so it is safe on code that does not compile yet.
// Rules: a block's lines sit one level deeper than the line that opened it and its } lines up with
// that line; case labels one level into a switch, their statements two; a statement that goes on
// in the next line two levels; one statement under an if/for/while/else without braces one level;
// Javadoc stars under the first star; text blocks stay exactly as they are.

/** Per line: the code with strings and comments blanked out, and where the line starts. */
function lex(src) {
  const lines = src.split('\n');
  const out = [];
  let inBlock = false;
  let inText = false;
  for (const raw of lines) {
    const startedInBlock = inBlock;
    const startedInText = inText;
    let code = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      const n = raw[i + 1];
      if (inBlock) {
        if (c === '*' && n === '/') {
          inBlock = false;
          i++;
          code += '  ';
        } else code += ' ';
        continue;
      }
      if (inText) {
        if (raw.startsWith('"""', i)) {
          inText = false;
          code += '"""';
          i += 2;
        } else code += ' ';
        continue;
      }
      if (c === '/' && n === '/') {
        code += ' '.repeat(raw.length - i);
        break;
      }
      if (c === '/' && n === '*') {
        inBlock = true;
        code += '  ';
        i++;
        continue;
      }
      if (raw.startsWith('"""', i)) {
        inText = true;
        code += '"""';
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < raw.length && raw[j] !== c) j += raw[j] === '\\' ? 2 : 1;
        code += c + ' '.repeat(Math.max(0, Math.min(j, raw.length) - i - 1)) + (j < raw.length ? c : '');
        i = j;
        continue;
      }
      code += c;
    }
    out.push({ raw, code, startedInBlock, startedInText });
  }
  return out;
}

const HEADER = /^(?:\}\s*)?(?:(?:else\s+)?if|for|while)\s*\(.*\)$|^(?:\}\s*)?else$|^do$/;
const LABEL = /^(case\b[^;]*?(:|->)|default\s*(:|->))/;

/**
 * The indentation (a string) every line should have, or null for lines to keep as they are
 * (inside a text block). `unit` is one level.
 */
export function indentation(src, unit = '    ') {
  const lines = lex(src);
  const result = [];
  const stack = []; // open braces: { base: level of the statement that opened it, kind, paren }
  let paren = 0;
  // Parens opened since the innermost open brace: a lambda or anonymous class body inside a call
  // is a block of its own, not a continuation of the call.
  const openHere = () => Math.max(0, paren - (stack.length ? stack[stack.length - 1].paren : 0));
  let pending = 0; // braceless if/for/while/else bodies waiting for their statement
  let cont = false; // the previous code line did not end its statement
  let stmtLevel = 0; // level of the first line of the current statement
  let prevHeaderSwitch = false;
  let commentBase = null;

  const plainLevel = (isLabel) => {
    const top = stack[stack.length - 1];
    if (!top) return 0;
    if (top.kind === 'switch') return top.base + (isLabel ? 1 : 2);
    return top.base + 1;
  };

  for (const L of lines) {
    const trimmed = L.raw.trim();
    const code = L.code.trim();
    if (L.startedInText) {
      result.push(null);
      scan(L.code, 0);
      continue;
    }
    if (!trimmed) {
      result.push('');
      continue;
    }
    if (L.startedInBlock) {
      const base = commentBase != null ? commentBase : unit.repeat(plainLevel(false));
      result.push(trimmed.startsWith('*') ? base + ' ' : base);
      continue;
    }
    const lead = (code.match(/^[})\]]+/) || [''])[0];
    const leadBraces = (lead.match(/\}/g) || []).length;
    let level;
    if (leadBraces && stack.length) level = stack[Math.max(0, stack.length - leadBraces)].base;
    else level = plainLevel(LABEL.test(code));
    const commentOnly = !code;
    let extra = 0;
    if (!commentOnly && !leadBraces) {
      if (openHere() > 0) extra =/^\)/.test(code) ? 0 : 2;
      else if (pending && !code.startsWith('{')) extra = pending;
      else if (cont && !code.startsWith('{')) extra = 2;
    }
    if (!commentOnly && !cont && openHere() === 0) stmtLevel = level + (pending && !code.startsWith('{') ? pending : 0);
    if (!commentOnly && code.startsWith('{') && (pending || cont)) stmtLevel = level;
    const indent = unit.repeat(level + extra);
    result.push(indent);
    commentBase = /^\/\*/.test(trimmed) ? indent : null;
    if (commentOnly) continue;
    // What this line leaves open for the next one.
    scan(L.code, leadBraces ? level : stmtLevel);
    const end = code.replace(/\s+$/, '');
    const isHeader = HEADER.test(end) && openHere() === 0;
    const annotation = /^@[\w.]+(\(.*\))?$/.test(end);
    if (/[;{}]$/.test(end)) pending = isHeader ? pending + 1 : 0;
    else if (isHeader) pending++;
    else if (/^\{/.test(code)) pending = 0;
    cont = openHere() === 0 && !isHeader && !annotation && !/[;{}:,]$/.test(end) && !LABEL.test(end);
    if (openHere() > 0) cont = false;
    prevHeaderSwitch = /\bswitch\s*\(.*\)$/.test(end);
  }
  return result;

  function scan(code, base) {
    for (let i = 0; i < code.length; i++) {
      const c = code[i];
      if (c === '{') {
        const before = code.slice(0, i);
        const kind = /\bswitch\s*\(.*\)\s*$/.test(before) || (!before.trim() && prevHeaderSwitch) ? 'switch' : 'block';
        stack.push({ base, kind, paren });
      } else if (c === '}') {
        // Parens left open inside the block (code still being typed) end with it.
        const top = stack.pop();
        if (top) paren = top.paren;
      } else if (c === '(') paren++;
      else if (c === ')') paren = Math.max(0, paren - 1);
    }
  }
}

/** The whole file with every line indented (trailing spaces removed). */
export function formatJava(src, unit = '    ') {
  const ind = indentation(src, unit);
  return src
    .split('\n')
    .map((raw, i) => (ind[i] == null ? raw : raw.trim() ? ind[i] + raw.trim() : ''))
    .join('\n');
}

/** Edits { line, from, to, text } that give lines [first, last] (1-based) their indentation. */
export function indentEdits(src, first, last, unit = '    ') {
  const ind = indentation(src, unit);
  const lines = src.split('\n');
  const edits = [];
  for (let l = Math.max(1, first); l <= Math.min(lines.length, last); l++) {
    const raw = lines[l - 1];
    const want = ind[l - 1];
    if (want == null || !raw.trim()) continue;
    const have = raw.match(/^\s*/)[0];
    if (have !== want) edits.push({ line: l, from: 1, to: have.length + 1, text: want });
  }
  return edits;
}
