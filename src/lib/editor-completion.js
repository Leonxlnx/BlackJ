// Completion for Java the way a student types it: names in scope first (locals, parameters, fields,
// methods with their parameters as tab stops), members after a dot (also after calls like
// liste.get(0).), constructors after "new" with automatic imports, annotations after "@", a
// Javadoc template after "/**" and snippets that fit where the cursor is.
import monaco from './monaco.js';
import API from './jdkApi.json';
import { KEYWORDS } from './keywords.js';
import { libMembers, projectMembers } from './completion.js';
import { localsAt, receiverBefore, classAt, JAVA_KEYWORDS } from './editor-symbols.js';
import { makeCtx, typeOfExpr } from './editor-resolve.js';
import { SNIPPETS, IMPORTS, JAVA_LANG, importEdit } from './editor-snippets.js';

const K = () => monaco.languages.CompletionItemKind;
const SNIP = () => monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

const hole = (i, name) => `\${${i}:${String(name || 'wert').replace(/[$}\\]/g, '')}}`;
const argsSnippet = (names) => names.map((n, i) => hole(i + 1, n)).join(', ');
const paramName = (type, i) => {
  const base = String(type).replace(/<.*>/, '').replace(/\[\]/g, 's').replace(/[^\w]/g, '');
  if (!base) return 'wert' + (i || '');
  return base[0].toLowerCase() + base.slice(1);
};

function importFor(name) {
  if (JAVA_LANG.has(name)) return null;
  if (IMPORTS[name]) return IMPORTS[name] + '.' + name;
  if (API[name] && API[name].pkg && API[name].pkg !== 'java.lang') return API[name].pkg + '.' + name;
  return null;
}

function additionalImport(text, qualified) {
  if (!qualified) return undefined;
  const e = importEdit(text, qualified);
  if (!e) return undefined;
  return [{ range: new monaco.Range(e.line, 1, e.line, 1), text: e.text }];
}

/** Members of a resolved receiver (a project class, a library class, an array). */
export function memberSuggestions(recv, pm, cur, lang, range) {
  const Kind = K();
  const de = lang !== 'en';
  if (recv.kind === 'array') {
    return [{ label: 'length', kind: Kind.Field, detail: 'int', documentation: de ? 'Anzahl der Elemente im Array (ohne Klammern).' : 'Number of elements in the array (no parentheses).', insertText: 'length', range }];
  }
  const owner = recv.kind === 'lib' ? recv.cls : recv.cls.simple;
  const members = recv.kind === 'lib'
    ? libMembers(recv.cls, recv.statics, recv.args || {}, lang)
    : projectMembers(pm, recv.cls, recv.statics, !!cur && (cur.fileClass === recv.cls.fileClass || (cur.parents || []).includes(recv.cls.fileClass)));
  const byName = new Map();
  for (const m of members) {
    const k = (m.field ? 'f:' : 'm:') + m.name;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(m);
  }
  const items = [];
  for (const list of byName.values()) {
    const m = list[0];
    const doc = (list.find((x) => x.doc) || {}).doc || undefined;
    // Project members first, then documented library members, then the rest.
    const sortText = (recv.kind === 'project' ? '0' : doc ? '1' : '2') + m.name;
    if (m.field) {
      items.push({ label: { label: m.name, description: m.ret }, kind: m.isStatic ? Kind.Constant : Kind.Field, detail: `${m.ret} · ${m.owner || owner}`, documentation: doc, insertText: m.name, sortText, range });
      continue;
    }
    // Many overloads (println, valueOf, append …) become one entry that lists them all.
    if (list.length > 3) {
      const sigs = list.map((x) => `${x.name}(${x.params.join(', ')})`).join('\n');
      items.push({ label: { label: m.name, detail: '(…)', description: m.ret }, filterText: m.name, kind: Kind.Method, detail: `${m.ret} · ${de ? `${list.length} Varianten` : `${list.length} variants`}`, documentation: { value: (doc ? doc + '\n\n' : '') + '```java\n' + sigs + '\n```' }, insertText: `${m.name}($1)`, insertTextRules: SNIP(), sortText, range, command: { id: 'editor.action.triggerParameterHints', title: '' } });
      continue;
    }
    for (const x of list) {
      const names = x.params.map((p, i) => (x.names && x.names[i]) || paramName(p, i));
      items.push({
        label: { label: x.name, detail: `(${x.params.map((p, i) => (x.names ? `${p} ${x.names[i]}` : p)).join(', ')})`, description: x.ret },
        filterText: x.name,
        kind: Kind.Method,
        detail: `${x.ret} · ${x.owner || owner}`,
        documentation: x.doc || doc,
        insertText: x.params.length ? `${x.name}(${argsSnippet(names)})` : `${x.name}()`,
        insertTextRules: SNIP(),
        sortText,
        range,
        command: x.params.length ? { id: 'editor.action.triggerParameterHints', title: '' } : undefined,
      });
    }
  }
  return items;
}

