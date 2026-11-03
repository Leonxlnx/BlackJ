// The ids a tutorial step may point at. The same table lives in electron/agent-tools.cjs (the
// model learns the ids from there); scripts/test-ai.cjs checks that both agree. No imports.

const P = '((?:[A-Za-z_$][\\w$]*\\/)*[A-Za-z_$][\\w$]*\\.java)';
const plain = (id) => ({ kind: id, re: new RegExp('^' + id.replace(/[-]/g, '\\-') + '$') });

export const TARGETS = [
  ...['compile', 'run-main', 'stop', 'search', 'side-panel', 'state', 'new-class', 'new-package', 'arrange', 'diagram', 'zoom', 'diagram-more', 'readme'].map(plain),
  { kind: 'class', re: /^class:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/ },
  { kind: 'class-new', re: /^class-new:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/ },
  { kind: 'package', re: /^package:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/ },
  plain('bench'),
  { kind: 'object', re: /^object:([A-Za-z_$][\w$]*)$/ },
  plain('library'),
  { kind: 'dock', re: /^dock:(objects|console|pad|tests|problems|debug)$/ },
  ...['console-input', 'pad-input', 'tests-run'].map(plain),
  { kind: 'problem', re: /^problem:([1-9]\d?)$/ },
  plain('editor'),
  { kind: 'editor-tab', re: new RegExp('^editor-tab:' + P + '$') },
  { kind: 'line', re: new RegExp('^line:' + P + ':(\\d{1,5})$') },
  { kind: 'gutter', re: new RegExp('^gutter:' + P + ':(\\d{1,5})$') },
  ...['editor-mode', 'format', 'ai-write', 'explain', 'proposal-accept', 'inspector'].map(plain),
  { kind: 'side-tab', re: /^side-tab:(tutor|inspect)$/ },
  ...['composer', 'tutor-mode', 'new-chat'].map(plain),
  { kind: 'debug', re: /^debug:(resume|stepOver|stepInto|stepOut)$/ },
  { kind: 'rail', re: /^rail:(home|project|learn|settings)$/ },
  { kind: 'settings', re: /^settings:(aiInline|agentWrite|model|java|theme|lang|fontSize)$/ },
  { kind: 'menu', re: /^menu:(new|new:\d{1,2}|static:[A-Za-z_$][\w$]*|runMain|runTests|record|inspectClass|compileNow|open|createTest|explain|delete)$/ },
  { kind: 'menu', re: /^menu:(method:[A-Za-z_$][\w$]*|libMethods|inspect|remove)$/ },
  { kind: 'dialog', re: /^dialog:(arg:\d{1,2}|name|confirm|cancel)$/ },
];

/** "line:Hund.java:12" -> { kind: 'line', arg: 'Hund.java', arg2: 12 }; null for anything else. */
export function parseTarget(id) {
  if (typeof id !== 'string') return null;
  for (const row of TARGETS) {
    const m = id.match(row.re);
    if (!m) continue;
    return { kind: row.kind, arg: m[1] ?? null, arg2: m[2] != null ? Number(m[2]) : null };
  }
  return null;
}
