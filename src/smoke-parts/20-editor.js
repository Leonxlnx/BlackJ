// Smoke steps of the code editor: the caret measured against the rendered text (main window, after
// a font size change, after reopening a file, in the pop-out window), then the Java features on a
// copy of the Tiere example: definition across files, references, rename (local and across files),
// quick fixes for real javac errors, completion, formatting, codelens, sticky headers, the chrome.
import monaco from '../lib/monaco.js';
import { fontLog } from '../lib/editor-fonts.js';
import { quickFixes } from '../lib/editor-quickfix.js';
import { formatJava } from '../lib/editor-format.js';

/**
 * Puts the caret at each position and compares its on-screen x with the x of that character in
 * the rendered line (a DOM Range on the view line's text). Self-contained: it also runs in the
 * pop-out window through executeJavaScript.
 */
async function caretProbe(ed, positions) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  ed.focus();
  for (const p of positions) {
    ed.setPosition(p);
    ed.revealPositionInCenter(p, 1);
    await sleep(280);
    const dom = ed.getDomNode();
    const caret = dom.querySelector('.cursors-layer .cursor');
    if (!caret) {
      out.push({ line: p.lineNumber, col: p.column, err: 'no caret' });
      continue;
    }
    const cr = caret.getBoundingClientRect();
    const cx = cr.left + cr.width / 2;
    const cy = cr.top + cr.height / 2;
    const line = [...dom.querySelectorAll('.view-lines .view-line')].find((el) => {
      const r = el.getBoundingClientRect();
      return cy >= r.top && cy < r.bottom;
    });
    if (!line) {
      out.push({ line: p.lineNumber, col: p.column, err: 'no line' });
      continue;
    }
    const want = ed.getModel().getLineContent(p.lineNumber);
    const shown = line.textContent.replace(/ /g, ' ');
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const idx = p.column - 1;
    let node;
    let seen = 0;
    let hit = null;
    let last = null;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      if (idx < seen + len) {
        hit = { node, off: idx - seen };
        break;
      }
      seen += len;
      last = node;
    }
    const range = document.createRange();
    let x;
    if (hit) {
      range.setStart(hit.node, hit.off);
      range.setEnd(hit.node, hit.off + 1);
      x = range.getBoundingClientRect().left;
    } else if (last && last.nodeValue.length) {
      range.setStart(last, last.nodeValue.length - 1);
      range.setEnd(last, last.nodeValue.length);
      x = range.getBoundingClientRect().right;
    } else x = line.getBoundingClientRect().left;
    out.push({ line: p.lineNumber, col: p.column, caret: Math.round(cx * 100) / 100, char: Math.round(x * 100) / 100, diff: Math.round((cx - x) * 100) / 100, same: shown === want });
  }
  return out;
}