/** Where the cursor is: 'top' (outside a class), 'member' (in a class body), 'stmt' (in code). */
function placeAt(a, offset) {
  const b = a.innermostBlock(offset);
  if (!b) return 'top';
  if (b.kind === 'class') return 'member';
  return 'stmt';
}

/** The Javadoc template for the method or class under the cursor's line. */
function javadocFor(model, position, lang) {
  const after = model.getValueInRange({ startLineNumber: position.lineNumber + 1, startColumn: 1, endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 6), endColumn: 1 });
  const head = after.replace(/@\w+(\([^)]*\))?/g, '').split(/[{;]/)[0].replace(/\s+/g, ' ').trim();
  const de = lang !== 'en';
  const lines = ['/**', ` * \${1:${de ? 'Was tut das?' : 'What does it do?'}}`];
  let n = 2;
  const m = head.match(/([A-Za-z_$][\w$<>[\],\s]*?)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/) || head.match(/^()(?:public\s+|protected\s+|private\s+)?([A-Z][\w$]*)\s*\(([^)]*)\)/);
  if (m) {
    const params = m[3].split(',').map((p) => p.trim().split(/\s+/).pop()).filter(Boolean);
    if (params.length) lines.push(' *');
    for (const p of params) lines.push(` * @param ${p} \${${n++}:${de ? 'Bedeutung' : 'meaning'}}`);
    const ret = m[1].trim().split(/\s+/).filter((w) => !/^(public|private|protected|static|final|abstract|synchronized)$/.test(w)).pop();
    if (ret && ret !== 'void' && m[1].trim()) lines.push(` * @return \${${n++}:${de ? 'Ergebnis' : 'result'}}`);
  }
  lines.push(' */');
  return lines.join('\n');
}

