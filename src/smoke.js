// Scripted end-to-end run for `electron . --smoke=<dir>`: drives the real app (real javac, real
// object bench, JUnit, debugger) and saves screenshots, then quits. Each step goes to smoke.log.
import { getState, setState } from './store.js';
import { api } from './api.js';
import * as A from './actions.js';
import monaco from './lib/monaco.js';
import { resolveReceiver, libMembers } from './lib/completion.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 15000, what = '') {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout' + (what ? ': ' + what : ''));
    await wait(50);
  }
}

export async function runSmoke() {
  document.documentElement.dataset.smoke = '1';
  let failures = 0;
  const log = (line) => api.smoke.log(line);
  const step = async (name, fn) => {
    try {
      await fn();
      await log('ok   ' + name);
    } catch (err) {
      failures++;
      await log('FAIL ' + name + ': ' + (err && err.stack ? err.stack : err));
    }
  };
  const shot = async (name) => {
    await wait(450);
    await api.smoke.capture(name);
  };
  const method = (desc, name) => desc.methods.find((m) => m.name === name);

  await step('home renders', async () => {
    await until(() => document.querySelector('.home-grid'));
    await shot('01-home');
  });
  let tiereDir = null;
  await step('open example Tiere', async () => {
    await A.openExample('Tiere');
    await until(() => document.querySelectorAll('.class-card').length === 5);
    tiereDir = getState().project.dir;
    await shot('02-project');
  });
  await step('compile, objects, live inspector', async () => {
    await A.compile();
    await until(() => getState().compile.state === 'ok' && getState().bench.state === 'ready');
    const hund = await A.describe('Hund');
    await A.createObject('Hund', hund.constructors[0], [{ kind: 'text', text: 'Bello' }, { kind: 'text', text: '3' }], 'bello');
    const katze = await A.describe('Katze');
    await A.createObject('Katze', katze.constructors[0], [{ kind: 'text', text: 'Minka' }, { kind: 'text', text: '5' }], 'minka');
    const gehege = await A.describe('Gehege');
    await A.createObject('Gehege', gehege.constructors[0], [{ kind: 'text', text: 'Streichelzoo' }], 'zoo');
    await A.callMethod({ target: 'zoo', cls: 'Gehege', method: method(gehege, 'hinzufuegen'), args: [{ kind: 'ref', name: 'bello' }] });
    await A.callMethod({ target: 'zoo', cls: 'Gehege', method: method(gehege, 'hinzufuegen'), args: [{ kind: 'ref', name: 'minka' }] });
    await A.callMethod({ target: 'bello', cls: 'Hund', method: method(hund, 'geburtstag'), args: [] });
    A.showInspector('bello', 'bello');
    await until(() => document.querySelectorAll('.inspector .inspect-table tr').length >= 3);
    if (getState().bench.objects.length !== 3) throw new Error('bench has ' + getState().bench.objects.length);
    await shot('03-objects-inspector');
  });
  await step('small screens: 1366x768 and 1280x720 with the side panel as a drawer', async () => {
    await api.smoke.resize({ width: 1366, height: 728 });
    await shot('03a-1366');
    await api.smoke.resize({ width: 1280, height: 680 });
    await shot('03b-1280');
    setState({ tutorOpen: true, side: 'inspect' });
    await until(() => document.querySelector('.side-drawer'));
    await shot('03c-1280-drawer');
    setState({ tutorOpen: false });
    setState({ shortcuts: true });
    await until(() => document.querySelector('.shortcuts'));
    await shot('03d-shortcuts');
    setState({ shortcuts: false });
    await api.smoke.resize({ width: 1440, height: 860 });
    setState({ tutorOpen: true, side: 'inspect' });
  });
  await step('call dialog and result', async () => {
    const hund = await A.describe('Hund');
    A.openDialogBox({ type: 'call', kind: 'new', cls: 'Hund', method: hund.constructors[0] });
    await until(() => document.querySelector('.dialog .statement'));
    await shot('04-call-dialog');
    A.closeDialog();
    const gehege = await A.describe('Gehege');
    await A.callMethod({ target: 'zoo', cls: 'Gehege', method: method(gehege, 'durchschnittsalter'), args: [] });
    const d = getState().dialog;
    if (!d || d.type !== 'result' || d.result.value.text !== '4.5') throw new Error(JSON.stringify(d && d.result));
    A.closeDialog();
  });
  await step('object menu', async () => {
    const el = document.querySelector('.obj');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
    await until(() => document.querySelectorAll('.menu .menu-item').length > 5);
    await shot('05-object-menu');
    A.closeMenu();
  });
  await step('code pad', async () => {
    setState({ dock: 'pad' });
    await A.padRun('bello.getAlter() * 2');
    await A.padRun('int punkte = 10;');
    await A.padRun('punkte + zoo.anzahl()');
    await A.padRun('"Hallo".toUpperCase()');
    await A.padRun('gibtsNicht()');
    const e = getState().pad.entries;
    if (e[0].value.text !== '8' || e[2].value.text !== '12' || e[4].status !== 'error') throw new Error(JSON.stringify(e.map((x) => [x.status, x.value && x.value.text])));
    await shot('06-code-pad');
  });
  await step('run main with keyboard input', async () => {
    const run = A.runMain('Zoo');
    await until(() => getState().bench.state === 'waiting');
    await A.sendInput('Rex');
    await run;
    await until(() => getState().console.some((l) => l.text.includes('Rex sagt Wuff!')));
    await shot('07-console');
  });
  await step('exception shows explanation and line', async () => {
    const gehege = await A.describe('Gehege');
    await A.createObject('Gehege', gehege.constructors[0], [{ kind: 'text', text: 'Leer' }], 'leer');
    await A.callMethod({ target: 'leer', cls: 'Gehege', method: method(gehege, 'hinzufuegen'), args: [{ kind: 'text', text: 'null' }] });
    await A.callMethod({ target: 'leer', cls: 'Gehege', method: method(gehege, 'rufeAlle'), args: [] });
    if (!getState().exception || getState().exception.simpleType !== 'NullPointerException') throw new Error('no NPE');
    await shot('08-exception');
  });
  await step('compile error is explained', async () => {
    const f = getState().files['Hund.java'];
    A.editFile('Hund.java', f.content.replace('gassiGegangen = false;', 'gassiGegangen = false'));
    await A.compile();
    await until(() => getState().compile.state === 'errors');
    const p = getState().compile.problems[0];
    if (!p || !p.message.includes("';' expected")) throw new Error(JSON.stringify(p));
    await shot('09-compile-error');
    A.editFile('Hund.java', f.content);
    await A.compile();
    await until(() => getState().compile.state === 'ok');
  });
  await step('diagram tools: arrange and uses arrows', async () => {
    A.arrange();
    await A.updateSettings({ showUses: false });
    await until(() => document.querySelectorAll('.edges path.uses').length === 0);
    await A.updateSettings({ showUses: true });
    await until(() => document.querySelectorAll('.edges path.uses').length > 0);
    document.querySelector('.diagram-more').click();
    await until(() => document.querySelectorAll('.menu .menu-item').length >= 8);
    await shot('09a-project-menu');
    [...document.querySelectorAll('.menu .menu-item')].find((el) => el.textContent.includes('Als Bild speichern')).click();
    await until(() => [...document.querySelectorAll('.toast')].some((el) => el.textContent.includes('diagram-export.png')), 8000);
  });
  await step('change from outside is picked up', async () => {
    const f = getState().files['Katze.java'];
    await api.smoke.writeFile({ name: 'Katze.java', content: f.content.replace('leben = 7;', 'leben = 9; // von außen') });
    await until(() => getState().files['Katze.java'].content.includes('von außen'), 8000);
    await api.smoke.writeFile({ name: 'Vogel.java', content: 'public class Spatz {\n    public String singe() { return "Tschilp"; }\n}\n' });
    await until(() => getState().files['Vogel.java'], 8000);
  });
  await step('rename fix for class/file name mismatch', async () => {
    await A.compile();
    await until(() => getState().compile.state === 'errors');
    const p = getState().compile.problems.find((x) => /should be declared in a file named/.test(x.message));
    if (!p) throw new Error(JSON.stringify(getState().compile.problems));
    setState({ dock: 'problems' });
    await shot('09b-rename-fix');
    await A.renameToClass('Vogel.java', 'Spatz');
    await until(() => getState().compile.state === 'ok' && getState().files['Spatz.java'], 15000);
  });
  await step('documentation view', async () => {
    A.openFile('Tier.java');
    setState({ editorMode: 'docs' });
    await until(() => document.querySelector('.docs-view .doc-member'));
    await shot('10-docs');
    setState({ editorMode: 'source' });
  });
  await step('command palette', async () => {
    A.openPalette();
    await until(() => document.querySelectorAll('.palette-item').length > 5);
    await shot('11-palette');
    A.closePalette();
  });
  await step('editor right-click menu', async () => {
    A.openFile('Hund.java');
    await until(() => document.querySelector('.editor-host .view-lines .view-line'));
    const el = document.querySelector('.editor-host .view-lines');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 80, clientY: r.top + 60, button: 2 }));
    await until(() => document.querySelectorAll('.menu .menu-item').length >= 6, 5000);
    await shot('11b-editor-menu');
    A.closeMenu();
  });
  await step('completion after a dot knows library and project types', async () => {
    const text = getState().files['Zoo.java'].content;
    const model = A.modelOf(getState().files);
    const zoo = model.byName.Zoo;
    const at = text.indexOf('gehege.rufeAlle');
    const kinds = {};
    for (const expr of ['eingabe', 'name', 'gehege', 'System.out', 'Math', '"x"']) {
      const r = resolveReceiver(text, at, expr, model, zoo);
      kinds[expr] = r ? (r.kind === 'project' ? r.cls.simple : r.cls) + (r.statics ? ' static' : '') : null;
    }
    const want = { eingabe: 'Scanner', name: 'String', gehege: 'Gehege', 'System.out': 'PrintStream', Math: 'Math static', '"x"': 'String' };
    if (JSON.stringify(kinds) !== JSON.stringify(want)) throw new Error(JSON.stringify(kinds));
    const charAt = libMembers('String', false, {}, 'de').find((m) => m.name === 'charAt');
    if (!charAt || !/Position/.test(charAt.doc)) throw new Error(JSON.stringify(charAt));
    // The real popup: type "name." on a new line in Zoo.java, look, then put the file back.
    A.openFile('Zoo.java');
    const editorOf = () => monaco.editor.getEditors().find((e) => e.getModel() && /Zoo\.java$/.test(decodeURIComponent(e.getModel().uri.path)));
    await until(() => editorOf(), 6000, 'no editor for Zoo.java');
    const ed = editorOf();
    const lineNo = ed.getModel().getLinesContent().findIndex((l) => l.includes('eingabe.nextLine')) + 1;
    ed.focus();
    ed.setPosition({ lineNumber: lineNo, column: ed.getModel().getLineMaxColumn(lineNo) });
    ed.trigger('smoke', 'type', { text: '\nname.' });
    await wait(100);
    ed.trigger('smoke', 'editor.action.triggerSuggest', {});
    await until(() => document.querySelectorAll('.suggest-widget .monaco-list-row').length > 5, 6000, 'no suggest widget');
    const labels = [...document.querySelectorAll('.suggest-widget .monaco-list-row')].map((r) => (r.getAttribute('aria-label') || r.textContent).split(',')[0]);
    await log('     suggestions: ' + labels.slice(0, 8).join(' | '));
    if (!labels.some((l) => /charAt|length|compareTo/.test(l))) throw new Error('no String methods: ' + labels.join(' | '));
    await wait(900);
    await shot('11c-completion');
    ed.trigger('smoke', 'hideSuggestWidget', {});
    A.editFile('Zoo.java', text);
    await A.saveFile('Zoo.java');
  });
  await step('AI diff view', async () => {
    const f = getState().files['Hund.java'];
    setState({ dialog: { type: 'diff', file: 'Hund.java', original: f.content, modified: f.content.replace('"Wuff!"', '"Wuff! Wuff!"'), explanation: 'gibLaut() bellt jetzt zweimal.', instruction: 'Lass den Hund zweimal bellen' } });
    await until(() => document.querySelector('.diff-host .monaco-diff-editor'));
    await shot('12-diff');
    A.closeDialog();
  });
  await step('packages and README (Bibliothek)', async () => {
    await A.openExample('Bibliothek');
    await until(() => document.querySelector('.pkg-card') && document.querySelector('.note-card'));
    await A.compile();
    await until(() => getState().compile.state === 'ok' && getState().bench.state === 'ready');
    await shot('13-packages');
    A.enterPackage('medien');
    await until(() => document.querySelectorAll('.class-card').length === 3);
    await shot('14-package-medien');
    A.enterPackage('');
  });
  if (api.tests) {
    await step('JUnit tests', async () => {
      await A.runTests({ all: true });
      const s = getState().tests.summary;
      if (!s || s.total !== 4 || s.passed !== 4) throw new Error(JSON.stringify(s));
      await shot('15-tests');
    });
  }
  if (api.debug) {
    await step('debugger stops at a breakpoint', async () => {
      const file = getState().files['Bibliothek.java'];
      const line = file.content.split('\n').findIndex((l) => l.includes('zahl++')) + 1;
      A.toggleBreakpoint('Bibliothek.java', line);
      const bib = await A.describe('Bibliothek');
      await A.createObject('Bibliothek', bib.constructors[0], [], 'bib');
      const buch = await A.describe('medien.Buch');
      await A.createObject('medien.Buch', buch.constructors[0], [{ kind: 'text', text: 'Momo' }, { kind: 'text', text: 'Ende' }, { kind: 'text', text: '304' }], 'momo');
      await A.callMethod({ target: 'bib', cls: 'Bibliothek', method: method(bib, 'aufnehmen'), args: [{ kind: 'ref', name: 'momo' }] });
      const call = A.callMethod({ target: 'bib', cls: 'Bibliothek', method: method(bib, 'verfuegbar'), args: [] });
      await until(() => getState().debug.paused, 15000);
      const p = getState().debug.paused;
      if (p.frames[0].line !== line) throw new Error('paused at ' + JSON.stringify(p.frames[0]));
      await shot('16-debugger');
      A.toggleBreakpoint('Bibliothek.java', line);
      A.debugCommand('resume');
      await call;
      A.closeDialog();
    });
  }
  await step('library classes: Math, an ArrayList on the bench', async () => {
    A.openDialogBox({ type: 'library', cls: 'Math' });
    await until(() => document.querySelectorAll('.lib-item').length > 20);
    await shot('16b-library');
    const math = (await A.describeLibrary('Math')).desc;
    await A.callMethod({ cls: math.name, method: math.methods.find((m) => m.key === 'max(int,int)'), args: [{ kind: 'text', text: '3' }, { kind: 'text', text: '7' }] });
    const d = getState().dialog;
    if (!d || d.type !== 'result' || d.result.value.text !== '7') throw new Error(JSON.stringify(d && d.result));
    A.closeDialog();
    const list = (await A.describeLibrary('ArrayList')).desc;
    await A.createObject(list.name, list.constructors.find((c) => c.params.length === 0), [], 'liste');
    const obj = getState().bench.objects.find((o) => o.name === 'liste');
    A.openDialogBox({ type: 'library', target: 'liste', cls: obj.className, typeLabel: obj.type });
    await until(() => document.querySelectorAll('.lib-item').length > 10);
    await shot('16c-library-object');
    A.closeDialog();
    await A.callMethod({ target: 'liste', cls: list.name, method: list.methods.find((m) => m.key === 'add(java.lang.Object)'), args: [{ kind: 'ref', name: 'momo' }] });
    await A.callMethod({ target: 'liste', cls: list.name, method: list.methods.find((m) => m.key === 'size()'), args: [] });
    if (getState().dialog.result.value.text !== '1') throw new Error(JSON.stringify(getState().dialog.result));
    A.closeDialog();
  });
  await step('ZIP export and import', async () => {
    const r = await A.exportZip('Bibliothek-export.zip');
    if (!r || r.count < 6) throw new Error(JSON.stringify(r));
    await A.openPath(r.file);
    await until(() => getState().project && getState().project.name === 'Bibliothek' && getState().files['medien/Buch.java'] && getState().project.dir !== r.file);
    if (!/Bibliothek-export/.test(getState().project.dir)) throw new Error(getState().project.dir);
  });
  await step('save as, add class from file, javadoc', async () => {
    const ok = await A.saveProjectAs('Bibliothek Kopie');
    if (!ok || !/Bibliothek Kopie$/.test(getState().project.dir) || !getState().files['medien/Buch.java']) throw new Error(getState().project && getState().project.dir);
    A.enterPackage('medien');
    const added = await A.addClassesFromFiles([tiereDir + '\\Tier.java']);
    const f = getState().files['medien/Tier.java'];
    if (!added || !f || !f.content.startsWith('package medien;')) throw new Error(JSON.stringify(f && f.content.slice(0, 80)));
    await until(() => document.querySelectorAll('.class-card').length === 4);
    A.enterPackage('');
    const doc = await A.generateJavadoc();
    if (!doc || !/doc[\\/]index\.html$/.test(doc.index)) throw new Error(JSON.stringify(doc));
  });
  await step('learn page', async () => {
    A.go('learn');
    await until(() => document.querySelector('.learn-detail'));
    await shot('17-learn');
  });
  await step('settings page', async () => {
    A.go('settings');
    await until(() => document.querySelector('.set-section'));
    await shot('18-settings');
  });
  await step('AI switched off hides every AI control', async () => {
    await A.updateSettings({ aiOff: true });
    A.go('project');
    setState({ tutorOpen: true });
    await until(() => document.querySelector('.panel.side'));
    if ([...document.querySelectorAll('.panel.side .tab-label')].some((el) => /Tutor/.test(el.textContent))) throw new Error('tutor tab still shown');
    if (document.querySelector('.ai-btn')) throw new Error('AI button still shown');
    await shot('18b-ai-off');
    await A.updateSettings({ aiOff: false });
  });
  await step('light theme', async () => {
    await A.openExample('Tiere');
    await A.updateSettings({ theme: 'light' });
    await A.compile();
    await until(() => getState().bench.state === 'ready');
    const hund = await A.describe('Hund');
    await A.createObject('Hund', hund.constructors[0], [{ kind: 'text', text: 'Bello' }, { kind: 'text', text: '3' }], 'bello');
    await shot('19-light');
    await A.updateSettings({ theme: 'dark' });
  });
  await step('english', async () => {
    await A.updateSettings({ lang: 'en' });
    await shot('20-english');
    await A.updateSettings({ lang: 'de' });
  });
  await step('home with recent projects', async () => {
    A.go('home');
    await until(() => document.querySelectorAll('.recent-row').length >= 2);
    await shot('21-home-recent');
    await api.smoke.resize({ width: 1024, height: 680 });
    await shot('22-home-small');
    await api.smoke.resize({ width: 1440, height: 860 });
  });
  await log(failures ? `${failures} step(s) failed` : 'all steps passed');
  await api.smoke.done(failures ? 1 : 0);
}