export default async function ({ step, shot, until, wait, A, api, getState, setState, log }) {
  const visibleEditor = () => monaco.editor.getEditors().find((e) => e.getModel() && document.body.contains(e.getDomNode()) && e.getDomNode().offsetParent && /\.java$/.test(decodeURIComponent(e.getModel().uri.path)));
  const editorFor = async (file) => {
    A.openFile(file);
    setState({ editorMode: 'source' });
    await until(() => {
      const e = visibleEditor();
      return !!e && e.getModel().uri.path.endsWith('/' + file);
    }, 8000, 'no editor for ' + file);
    await wait(150);
    return visibleEditor();
  };
  const lineOf = (ed, needle) => ed.getModel().getLinesContent().findIndex((l) => l.includes(needle)) + 1;
  const positionsIn = (ed) => {
    const lines = ed.getModel().getLinesContent();
    const at = (needle, word) => {
      const l = lines.findIndex((x) => x.includes(needle));
      return { lineNumber: l + 1, column: lines[l].indexOf(word || needle) + 1 };
    };
    const ps = [
      { lineNumber: 1, column: 1 },
      at('gassiGegangen = false;'),
      at('gassiGegangen = false;', 'false'),
      at('gassiGegangen = false;', ';'),
      at('return "Wuff!";', 'Wuff'),
      at('ist jetzt gl', 'cklich'),
      at('ergänzt eigene', 'eigene'),
      at('public boolean warGassi()', 'warGassi'),
    ];
    const end = lines.findIndex((x) => x.includes('System.out.println(getName()'));
    ps.push({ lineNumber: end + 1, column: lines[end].length + 1 });
    return ps;
  };
  const check = (label, rows) => {
    const bad = rows.filter((r) => r.err || Math.abs(r.diff) > 1.01 || !r.same);
    const worst = Math.max(...rows.map((r) => (r.err ? 99 : Math.abs(r.diff))));
    return { label, worst, bad, rows };
  };

  let probeDir = null;
  await step('editor: the caret sits on its character (fonts measured, 9 positions, font size, reopen)', async () => {
    await A.openExample('Tiere');
    await until(() => getState().files['Hund.java'], 8000, 'Tiere not open');
    await log('     fonts: ' + fontLog.map((f) => `${f.why}@${f.at}ms loaded=${f.loaded}${f.width ? ' w=' + f.width.toFixed(3) : ''}${f.mono != null ? ' mono=' + f.mono : ''}`).join(' | '));
    if (!document.fonts.check('14px "JetBrains Mono"')) throw new Error('JetBrains Mono not loaded');
    const results = [];
    let ed = await editorFor('Hund.java');
    results.push(check('14px', await caretProbe(ed, positionsIn(ed))));
    await shot('editor-01-caret');
    await A.updateSettings({ fontSize: 17 });
    await wait(400);
    results.push(check('17px', await caretProbe(ed, positionsIn(ed))));
    await A.updateSettings({ fontSize: 14 });
    await wait(300);
    A.closeTab('Hund.java');
    ed = await editorFor('Zoo.java');
    ed = await editorFor('Hund.java');
    results.push(check('reopened', await caretProbe(ed, positionsIn(ed))));
    await A.updateSettings({ theme: 'light' });
    await wait(300);
    results.push(check('light', await caretProbe(ed, positionsIn(ed).slice(0, 4))));
    await shot('editor-01b-caret-light');
    await A.updateSettings({ theme: 'dark' });
    for (const r of results) await log(`     caret ${r.label}: worst ${r.worst}px over ${r.rows.length} positions`);
    const failed = results.filter((r) => r.bad.length);
    if (failed.length) throw new Error('caret off: ' + JSON.stringify(failed.map((r) => [r.label, r.bad])));
  });

  await step('editor: the caret sits on its character in the pop-out window', async () => {
    const ev = (code) => api.smoke.panelEval({ panel: 'editor', code });
    const untilAsync = async (fn, ms, what) => {
      const start = Date.now();
      while (!(await fn())) {
        if (Date.now() - start > ms) throw new Error('timeout: ' + what);
        await wait(100);
      }
    };
    A.openFile('Hund.java');
    A.popOut('editor');
    await until(() => !document.querySelector('.editor-panel'), 4000, 'editor still in the main window');
    await untilAsync(() => ev('!!(window.blackjSmoke && window.blackjSmoke.editor() && document.querySelector(".editor-host .view-line") && document.fonts.check(\'14px "JetBrains Mono"\'))'), 20000, 'pop-out editor not ready');
    const lines = getState().files['Hund.java'].content.split('\n');
    const at = (needle, word) => {
      const l = lines.findIndex((x) => x.includes(needle));
      return { lineNumber: l + 1, column: lines[l].indexOf(word || needle) + 1 };
    };
    const positions = [at('gassiGegangen = false;'), at('gassiGegangen = false;', ';'), at('return "Wuff!";', 'Wuff'), at('ist jetzt gl', 'cklich')];
    const rows = await ev(`(${caretProbe.toString()})(window.blackjSmoke.editor(), ${JSON.stringify(positions)})`);
    const r = check('pop-out', rows || []);
    await log(`     caret pop-out: worst ${r.worst}px over ${r.rows.length} positions`);
    await api.smoke.capture({ name: 'editor-02-popout', panel: 'editor' });
    await ev('window.close()');
    await until(() => document.querySelector('.editor-panel') && !getState().layout.detached.length, 6000, 'editor not docked back');
    if (!rows || !rows.length || r.bad.length) throw new Error('caret off in the pop-out: ' + JSON.stringify(r.bad.length ? r.bad : rows));
  });

  await step('editor: go to definition across files, references, rename a local and a method across files', async () => {
    // Work on a copy: the examples stay as they are for the other steps.
    const ok = await A.saveProjectAs('EditorProbe' + (Date.now() % 100000));
    if (!ok) throw new Error('save as failed');
    probeDir = getState().project.dir;
    let ed = await editorFor('Zoo.java');
    // F12 on gehege.hinzufuegen → Gehege.java, on the method's name.
    const l = lineOf(ed, 'gehege.hinzufuegen(new Hund');
    ed.focus();
    ed.setPosition({ lineNumber: l, column: ed.getModel().getLineContent(l).indexOf('hinzufuegen') + 3 });
    ed.trigger('smoke', 'editor.action.revealDefinition', null);
    await until(() => getState().activeTab === 'Gehege.java', 5000, 'definition did not open Gehege.java');
    await until(() => visibleEditor() && /Gehege\.java$/.test(decodeURIComponent(visibleEditor().getModel().uri.path)) && visibleEditor().getPosition().lineNumber === lineOf(visibleEditor(), 'public void hinzufuegen'), 4000, 'caret not on hinzufuegen: ' + JSON.stringify(visibleEditor() && visibleEditor().getPosition()));
    ed = visibleEditor();
    // References of Tier.getName: Gehege (t.getName()) and Hund (getName()), and the declaration.
    ed.setPosition({ lineNumber: lineOf(ed, 't.getName()'), column: ed.getModel().getLineContent(lineOf(ed, 't.getName()')).indexOf('getName') + 2 });
    ed.trigger('smoke', 'editor.action.referenceSearch.trigger', null);
    await until(() => document.querySelector('.reference-zone-widget .ref-tree .monaco-list-row'), 6000, 'no references peek');
    await wait(500);
    const files = [...document.querySelectorAll('.reference-zone-widget .ref-tree .monaco-list-row')].map((r) => r.textContent).join(' | ');
    await log('     references: ' + files);
    if (!/Tier/.test(files) || !/Hund/.test(files) || !/Gehege/.test(files)) throw new Error('references: ' + files);
    await shot('editor-03-references');
    ed.trigger('smoke', 'closeReferenceSearch', null);
    await wait(200);
    // Rename the local summe → gesamt (F2): only that method changes.
    const before = ed.getModel().getValue();
    const sl = lineOf(ed, 'int summe = 0;');
    ed.setPosition({ lineNumber: sl, column: ed.getModel().getLineContent(sl).indexOf('summe') + 2 });
    // The box shows the old name first (Monaco fills it after asking where the name is), then the new one.
    const typeNewName = async (from, to) => {
      const box = () => document.querySelector('.rename-box .rename-input');
      ed.trigger('smoke', 'editor.action.rename', null);
      await until(() => box() && box().offsetParent && box().value === from, 6000, 'no rename box for ' + from);
      await wait(120);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box(), to);
      box().dispatchEvent(new Event('input', { bubbles: true }));
      await until(() => box().value === to, 2000, 'rename box kept ' + box().value);
    };
    await typeNewName('summe', 'gesamt');
    await wait(200);
    await shot('editor-04-rename');
    ed.trigger('smoke', 'acceptRenameInput', null);
    await until(() => getState().files['Gehege.java'].content.includes('int gesamt = 0;'), 5000, 'local not renamed');
    const after = getState().files['Gehege.java'].content;
    if (/\bsumme\b/.test(after) || (after.match(/\bgesamt\b/g) || []).length !== (before.match(/\bsumme\b/g) || []).length) throw new Error('rename local: ' + after);
    // Rename getName (declared in Tier) from a call in Gehege: Tier, Hund and Gehege change.
    const gl = lineOf(ed, 't.getName()');
    ed.setPosition({ lineNumber: gl, column: ed.getModel().getLineContent(gl).indexOf('getName') + 2 });
    await typeNewName('getName', 'gibName');
    ed.trigger('smoke', 'acceptRenameInput', null);
    await until(() => ['Tier.java', 'Hund.java', 'Gehege.java'].every((f) => getState().files[f].content.includes('gibName(') && !getState().files[f].content.includes('getName(')), 6000, 'method not renamed in every file: ' + ['Tier.java', 'Hund.java', 'Gehege.java'].map((f) => f + ':' + getState().files[f].content.includes('gibName(')).join(' '));
    await A.saveAll();
    await A.compile();
    await until(() => getState().compile.state === 'ok', 20000, 'renamed project does not compile: ' + JSON.stringify(getState().compile.problems));
  });

  await step('editor: quick fixes for real javac errors (import, typo, return, semicolon) and generators', async () => {
    const err = await A.newClass('Probe', 'class');
    if (err) throw new Error(err);
    const src = [
      'public class Probe {',
      '    private int punkte;',
      '    private String name;',
      '',
      '    public int doppelt() {',
      '        ArrayList<String> liste = new ArrayList<>();',
      '        liste.add(name);',
      '        punkte = punkte + pukte;',
      '    }',
      '}',
      '',
    ].join('\n');
    A.editFile('Probe.java', src);
    await A.saveFile('Probe.java');
    await A.compile();
    await until(() => getState().compile.state === 'errors', 20000, 'no compile errors');
    const problems = getState().compile.problems.filter((p) => p.file === 'Probe.java');
    await log('     javac: ' + problems.map((p) => p.line + ':' + p.message).join(' | '));
    const pm = A.modelOf(getState().files);
    const titles = problems.map((p) => quickFixes(p, { pm, file: 'Probe.java', text: src, lang: 'de' }).map((f) => f.title));
    await log('     fixes: ' + JSON.stringify(titles));
    const flat = titles.flat().join(' | ');
    if (!flat.includes('Importieren: java.util.ArrayList') || !flat.includes('„punkte“ statt „pukte“')) throw new Error('fixes: ' + flat);
    let ed = await editorFor('Probe.java');
    await until(() => monaco.editor.getModelMarkers({ resource: ed.getModel().uri, owner: 'javac' }).length >= 2, 5000, 'no squiggles');
    // The light bulb menu on the ArrayList line.
    const al = lineOf(ed, 'ArrayList<String> liste');
    ed.setPosition({ lineNumber: al, column: 10 });
    ed.trigger('smoke', 'editor.action.quickFix', null);
    await until(() => document.querySelector('.action-widget .monaco-list-row'), 6000, 'no quick fix menu');
    await wait(300);
    await shot('editor-05-quickfix');
    ed.trigger('smoke', 'hideCodeActionWidget', null);
    document.querySelector('.action-widget') && document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(200);
    // Apply the preferred fix (Umschalt+Alt+.): the import.
    ed.setPosition({ lineNumber: al, column: 10 });
    await ed.getAction('editor.action.autoFix').run();
    await until(() => getState().files['Probe.java'].content.startsWith('import java.util.ArrayList;'), 5000, 'import not added: ' + getState().files['Probe.java'].content.slice(0, 80));
    // The typo: the code action list of that line has the rename to the field.
    const tl = lineOf(ed, 'punkte + pukte');
    ed.setPosition({ lineNumber: tl, column: ed.getModel().getLineContent(tl).indexOf('pukte') + 2 });
    ed.trigger('smoke', 'editor.action.quickFix', null);
    await until(() => [...document.querySelectorAll('.action-widget .monaco-list-row')].some((r) => r.textContent.includes('punkte')), 6000, 'no typo fix in the menu: ' + [...document.querySelectorAll('.action-widget .monaco-list-row')].map((r) => r.textContent).join(' | '));
    ed.trigger('smoke', 'hideCodeActionWidget', null);
    await wait(150);
    ed.executeEdits('smoke', [{ range: new monaco.Range(tl, 1, tl, ed.getModel().getLineMaxColumn(tl)), text: '        punkte = punkte + punkte;' }]);
    // The squiggle leaves the line that was fixed.
    await until(() => !monaco.editor.getModelMarkers({ resource: ed.getModel().uri, owner: 'javac' }).some((m) => m.startLineNumber === tl), 3000, 'squiggle stayed on the fixed line');
    await A.saveFile('Probe.java');
    await A.compile();
    await until(() => getState().compile.state === 'errors' && getState().compile.problems.some((p) => /missing return/.test(p.message)), 20000, 'no missing return: ' + JSON.stringify(getState().compile.problems.map((p) => p.message)));
    ed = await editorFor('Probe.java');
    const rl = lineOf(ed, 'liste.add(name);') + 2;
    await until(() => monaco.editor.getModelMarkers({ resource: ed.getModel().uri, owner: 'javac' }).length, 4000, 'no marker for the missing return');
    ed.setPosition({ lineNumber: rl, column: 5 });
    await ed.getAction('editor.action.autoFix').run();
    await until(() => /return 0;\n\s*\}/.test(getState().files['Probe.java'].content), 5000, 'return not added: ' + getState().files['Probe.java'].content);
    // Missing semicolon: a parse error of its own.
    const semi = getState().files['Probe.java'].content.replace('liste.add(name);', 'liste.add(name)');
    A.editFile('Probe.java', semi);
    await A.saveFile('Probe.java');
    await A.compile();
    await until(() => getState().compile.state === 'errors' && getState().compile.problems.some((p) => p.message === "';' expected"), 20000, 'no semicolon error');
    ed = await editorFor('Probe.java');
    await until(() => monaco.editor.getModelMarkers({ resource: ed.getModel().uri, owner: 'javac' }).length, 4000, 'no marker for the semicolon');
    const ml = monaco.editor.getModelMarkers({ resource: ed.getModel().uri, owner: 'javac' })[0];
    ed.setPosition({ lineNumber: ml.startLineNumber, column: ml.startColumn });
    // The squiggle's hover explains the error in plain German first.
    ed.focus();
    ed.trigger('smoke', 'editor.action.showHover', null);
    await until(() => document.querySelector('.monaco-hover .marker.hover-contents'), 5000, 'no error hover');
    const hoverText = document.querySelector('.monaco-hover .marker.hover-contents').textContent;
    if (!hoverText.includes('Semikolon fehlt')) throw new Error('hover: ' + hoverText);
    await wait(300);
    await shot('editor-05b-squiggle');
    ed.trigger('smoke', 'editor.action.hideHover', null);
    await ed.getAction('editor.action.autoFix').run();
    await until(() => getState().files['Probe.java'].content.includes('liste.add(name);'), 5000, 'semicolon not added: ' + getState().files['Probe.java'].content);
    await A.saveFile('Probe.java');
    await A.compile();
    await until(() => getState().compile.state === 'ok', 20000, 'Probe still has errors: ' + JSON.stringify(getState().compile.problems.map((p) => p.message)));
    // Generators on a field line: getter and setter.
    ed = await editorFor('Probe.java');
    const fl = lineOf(ed, 'private String name;');
    ed.setPosition({ lineNumber: fl, column: 12 });
    ed.trigger('smoke', 'editor.action.quickFix', null);
    await until(() => [...document.querySelectorAll('.action-widget .monaco-list-row')].some((r) => /Getter und Setter für name/.test(r.textContent)), 6000, 'no generator: ' + [...document.querySelectorAll('.action-widget .monaco-list-row')].map((r) => r.textContent).join(' | '));
    await shot('editor-05c-generate');
    ed.trigger('smoke', 'hideCodeActionWidget', null);
    await wait(150);
  });

  await step('editor: completion knows locals, formatting fixes indentation, codelens and sticky headers', async () => {
    let ed = await editorFor('Zoo.java');
    const text = ed.getModel().getValue();
    const l = lineOf(ed, 'gehege.rufeAlle();');
    ed.focus();
    ed.setPosition({ lineNumber: l, column: ed.getModel().getLineMaxColumn(l) });
    ed.trigger('smoke', 'type', { text: '\ngeh' });
    await wait(100);
    ed.trigger('smoke', 'editor.action.triggerSuggest', {});
    await until(() => document.querySelectorAll('.suggest-widget .monaco-list-row').length > 0, 6000, 'no suggestions');
    await wait(500);
    const first = document.querySelector('.suggest-widget .monaco-list-row');
    const firstLabel = (first.getAttribute('aria-label') || first.textContent).split(',')[0];
    await log('     completion first: ' + firstLabel);
    if (!/gehege/.test(firstLabel)) throw new Error('first suggestion ' + firstLabel);
    await shot('editor-06-completion');
    ed.trigger('smoke', 'hideSuggestWidget', {});
    A.editFile('Zoo.java', text);
    await wait(100);
    // Codelens above main.
    await until(() => [...document.querySelectorAll('.editor-panel .codelens-decoration a')].some((a) => a.textContent.includes('Ausführen')), 6000, 'no Ausführen above main');
    // Formatting: a badly indented method comes out right.
    const messy = 'public class Zoo2 {\npublic static void main(String[] args) {\nint x = 3;\nif (x > 2)\nx--;\nswitch (x) {\ncase 2:\nSystem.out.println("zwei");\nbreak;\ndefault:\nbreak;\n}\n}\n}\n';
    const want = 'public class Zoo2 {\n    public static void main(String[] args) {\n        int x = 3;\n        if (x > 2)\n            x--;\n        switch (x) {\n            case 2:\n                System.out.println("zwei");\n                break;\n            default:\n                break;\n        }\n    }\n}\n';
    if (formatJava(messy) !== want) throw new Error('format:\n' + formatJava(messy));
    // Lambdas and anonymous classes passed to a call are blocks, not continuation lines.
    const swing = [
      'public class Spiel {',
      '    public static void main(String[] args) {',
      '        SwingUtilities.invokeLater(() -> {',
      '            JFrame f = new JFrame("Spiel");',
      '            f.setVisible(true);',
      '        });',
      '    }',
      '',
      '    void start() {',
      '        Timer t = new Timer(40, e -> {',
      '            tick();',
      '        });',
      '        addKeyListener(new KeyAdapter() {',
      '            @Override',
      '            public void keyPressed(KeyEvent e) {',
      '                x++;',
      '            }',
      '        });',
      '        knopf.addActionListener(e -> {',
      '            if (x > 3) {',
      '                y();',
      '            }',
      '        });',
      '        int s = summe(1,',
      '                2);',
      '    }',
      '}',
      '',
    ].join('\n');
    if (formatJava(swing) !== swing) throw new Error('format leaves lambdas unchanged:\n' + formatJava(swing));
    const flat = swing.split('\n').map((x) => x.trim()).join('\n');
    if (formatJava(flat) !== swing) throw new Error('format indents lambdas:\n' + formatJava(flat));
    // Sticky headers: scrolled into a long method, its class and method stay on top.
    ed = await editorFor('Gehege.java');
    const last = lineOf(ed, 'return (double)');
    ed.setScrollTop(ed.getTopForLineNumber(last - 1));
    await until(() => document.querySelector('.editor-panel .sticky-widget .sticky-line-content'), 5000, 'no sticky header');
    await wait(300);
    const sticky = [...document.querySelectorAll('.editor-panel .sticky-widget .sticky-line-content')].map((e) => e.textContent.replace(/ /g, ' ')).join(' | ');
    await log('     sticky: ' + sticky);
    if (!/class Gehege/.test(sticky)) throw new Error('sticky ' + sticky);
    await shot('editor-07-sticky');
    ed.setScrollTop(0);
  });

  await step('editor: tabs, breadcrumb outline, view menu, Strg+Mausrad, comment, Strg+D, move line', async () => {
    let ed = await editorFor('Hund.java');
    const original = ed.getModel().getValue();
    ed.setPosition({ lineNumber: lineOf(ed, 'gassiGegangen = true;'), column: 9 });
    await wait(200);
    // Unsaved: the tab shows its dot (autosave comes 1.2 s later).
    const autosave = getState().settings.autosave;
    await A.updateSettings({ autosave: false });
    ed.trigger('smoke', 'type', { text: ' ' });
    await until(() => document.querySelector('.editor-panel .etab.marked'), 3000, 'no unsaved dot');
    await A.updateSettings({ autosave });
    // Breadcrumb: the class segment opens the member list.
    const crumb = document.querySelector('.editor-panel .ecrumbs button.crumb-seg');
    crumb.click();
    await until(() => [...document.querySelectorAll('.menu .menu-item')].some((el) => el.textContent.includes('warGassi')), 3000, 'no outline menu');
    await shot('editor-08-outline');
    [...document.querySelectorAll('.menu .menu-item')].find((el) => el.textContent.includes('warGassi')).click();
    await until(() => ed.getPosition().lineNumber === lineOf(ed, 'public boolean warGassi'), 3000, 'outline did not jump');
    // View menu: the minimap comes and goes.
    document.querySelector('[data-tour="editor-view"]').click();
    await until(() => [...document.querySelectorAll('.menu .menu-item')].some((el) => el.textContent.includes('Übersichtskarte')), 3000, 'no view menu');
    await shot('editor-09-view-menu');
    [...document.querySelectorAll('.menu .menu-item')].find((el) => el.textContent.includes('Übersichtskarte')).click();
    await until(() => document.querySelector('.editor-panel .minimap') && document.querySelector('.editor-panel .minimap').offsetWidth > 0, 3000, 'no minimap');
    await shot('editor-10-minimap');
    document.querySelector('[data-tour="editor-view"]').click();
    await until(() => document.querySelector('.menu .menu-item'), 3000, 'no view menu');
    [...document.querySelectorAll('.menu .menu-item')].find((el) => el.textContent.includes('Übersichtskarte')).click();
    await until(() => !document.querySelector('.editor-panel .minimap') || document.querySelector('.editor-panel .minimap').offsetWidth === 0, 3000, 'minimap stayed');
    // Strg+Mausrad: one step larger, then back.
    const size = getState().settings.fontSize;
    const host = document.querySelector('.editor-panel .editor-host');
    const r = host.getBoundingClientRect();
    host.querySelector('.view-lines').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100, clientX: r.left + 100, clientY: r.top + 100 }));
    await until(() => getState().settings.fontSize === size + 1, 3000, 'ctrl+wheel did not zoom');
    await A.updateSettings({ fontSize: size });
    // Comment, Strg+D, move line.
    const cl = lineOf(ed, 'gassiGegangen = true;');
    ed.setPosition({ lineNumber: cl, column: 9 });
    ed.trigger('keyboard', 'editor.action.commentLine', null);
    if (!/^\s*\/\/ /.test(ed.getModel().getLineContent(cl))) throw new Error('comment: ' + ed.getModel().getLineContent(cl));
    ed.trigger('keyboard', 'editor.action.commentLine', null);
    const gl = lineOf(ed, 'private boolean gassiGegangen;');
    ed.setPosition({ lineNumber: gl, column: ed.getModel().getLineContent(gl).indexOf('gassiGegangen') + 2 });
    ed.trigger('keyboard', 'editor.action.addSelectionToNextFindMatch', null);
    ed.trigger('keyboard', 'editor.action.addSelectionToNextFindMatch', null);
    if (ed.getSelections().length !== 2) throw new Error('ctrl+d selections ' + ed.getSelections().length);
    ed.setPosition({ lineNumber: cl, column: 9 });
    ed.trigger('keyboard', 'editor.action.moveLinesUpAction', null);
    if (!ed.getModel().getLineContent(cl - 1).includes('gassiGegangen = true;')) throw new Error('move line');
    ed.trigger('keyboard', 'undo', null);
    // The source / documentation switch: its thumb glides to the chosen side.
    setState({ editorMode: 'docs' });
    await wait(260);
    const seg = document.querySelector('.editor-panel .eseg');
    if (!(parseFloat(seg.style.getPropertyValue('--seg-x')) > 0)) throw new Error('thumb ' + seg.style.getPropertyValue('--seg-x'));
    setState({ editorMode: 'source' });
    A.editFile('Hund.java', original);
    await A.saveFile('Hund.java');
    ed = await editorFor('Hund.java');
    await shot('editor-11-chrome');
    await A.updateSettings({ theme: 'light' });
    await shot('editor-12-light');
    await A.updateSettings({ theme: 'dark' });
  });
  if (probeDir) await log('     probe project: ' + probeDir);
}
