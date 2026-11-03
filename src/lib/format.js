// Re-indents Java by brace depth (4 spaces per level). It never changes anything but the
// leading whitespace, so it is safe to run on code that does not compile yet.
export function reindent(src, unit = '    ') {
  const lines = src.split('\n');
  let depth = 0;
  let inBlock = false;
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }
    // Count braces outside strings, chars and comments.
    let opens = 0;
    let closesAtStart = 0;
    let closes = 0;
    let seenCode = false;
    let inStr = false;
    let inChr = false;
    const startedInBlock = inBlock;
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      const n = trimmed[i + 1];
      if (inBlock) {
        if (c === '*' && n === '/') { inBlock = false; i++; }
        continue;
      }
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (inChr) {
        if (c === '\\') i++;
        else if (c === "'") inChr = false;
        continue;
      }
      if (c === '/' && n === '/') break;
      if (c === '/' && n === '*') { inBlock = true; i++; continue; }
      if (c === '"') { inStr = true; seenCode = true; continue; }
      if (c === "'") { inChr = true; seenCode = true; continue; }
      if (c === '{') { opens++; seenCode = true; continue; }
      if (c === '}') {
        if (!seenCode && opens === 0) closesAtStart++;
        else if (opens > 0) opens--;
        else closes++;
        seenCode = true;
        continue;
      }
      seenCode = true;
    }
    const level = Math.max(0, depth - closesAtStart);
    const isCommentCont = startedInBlock && !trimmed.startsWith('/*');
    out.push(unit.repeat(level) + (isCommentCont && trimmed.startsWith('*') ? ' ' : '') + trimmed);
    depth = Math.max(0, depth - closesAtStart - closes + opens);
  }
  return out.join('\n');
}
