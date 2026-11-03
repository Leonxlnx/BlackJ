// A small line diff for the tutor's change cards: common prefix and suffix first, then an LCS on
// the part in between. Rows carry their line numbers; unchanged stretches fold into gaps.

const split = (s) => (s ? String(s).replace(/\r\n/g, '\n').split('\n') : []);

/** Edit script between two line arrays, as { type: 'ctx'|'add'|'del', text } rows. */
function script(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  const out = a.slice(0, pre).map((text) => ({ type: 'ctx', text }));
  if (am.length * bm.length > 600 * 600) {
    // Too big to compare line by line: one replaced block.
    out.push(...am.map((text) => ({ type: 'del', text })), ...bm.map((text) => ({ type: 'add', text })));
  } else {
    const n = am.length;
    const m = bm.length;
    const len = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i][j] = am[i] === bm[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) {
        out.push({ type: 'ctx', text: am[i] });
        i++;
        j++;
      } else if (i < n && (j >= m || len[i + 1][j] >= len[i][j + 1])) out.push({ type: 'del', text: am[i++] });
      else out.push({ type: 'add', text: bm[j++] });
    }
  }
  out.push(...a.slice(a.length - suf).map((text) => ({ type: 'ctx', text })));
  return out;
}

/**
 * Rows to show for a change from `before` to `after`: changed lines with `context` lines around
 * them, and { type: 'gap' } where unchanged lines were left out. Also the added and removed counts.
 */
export function lineDiff(before, after, context = 2) {
  const all = script(split(before), split(after));
  let a = 0;
  let b = 0;
  for (const r of all) {
    if (r.type !== 'add') r.a = ++a;
    if (r.type !== 'del') r.b = ++b;
  }
  const keep = new Array(all.length).fill(false);
  all.forEach((r, i) => {
    if (r.type === 'ctx') return;
    for (let k = Math.max(0, i - context); k <= Math.min(all.length - 1, i + context); k++) keep[k] = true;
  });
  // Empty context lines at the edges of a hunk only add height.
  const blankCtx = (i) => all[i].type === 'ctx' && !all[i].text.trim();
  for (let i = 0; i < all.length; i++) {
    if (!keep[i] || (i > 0 && keep[i - 1])) continue;
    for (let k = i; k < all.length && keep[k] && blankCtx(k); k++) keep[k] = false;
  }
  for (let i = all.length - 1; i >= 0; i--) {
    if (!keep[i] || (i < all.length - 1 && keep[i + 1])) continue;
    for (let k = i; k >= 0 && keep[k] && blankCtx(k); k--) keep[k] = false;
  }
  const rows = [];
  let gap = false;
  all.forEach((r, i) => {
    if (keep[i]) {
      if (gap && rows.length) rows.push({ type: 'gap' });
      gap = false;
      rows.push(r);
    } else gap = true;
  });
  return { rows, added: all.filter((r) => r.type === 'add').length, removed: all.filter((r) => r.type === 'del').length };
}