export function provideCompletion(model, position, { getState, pm, fileName, lang }) {
  const Kind = K();
  const word = model.getWordUntilPosition(position);
  const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
  const lineText = model.getLineContent(position.lineNumber);
  const lineBefore = lineText.slice(0, word.startColumn - 1);
  const text = model.getValue();
  const offset = model.getOffsetAt(position);
  const ctx = makeCtx(pm, fileName, text);
  const a = ctx.a;
  const de = lang !== 'en';
  const items = [];

  // /** → a Javadoc comment with the method's parameters.
  if (/^\s*\/\*\*\s*$/.test(lineText.slice(0, position.column - 1))) {
    const start = lineText.indexOf('/**') + 1;
    const rest = lineText.slice(position.column - 1);
    const end = /^\s*\*\/\s*$/.test(rest) ? lineText.length + 1 : position.column;
    return { suggestions: [{ label: '/** */', kind: Kind.Snippet, detail: de ? 'Javadoc-Kommentar' : 'Javadoc comment', insertText: javadocFor(model, position, lang), insertTextRules: SNIP(), range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: start, endColumn: end }, sortText: '0' }] };
  }
  // Inside a comment or a string: nothing.
  const masked = a.masked;
  if (offset > 0 && offset <= masked.length && masked[offset - 1] === ' ' && text[offset - 1] !== ' ' && text[offset - 1] !== '\n') return { suggestions: [] };

  // import java.util.|
  const imp = lineBefore.match(/^\s*import\s+(static\s+)?([\w.]*)$/);
  if (imp) {
    const seen = new Set();
    for (const [simple, pkg] of [...Object.entries(IMPORTS), ...Object.entries(API).map(([k, v]) => [k, v.pkg])]) {
      if (!pkg || pkg === 'java.lang') continue;
      const q = pkg + '.' + simple;
      if (seen.has(q)) continue;
      seen.add(q);
      items.push({ label: q, kind: Kind.Class, insertText: q + ';', range: { ...range, startColumn: lineBefore.length - imp[2].length + 1 }, filterText: q });
    }
    return { suggestions: items };
  }

  // After a dot: the members of whatever stands in front of it.
  if (/\.\s*$/.test(lineBefore)) {
    const dotAt = model.getOffsetAt({ lineNumber: position.lineNumber, column: lineBefore.lastIndexOf('.') + 1 });
    const expr = receiverBefore(a, dotAt);
    const recv = expr ? typeOfExpr(ctx, expr, dotAt) : null;
    if (recv) return { suggestions: memberSuggestions(recv, pm, ctx.cur, lang, range) };
    // A package path (java.util.) or something unknown: project methods as a fallback.
    for (const c of pm.list) {
      for (const m of c.methods) {
        if (m.visibility === 'private') continue;
        items.push({ label: { label: m.name, detail: `(${m.params.map((p) => p.type).join(', ')})`, description: c.simple }, filterText: m.name, kind: Kind.Method, detail: `${c.simple} · ${m.returnType}`, documentation: m.doc ? m.doc.text : undefined, insertText: m.params.length ? `${m.name}(${argsSnippet(m.params.map((p) => p.name))})` : `${m.name}()`, insertTextRules: SNIP(), range, sortText: '5' + m.name });
      }
    }
    return { suggestions: items };
  }

  // @Override, @Test …
  if (/@$/.test(lineBefore)) {
    const r = { ...range, startColumn: range.startColumn - 1 };
    const anns = [['Override', de ? 'Überschreibt eine geerbte Methode' : 'Overrides an inherited method'], ['Test', de ? 'JUnit-Testmethode' : 'JUnit test method'], ['BeforeEach', de ? 'Läuft vor jedem Test' : 'Runs before each test'], ['AfterEach', de ? 'Läuft nach jedem Test' : 'Runs after each test'], ['DisplayName', de ? 'Lesbarer Name des Tests' : 'Readable test name'], ['Deprecated', de ? 'Veraltet' : 'Deprecated'], ['FunctionalInterface', ''], ['SuppressWarnings', '']];
    for (const [name, doc] of anns) items.push({ label: '@' + name, kind: Kind.Keyword, detail: doc, insertText: name === 'DisplayName' ? '@DisplayName("${1}")' : '@' + name, insertTextRules: SNIP(), range: r, additionalTextEdits: additionalImport(text, IMPORTS[name] ? IMPORTS[name] + '.' + name : null) });
    return { suggestions: items };
  }

  // new … : constructors with their parameters.
  if (/\bnew\s+$/.test(lineBefore)) {
    for (const c of pm.list) {
      if (c.kind === 'interface' || c.abstract || c.isTest) continue;
      const ctors = c.ctors.length ? c.ctors : [{ params: [] }];
      for (const k of ctors) {
        items.push({ label: { label: c.simple, detail: `(${k.params.map((p) => `${p.type} ${p.name}`).join(', ')})` }, filterText: c.simple, kind: Kind.Constructor, detail: de ? 'Neues Objekt' : 'New object', documentation: k.doc ? k.doc.text : c.doc ? c.doc.text : undefined, insertText: `${c.simple}(${argsSnippet(k.params.map((p) => p.name))})`, insertTextRules: SNIP(), range, sortText: '0' + c.simple, command: k.params.length ? { id: 'editor.action.triggerParameterHints', title: '' } : undefined, additionalTextEdits: c.pkg && ctx.cur && c.pkg !== ctx.cur.pkg ? additionalImport(text, c.fileClass) : undefined });
      }
    }
    const lib = [
      ['ArrayList', 'ArrayList<>()', de ? 'Neue Liste' : 'New list'],
      ['HashMap', 'HashMap<>()', de ? 'Neue Zuordnung' : 'New map'],
      ['HashSet', 'HashSet<>()', de ? 'Neue Menge' : 'New set'],
      ['LinkedList', 'LinkedList<>()', ''],
      ['Scanner', 'Scanner(System.in)', de ? 'Liest von der Tastatur' : 'Reads the keyboard'],
      ['Random', 'Random()', de ? 'Zufallszahlen' : 'Random numbers'],
      ['StringBuilder', 'StringBuilder()', de ? 'Text zusammenbauen' : 'Build text'],
      ['int', 'int[${1:10}]', de ? 'Neues int-Array' : 'New int array'],
      ['String', 'String[${1:10}]', de ? 'Neues String-Array' : 'New String array'],
      ['double', 'double[${1:10}]', de ? 'Neues double-Array' : 'New double array'],
    ];
    for (const [name, body, doc] of lib) items.push({ label: { label: name, detail: body.slice(name.length).replace(/\$\{1:(\d+)\}/, '$1') }, filterText: name, kind: /^[a-z]/.test(name) ? Kind.Keyword : Kind.Class, detail: doc, insertText: body, insertTextRules: SNIP(), range, sortText: '1' + name, additionalTextEdits: additionalImport(text, importFor(name)) });
    return { suggestions: items };
  }

  const place = placeAt(a, offset);
  const cls = classAt(a, offset);
  const className = (cls && cls.name) || (ctx.cur && ctx.cur.simple) || fileName.replace(/\.java$/, '').split('/').pop();
  // Names in scope: locals and parameters (nearest first), then fields and methods of the class.
  if (place === 'stmt') {
    localsAt(a, offset).forEach((d, i) => items.push({ label: { label: d.name, description: d.type || '' }, kind: Kind.Variable, detail: (d.kind === 'param' ? (de ? 'Parameter' : 'parameter') : de ? 'lokale Variable' : 'local variable') + (d.type ? ' · ' + d.type : ''), insertText: d.name, range, sortText: '0' + String(i).padStart(3, '0') }));
  }
  if (place !== 'top' && ctx.cur) {
    for (const m of projectMembers(pm, ctx.cur, false, true)) {
      if (m.field) {
        if (place === 'stmt') items.push({ label: { label: m.name, description: m.ret }, kind: m.isStatic ? Kind.Constant : Kind.Field, detail: `${de ? 'Attribut' : 'field'} · ${m.ret}${m.owner !== ctx.cur.simple ? ' · ' + m.owner : ''}`, documentation: m.doc || undefined, insertText: m.name, range, sortText: '1' + m.name });
      } else if (place === 'stmt') {
        const names = m.params.map((p, i) => (m.names && m.names[i]) || paramName(p, i));
        items.push({ label: { label: m.name, detail: `(${m.params.map((p, i) => `${p} ${names[i]}`).join(', ')})`, description: m.ret }, filterText: m.name, kind: Kind.Method, detail: `${m.ret} · ${m.owner}`, documentation: m.doc || undefined, insertText: m.params.length ? `${m.name}(${argsSnippet(names)})` : `${m.name}()`, insertTextRules: SNIP(), range, sortText: '2' + m.name, command: m.params.length ? { id: 'editor.action.triggerParameterHints', title: '' } : undefined });
      }
    }
  }
  // Snippets that fit here.
  const fileClass = fileName.replace(/\.java$/, '').split('/').pop();
  for (const [prefix, body, dDe, dEn, where, imp2] of SNIPPETS) {
    if (where !== 'any' && where !== place) continue;
    const insert = body.replace(/__CLASS__/g, className).replace(/__FILE__/g, fileClass);
    items.push({ label: { label: prefix, description: de ? dDe : dEn }, kind: Kind.Snippet, detail: de ? dDe : dEn, documentation: { value: '```java\n' + insert.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d/g, '').replace(/\t/g, '    ') + '\n```' }, insertText: insert, insertTextRules: SNIP(), range, sortText: '3' + prefix, additionalTextEdits: additionalImport(text, imp2) });
  }
  // Keywords that make sense here.
  const kwHere = place === 'top' ? ['public', 'class', 'interface', 'enum', 'abstract', 'final', 'import', 'package', 'record']
    : place === 'member' ? ['public', 'private', 'protected', 'static', 'final', 'abstract', 'void', 'int', 'double', 'boolean', 'char', 'long', 'String', 'class', 'interface', 'enum']
      : ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'new', 'this', 'super', 'null', 'true', 'false', 'int', 'double', 'boolean', 'char', 'long', 'final', 'var', 'try', 'catch', 'finally', 'throw', 'instanceof'];
  for (const k of kwHere) {
    if (!JAVA_KEYWORDS.has(k) && k !== 'var' && k !== 'String') continue;
    const entry = KEYWORDS[k];
    items.push({ label: k, kind: Kind.Keyword, insertText: k, range, sortText: '4' + k, documentation: entry ? entry[lang] || entry.de : undefined });
  }
  // Classes: the project's, then the library classes students use, imported on the fly.
  for (const c of pm.list) items.push({ label: { label: c.simple, description: c.pkg || '' }, kind: c.kind === 'interface' ? Kind.Interface : c.kind === 'enum' ? Kind.Enum : Kind.Class, detail: c.doc ? c.doc.text.slice(0, 80) : de ? 'Klasse im Projekt' : 'project class', insertText: c.simple, range, sortText: '5' + c.simple, additionalTextEdits: c.pkg && ctx.cur && c.pkg !== ctx.cur.pkg ? additionalImport(text, c.fileClass) : undefined });
  const libNames = new Set([...Object.keys(API), ...Object.keys(IMPORTS), 'Exception', 'RuntimeException', 'IllegalArgumentException', 'Thread', 'Comparable', 'Runnable', 'Iterable']);
  for (const name of libNames) {
    if (pm.list.some((c) => c.simple === name) || /^(Test|BeforeEach|AfterEach|DisplayName)$/.test(name)) continue;
    const q = importFor(name);
    items.push({ label: { label: name, description: q ? q.slice(0, q.lastIndexOf('.')) : 'java.lang' }, kind: Kind.Class, insertText: name, range, sortText: '6' + name, additionalTextEdits: additionalImport(text, q) });
  }
  return { suggestions: items };
}

