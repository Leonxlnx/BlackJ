// Scripted end-to-end run for `electron . --smoke=<dir>`: drives the real app (real javac, real
// object bench, JUnit, debugger) and saves screenshots, then quits. Each step goes to smoke.log.
import { getState, setState } from './store.js';
import { api } from './api.js';
import * as A from './actions.js';
import monaco from './lib/monaco.js';
import { resolveReceiver, libMembers, callAt } from './lib/completion.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 15000, what = '') {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout' + (what ? ': ' + what : ''));
    await wait(50);
  }
}

/** Every diagram card lies inside the panel, at a readable zoom (75% or more). */
function diagramReadable() {
  const host = document.querySelector('.diagram');
  if (!host) return 'no diagram';
  const b = host.getBoundingClientRect();
  const k = parseInt(document.querySelector('.zoom-label').textContent, 10);
  if (k < 75) return 'zoom ' + k + '%';
  for (const el of host.querySelectorAll('.world .dcard')) {
    const r = el.getBoundingClientRect();
    if (r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) return 'clipped: ' + el.textContent.slice(0, 20);
  }
  return '';
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
    await until(() => document.querySelector('.home-hero'));
    await shot('01-home');
  });
  let tiereDir = null;
  await step('open example Tiere', async () => {
    await A.openExample('Tiere');
    await until(() => document.querySelectorAll('.class-card').length === 5);
    tiereDir = getState().project.dir;
    await until(() => !diagramReadable(), 3000, 'diagram ' + diagramReadable());
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
    await until(() => document.querySelector('.tb-state'), 3000, 'no state in the title bar');
    if (document.querySelector('.tb-state').textContent.trim() !== '1 Fehler') throw new Error('tb-state: ' + document.querySelector('.tb-state').textContent);
    await shot('09-compile-error');
    A.editFile('Hund.java', f.content);
    await A.compile();
    await until(() => getState().compile.state === 'ok');
    await until(() => !document.querySelector('.tb-state'), 3000, 'tb-state still shown');
  });
  await step('drag a class card, then arrange again', async () => {
    const card = [...document.querySelectorAll('.class-card')].find((el) => el.getAttribute('aria-label') === 'Zoo');
    const before = card.getBoundingClientRect();
    const at = { clientX: before.left + 20, clientY: before.top + 12, bubbles: true, button: 0, pointerId: 1 };
    card.dispatchEvent(new PointerEvent('pointerdown', at));
    for (let i = 1; i <= 4; i++) window.dispatchEvent(new PointerEvent('pointermove', { ...at, clientX: at.clientX + i * 10, clientY: at.clientY + i * 6 }));
    window.dispatchEvent(new PointerEvent('pointerup', { ...at, clientX: at.clientX + 40, clientY: at.clientY + 24 }));
    await wait(100);
    const after = card.getBoundingClientRect();
    if (!getState().positions['#moved:'] || Math.abs(after.left - before.left - 40) > 8) throw new Error('drag: ' + JSON.stringify({ before: before.left, after: after.left, moved: getState().positions['#moved:'] }));
  });
  await step('diagram tools: arrange and uses arrows', async () => {
    A.arrange();
    if (getState().positions['#moved:']) throw new Error('arrange kept the manual flag');
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
    await until(() => document.querySelectorAll('.class-card').length === 6 && !diagramReadable(), 4000, 'diagram ' + diagramReadable());
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
    const calls = [callAt('x = name.substring(1, '), callAt('new Hund("Rex, (", '), callAt('if (a > ')];
    if (JSON.stringify(calls) !== JSON.stringify([{ name: 'substring', expr: 'name', argIndex: 1 }, { ctor: 'Hund', argIndex: 1 }, null])) throw new Error(JSON.stringify(calls));
    ed.trigger('smoke', 'type', { text: 'substring(' });
    await wait(100);
    ed.trigger('smoke', 'editor.action.triggerParameterHints', {});
    await until(() => document.querySelector('.parameter-hints-widget.visible'), 6000, 'no parameter hints');
    await wait(500);
    await shot('11d-parameter-hints');
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
  // The tutor as an agent, against the scripted fake API (electron/smoke-ai.cjs): nothing leaves the machine.
  let original = null;
  await step('agent: reads a file and proposes an edit', async () => {
    await A.compile();
    await A.setApiKey('sk-ant-smoke', false);
    A.setTutorMode('explain');
    setState({ tutorOpen: true, side: 'tutor' });
    A.openFile('Hund.java');
    original = getState().files['Hund.java'].content;
    A.askTutor('Lass den Hund zweimal bellen');
    await until(() => document.querySelector('.agent-diff[data-status="pending"]'), 15000, 'no pending change card');
    if (document.querySelectorAll('.agent-step').length < 1) throw new Error('no tool rows');
    if (!document.querySelector('.proposal-bar')) throw new Error('no proposal bar in the editor');
    // The chat card beside it has the buttons: one primary on screen, the bar only points at it.
    if (!document.querySelector('.proposal-bar.quiet') || document.querySelector('.proposal-bar .btn-primary')) throw new Error('proposal bar has its own buttons next to the card');
    const stat = document.querySelector('.agent-diff .stat').textContent.trim();
    if (stat !== '+1 −1') throw new Error('stat ' + stat);
    await shot('23-agent-diff');
    document.querySelector('.agent-diff [data-act="accept"]').click();
    await until(() => !getState().chat.busy, 20000, 'turn did not end');
    if (!getState().files['Hund.java'].content.includes('"Wuff! Wuff!"')) throw new Error('change not applied');
    const turn = getState().chat.turns[getState().chat.turns.length - 1];
    if (!turn.parts.some((p) => p.type === 'tool' && p.name === 'compile' && p.status === 'done')) throw new Error('no compile step: ' + JSON.stringify(turn.parts.map((p) => [p.type, p.name, p.status])));
    if (document.querySelector('.proposal-bar')) throw new Error('proposal bar still shown');
    await shot('23b-agent-applied');
    A.editFile('Hund.java', original);
    await A.saveFile('Hund.java');
    await A.compile();
  });
  // Both elements are there, and the ring goes around the target (3px of air at least).
  const ringAround = (sel) => {
    const ring = document.querySelector('.tour-ring');
    const el = document.querySelector(sel);
    if (!ring || !el) return false;
    const a = ring.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return a.left <= b.left - 3 && a.top <= b.top - 3 && a.right >= b.right + 3 && a.bottom >= b.bottom + 3;
  };
  const text = (sel) => (document.querySelector(sel) ? document.querySelector(sel).textContent.trim() : null);
  await step('agent tutorial: ring on the compile button, then on a class card', async () => {
    A.newChat();
    A.editFile('Hund.java', original + '\n');
    A.askTutor('Wie erzeuge ich ein Objekt?');
    await until(() => document.querySelector('.tour-ring') && ringAround('[data-tour="compile"]'), 15000, 'no ring on compile');
    const callout = document.querySelector('.tour-callout').getBoundingClientRect();
    const target = document.querySelector('[data-tour="compile"]').getBoundingClientRect();
    if (callout.left < target.right && callout.right > target.left && callout.top < target.bottom && callout.bottom > target.top) throw new Error('callout covers the button');
    if (text('.tour-tag') !== 'Hier klicken') throw new Error('tag ' + text('.tour-tag'));
    if (text('.tour-count') !== '1 von 3') throw new Error('count ' + text('.tour-count'));
    await until(() => !getState().chat.busy, 15000, 'turn did not end');
    await shot('24-tour-compile');
    await A.compile();
    await until(() => ringAround('[data-tour="class:Hund"]'), 8000, 'no ring on Hund');
    if (text('.tour-count') !== '2 von 3') throw new Error('count ' + text('.tour-count'));
    if (text('.tour-tag') !== 'Rechtsklick') throw new Error('tag ' + text('.tour-tag'));
    await shot('24b-tour-class');
    const card = document.querySelector('[data-tour="class:Hund"]');
    const r = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
    await until(() => ringAround('[data-tour="menu:new"]'), 8000, 'no ring on the constructor');
    if (document.querySelector('.tour-tag')) throw new Error('tag over the menu: ' + text('.tour-tag'));
    if (!document.querySelector('.tour-ring.dim')) throw new Error('menu step lost the dim');
    await shot('24c-tour-menu');
    A.closeMenu();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await until(() => !document.querySelector('.tour-ring'), 3000, 'ring still shown');
    const summary = [...document.querySelectorAll('.agent-step')].map((el) => el.textContent).join(' | ');
    // Closed on its last step: seen through, one short line with the replay link.
    if (!summary.includes('Gezeigt') || !summary.includes('Nochmal zeigen') || summary.includes('beendet')) throw new Error('rows: ' + summary);
    await A.updateSettings({ theme: 'light' });
    A.pointAt({ target: 'new-class', text: 'Hier legst du eine neue Klasse an.' });
    await until(() => ringAround('[data-tour="new-class"]'), 4000, 'no ring on new class');
    await shot('24d-point-light');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await until(() => !document.querySelector('.tour-ring'), 3000, 'point still shown');
    await A.updateSettings({ theme: 'dark' });
    A.editFile('Hund.java', original);
    await A.saveFile('Hund.java');
    await A.compile();
    A.setTutorMode('hints');
    await A.forgetApiKey();
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
  await step('exercise: start, tests red, solve, tests green, marked solved', async () => {
    if ((getState().info.exercises || []).length < 6) throw new Error(JSON.stringify(getState().info.exercises));
    await A.openExercise('02-Rechner');
    await until(() => getState().project && getState().project.exercise === '02-Rechner' && getState().files['Rechner.java']);
    if (getState().activeTab !== '#readme' || !getState().tabs.includes('Rechner.java')) throw new Error('task first: ' + JSON.stringify(getState().tabs));
    await shot('17a-exercise-open');
    await A.runTests({ all: true });
    const red = getState().tests.summary;
    if (!red || red.failed === 0) throw new Error('starter passes: ' + JSON.stringify(red));
    A.editFile('Rechner.java', `public class Rechner {
    public int summeBis(int n) {
        int summe = 0;
        for (int i = 1; i <= n; i++) summe += i;
        return summe;
    }

    public long fakultaet(int n) {
        long f = 1;
        for (int i = 2; i <= n; i++) f *= i;
        return f;
    }

    public boolean istPrimzahl(int n) {
        if (n < 2) return false;
        for (int t = 2; t * t <= n; t++) if (n % t == 0) return false;
        return true;
    }
}
`);
    await A.runTests({ all: true });
    const green = getState().tests.summary;
    if (green.passed !== green.total) throw new Error(JSON.stringify(green));
    await until(() => (getState().settings.exercisesDone || []).includes('02-Rechner'), 4000, 'not marked solved');
    setState({ learnFocus: 'exercises' });
    A.go('learn');
    await until(() => document.querySelector('.ex-row .pill-pos'));
    await until(() => document.getElementById('exercises').getBoundingClientRect().top < 200, 3000, 'not scrolled to the exercises');
    await shot('17b-exercises');
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
  await step('workspace without status bar', async () => {
    if (document.querySelector('.statusbar')) throw new Error('status bar still there');
    const bottom = Math.round(document.querySelector('.app-main').getBoundingClientRect().bottom);
    if (bottom !== window.innerHeight) throw new Error(`stage ends at ${bottom}, window ${window.innerHeight}`);
    await shot('25-ws-dark-1440');
    await A.updateSettings({ theme: 'light' });
    await shot('25b-ws-light-1440');
    await api.smoke.resize({ width: 1280, height: 720 });
    await shot('25c-ws-light-1280');
    await A.updateSettings({ theme: 'dark' });
    await shot('25d-ws-dark-1280');
    await api.smoke.resize({ width: 1440, height: 860 });
  });
  // The workspace as an IDE: every splitter resizes, panels move by their head, the editor pops out.
  const hostRect = (p) => document.querySelector(`.ws-host[data-panel="${p}"]`).getBoundingClientRect();
  const pointer = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, isPrimary: true }));
  const layoutKey = () => 'blackj.layout:' + getState().project.dir.toLowerCase();
  const findSplit = (n, id) => (n.panel ? null : n.id === id ? n : n.children.map((c) => findSplit(c, id)).find(Boolean) || null);
  await step('splitters: drag, keyboard and double-click resize every panel, per project', async () => {
    A.go('project');
    setState({ tutorOpen: true, side: 'tutor', dockCollapsed: false });
    await until(() => document.querySelectorAll('.splitter').length === 3, 4000, 'splitters: ' + document.querySelectorAll('.splitter').length);
    // [split, panel whose size changes, axis, pointer movement, expected growth of that panel]
    for (const [split, panel, axis, d, grow] of [['top', 'diagram', 'width', 60, 60], ['root', 'side', 'width', -50, 50], ['main', 'dock', 'height', -40, 40]]) {
      const el = document.querySelector(`.splitter[data-split="${split}"]`);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const across = axis === 'width';
      const before = hostRect(panel)[axis];
      pointer(el, 'pointerdown', x, y);
      for (let i = 1; i <= 5; i++) pointer(window, 'pointermove', x + (across ? (d * i) / 5 : 0), y + (across ? 0 : (d * i) / 5));
      pointer(window, 'pointerup', x + (across ? d : 0), y + (across ? 0 : d));
      await wait(80);
      const after = hostRect(panel)[axis];
      if (Math.abs(after - before - grow) > 3) throw new Error(`${split}: ${panel} ${axis} ${Math.round(before)} -> ${Math.round(after)}, want +${grow}`);
    }
    const stored = JSON.parse(localStorage.getItem(layoutKey()));
    if (JSON.stringify(stored) !== JSON.stringify(getState().layout.tree)) throw new Error('layout not stored');
    const top = document.querySelector('.splitter[data-split="top"]');
    const w0 = hostRect('diagram').width;
    top.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await wait(50);
    if (Math.abs(hostRect('diagram').width - w0 - 16) > 3) throw new Error('arrow key: ' + (hostRect('diagram').width - w0));
    top.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await wait(50);
    const sizes = findSplit(getState().layout.tree, 'top').sizes.map((s) => Math.round(s * 100));
    if (sizes.join() !== '42,58') throw new Error('double-click reset: ' + sizes);
    const el = document.querySelector('.splitter[data-split="main"]');
    el.classList.add('dragging');
    await shot('26-splitter');
    el.classList.remove('dragging');
  });
  await step('drag a panel by its head: preview, drop, settles, stays after reopening, reset', async () => {
    const grow = document.querySelector('.ws-host[data-panel="dock"] .panel-head .grow');
    const g = grow.getBoundingClientRect();
    const x0 = g.left + g.width / 2;
    const y0 = g.top + g.height / 2;
    const ed = hostRect('editor');
    const tx = ed.right - 40;
    const ty = ed.top + ed.height / 2;
    pointer(grow, 'pointerdown', x0, y0);
    for (let i = 1; i <= 8; i++) pointer(window, 'pointermove', x0 + ((tx - x0) * i) / 8, y0 + ((ty - y0) * i) / 8);
    await until(() => document.querySelector('.ws-drop.on'), 2000, 'no drop preview');
    await wait(200);
    const pv = document.querySelector('.ws-drop').getBoundingClientRect();
    if (Math.abs(pv.right - (ed.right - 6)) > 3 || Math.abs(pv.width - (ed.width / 2 - 12)) > 3) throw new Error('preview ' + JSON.stringify(pv));
    await shot('27-drop-preview');
    pointer(window, 'pointerup', tx, ty);
    await wait(300);
    const moved = () => {
      const d = hostRect('dock');
      const e = hostRect('editor');
      return d.left > e.right - 2 && Math.abs(d.top - e.top) < 3;
    };
    if (!moved()) throw new Error('dock not right of the editor: ' + JSON.stringify([hostRect('dock'), hostRect('editor')]));
    if (!document.querySelector('.ws-drop:not(.on)') || document.querySelector('.ws-ghost.on')) throw new Error('preview still shown');
    await shot('28-dock-moved');
    const dir = getState().project.dir;
    await A.openPath(dir);
    await until(() => document.querySelector('.ws-host[data-panel="dock"] .panel-head'), 8000, 'project not reopened');
    await wait(150);
    if (!moved()) throw new Error('layout not kept for the project');
    A.resetLayout();
    await wait(100);
    if (!(hostRect('dock').top > hostRect('editor').bottom)) throw new Error('reset did not put the dock back');
    if (JSON.stringify(JSON.parse(localStorage.getItem(layoutKey()))) !== JSON.stringify(getState().layout.tree)) throw new Error('reset not stored');
  });
  await step('editor in its own window: edits both ways, breakpoints and theme follow, closing docks it back', async () => {
    const untilAsync = async (fn, ms, what) => {
      const start = Date.now();
      while (!(await fn())) {
        if (Date.now() - start > ms) throw new Error('timeout: ' + what);
        await wait(100);
      }
    };
    const ev = (code) => api.smoke.panelEval({ panel: 'editor', code });
    A.openFile('Zoo.java');
    const before = getState().files['Zoo.java'].content;
    const diagramW = hostRect('diagram').width;
    A.popOut('editor');
    await until(() => !document.querySelector('.editor-panel'), 3000, 'editor still in the main window');
    if (hostRect('diagram').width <= diagramW + 100) throw new Error('main window did not reflow');
    await untilAsync(() => ev('!!(window.blackjSmoke && window.blackjSmoke.editor() && document.querySelector(".editor-host .view-line"))'), 20000, 'pop-out editor not ready');
    await ev(`(() => { const ed = window.blackjSmoke.editor(); ed.focus(); ed.setPosition({ lineNumber: 1, column: 1 }); ed.trigger('smoke', 'type', { text: '// aus dem Fenster\\n' }); return true; })()`);
    await until(() => getState().files['Zoo.java'].content.startsWith('// aus dem Fenster\n'), 5000, 'edit did not reach the main window');
    if (!A.isDirty(getState().files['Zoo.java'])) throw new Error('edit not marked unsaved');
    A.editFile('Zoo.java', before);
    await untilAsync(async () => (await ev('window.blackjSmoke.editor().getValue()')) === before, 5000, 'change from the main window not in the pop-out');
    const line = before.split('\n').findIndex((l) => l.includes('Scanner eingabe')) + 1;
    A.toggleBreakpoint('Zoo.java', line);
    await untilAsync(async () => (await ev('document.querySelectorAll(".bp-glyph").length')) === 1, 5000, 'breakpoint not shown in the pop-out');
    await A.updateSettings({ theme: 'light' });
    await untilAsync(async () => (await ev('document.documentElement.dataset.theme')) === 'light', 5000, 'theme not followed');
    await wait(400);
    await api.smoke.capture({ name: '29-popout-light', panel: 'editor' });
    await A.updateSettings({ theme: 'dark' });
    await untilAsync(async () => (await ev('document.documentElement.dataset.theme')) === 'dark', 5000, 'theme not followed back');
    await wait(400);
    await api.smoke.capture({ name: '29b-popout-dark', panel: 'editor' });
    await shot('30-main-without-editor');
    A.toggleBreakpoint('Zoo.java', line);
    await ev('window.close()');
    await until(() => document.querySelector('.editor-panel') && !getState().layout.detached.length, 5000, 'editor not docked back');
    await A.saveFile('Zoo.java');
    await shot('31-editor-docked-back');
  });
  await step('dock and side panel in their own windows: tabs switch the main state, the view menu docks them back', async () => {
    const untilAsync = async (fn, ms, what) => {
      const start = Date.now();
      while (!(await fn())) {
        if (Date.now() - start > ms) throw new Error('timeout: ' + what);
        await wait(100);
      }
    };
    setState({ dock: 'objects' });
    A.popOut('dock');
    A.popOut('side');
    await until(() => !document.querySelector('.dock-panel') && !document.querySelector('.panel.side'), 3000, 'panels still in the main window');
    const ev = (panel, code) => api.smoke.panelEval({ panel, code });
    await untilAsync(async () => (await ev('dock', 'document.querySelectorAll(".dock-panel .tab").length')) >= 6, 15000, 'dock pop-out not ready');
    await untilAsync(async () => !!(await ev('side', '!!document.querySelector(".panel.side .tab")')), 15000, 'side pop-out not ready');
    await ev('dock', '!!document.querySelector(\'[data-tour="dock:console"]\')?.click() || true');
    await until(() => getState().dock === 'console', 5000, 'dock tab did not reach the main window');
    await ev('side', 'document.querySelector(\'[data-tour="side-tab:inspect"]\').click(), true');
    await until(() => getState().side === 'inspect', 5000, 'side tab did not reach the main window');
    A.note('Hallo aus dem Hauptfenster');
    await untilAsync(async () => !!(await ev('dock', '(document.querySelector(".console") || { textContent: "" }).textContent.includes("Hallo aus dem Hauptfenster")')), 5000, 'console not mirrored');
    await wait(300);
    await api.smoke.capture({ name: '32-popout-dock', panel: 'dock' });
    await shot('33-main-only-diagram-editor');
    document.querySelector('.tb-view').click();
    await until(() => [...document.querySelectorAll('.menu .menu-item')].some((el) => el.textContent.includes('Layout zurücksetzen')), 3000, 'no view menu');
    await shot('34-view-menu');
    [...document.querySelectorAll('.menu .menu-item')].find((el) => el.textContent.includes('Layout zurücksetzen')).click();
    await until(() => document.querySelector('.dock-panel') && document.querySelector('.panel.side') && !getState().layout.detached.length, 5000, 'panels not docked back');
    setState({ dock: 'objects', side: 'tutor' });
  });
  await step('english', async () => {
    await A.updateSettings({ lang: 'en' });
    await shot('20-english');
    await A.updateSettings({ lang: 'de' });
  });
  // What BlueJ has and BlackJ added late: test fixture, main(String[]) arguments, Halt, printing,
  // saving the terminal, and drawing inheritance arrows in the diagram.
  const card = (c) => document.querySelector(`[data-tour="class:${c}"]`);
  const firePointer = (type, el, dx = 20, dy = 20) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: r.left + dx, clientY: r.top + dy }));
  };
  await step('test fixture: object bench to setUp() and back', async () => {
    await A.openExample('Bankkonto');
    await until(() => document.querySelectorAll('.class-card').length === 2);
    await A.compile();
    await until(() => getState().compile.state === 'ok' && getState().bench.state === 'ready');
    const konto = await A.describe('Konto');
    await A.createObject('Konto', konto.constructors[0], [{ kind: 'text', text: 'Mia' }], 'mia');
    await A.callMethod({ target: 'mia', cls: 'Konto', method: method(konto, 'einzahlen'), args: [{ kind: 'text', text: '50' }] });
    await A.createObject('Konto', konto.constructors[0], [{ kind: 'text', text: 'Tom' }], 'tom');
    await A.removeObject('tom');
    card('KontoTest').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: card('KontoTest').getBoundingClientRect().left + 20, clientY: card('KontoTest').getBoundingClientRect().top + 20 }));
    await until(() => [...document.querySelectorAll('.menu .menu-item')].some((el) => el.textContent.includes('Testfixture')), 5000, 'fixture menu');
    await shot('35-fixture-menu');
    A.closeMenu();
    await A.benchToFixture('KontoTest');
    const src = getState().files['KontoTest.java'].content;
    if (!/private Konto mia;/.test(src) || !/@BeforeEach\s+public void setUp\(\) \{\s+mia = new Konto\("Mia"\);\s+mia\.einzahlen\(50(\.0)?\);\s+\}/.test(src) || /tom/.test(src) || !/import org\.junit\.jupiter\.api\.BeforeEach;/.test(src)) throw new Error('fixture source:\n' + src);
    await A.compile();
    await until(() => getState().compile.state === 'ok' && getState().bench.state === 'ready' && !getState().bench.objects.length, 15000, 'bench restarted');
    await A.fixtureToBench('KontoTest');
    await until(() => getState().bench.objects.some((o) => o.name === 'mia'), 5000, 'fixture objects');
    const back = await A.callMethod({ target: 'mia', cls: 'Konto', method: method(konto, 'getKontostand'), args: [], quiet: true });
    if (back.result.value.text !== '50.0') throw new Error('kontostand ' + JSON.stringify(back.result.value));
  });
  await step('main with arguments, pause a running program, save the console, print', async () => {
    const err = await A.newClass('Echo', 'main');
    if (err) throw new Error(err);
    A.editFile('Echo.java', 'public class Echo {\n    public static void main(String[] args) {\n        long n = 0;\n        while (args.length == 0) {\n            n++;\n        }\n        System.out.println("args=" + String.join("|", args));\n    }\n}\n');
    await A.saveFile('Echo.java');
    await A.compile();
    await until(() => getState().compile.state === 'ok' && getState().bench.state === 'ready');
    const main = { key: 'main', name: 'main', static: true, returnType: 'void', params: [{ name: 'args', type: 'String[]', category: 'array' }] };
    A.openDialogBox({ type: 'call', kind: 'main', cls: 'Echo', method: main });
    await until(() => document.querySelector('[data-tour="dialog:arg:0"] input'));
    const input = document.querySelector('[data-tour="dialog:arg:0"] input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Anna, "3 4"');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await until(() => document.querySelector('.dialog .statement').textContent.includes('new String[]{"Anna", "3 4"}'), 3000, 'statement ' + document.querySelector('.dialog .statement').textContent);
    await shot('36-main-args');
    document.querySelector('[data-tour="dialog:confirm"]').click();
    await until(() => getState().console.some((l) => l.text.includes('args=Anna|3 4')), 15000, 'main args');
    const run = A.runMain('Echo');
    await until(() => getState().bench.state === 'running');
    setState({ dock: 'debug' });
    await until(() => document.querySelector('[data-tour="debug:pause"]'));
    await shot('37-running');
    document.querySelector('[data-tour="debug:pause"]').click();
    await until(() => getState().debug.paused, 15000, 'paused');
    if (!getState().debug.paused.frames.some((f) => f.className === 'Echo')) throw new Error(JSON.stringify(getState().debug.paused.frames));
    await shot('37b-paused');
    await A.stopProgram();
    await run;
    setState({ dock: 'console' });
    await A.saveConsole();
    if (!getState().toast || !getState().toast.text.includes('console.txt')) throw new Error('console save ' + JSON.stringify(getState().toast));
    const pr = await api.print.source({ title: 'Echo.java', text: 'a < b' });
    const b = document.querySelector('.diagram').getBoundingClientRect();
    const pd = await api.print.diagram({ rect: { x: b.left, y: b.top, width: b.width, height: b.height }, title: 'Bankkonto' });
    if (!pr.ok || !pd.ok) throw new Error(JSON.stringify([pr, pd]));
  });
  await step('draw and remove inheritance arrows in the diagram', async () => {
    for (const [n, k] of [['Sparkonto', 'class'], ['Verzinsbar', 'interface']]) {
      const err = await A.newClass(n, k);
      if (err) throw new Error(err);
    }
    await until(() => card('Sparkonto') && card('Verzinsbar'));
    document.querySelector('[data-tour="new-arrow"]').click();
    await until(() => document.querySelector('.link-hint'));
    firePointer('pointerdown', card('Sparkonto'));
    await until(() => document.querySelector('.link-hint').textContent.includes('Sparkonto'), 3000, 'source not picked');
    const kr = card('Konto').getBoundingClientRect();
    document.querySelector('.diagram').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: kr.left + kr.width / 2, clientY: kr.bottom + 24 }));
    await until(() => document.querySelector('.edges .link-preview'), 3000, 'rubber band');
    await shot('38-draw-arrow');
    firePointer('pointerdown', card('Konto'));
    const content = () => getState().files['Sparkonto.java'].content;
    await until(() => /class Sparkonto extends Konto \{/.test(content()), 5000, 'extends: ' + content().slice(0, 300));
    await A.addRelation('Sparkonto', 'Verzinsbar');
    if (!/class Sparkonto extends Konto implements Verzinsbar \{/.test(content())) throw new Error(content());
    const before = getState().files['Konto.java'].content;
    await A.addRelation('Konto', 'Sparkonto');
    if (getState().files['Konto.java'].content !== before || getState().toast.kind !== 'bad') throw new Error('cycle was written');
    await until(() => document.querySelectorAll('.edges path').length >= 2);
    await shot('38b-arrows');
    await A.removeRelation('Sparkonto', 'Konto');
    await A.removeRelation('Sparkonto', 'Verzinsbar');
    if (!/class Sparkonto \{/.test(content())) throw new Error(content());
  });
  await step('build mode: plans, writes classes, fixes the compile error, starts, undoes everything', async () => {
    await A.setApiKey('sk-ant-smoke', false);
    A.setTutorMode('build');
    setState({ tutorOpen: true, side: 'tutor' });
    await until(() => document.querySelector('.build-title'), 3000, 'build empty state');
    await shot('39-build-empty');
    A.askTutor('Baue ein Würfelspiel mit drei Würfen');
    await until(() => !getState().chat.busy, 30000, 'build did not end');
    const turn = getState().chat.turns[getState().chat.turns.length - 1];
    const names = turn.parts.filter((p) => p.type === 'tool').map((p) => p.name + ':' + p.status);
    if (names.filter((n) => n === 'compile:done').length !== 2) throw new Error('compiles: ' + names.join(' '));
    if (!getState().files['Wuerfel.java'] || !getState().files['Spiel.java'].content.includes('wuerfel.werfen()')) throw new Error('classes not written');
    if (getState().compile.state !== 'ok') throw new Error('compile ' + getState().compile.state);
    if (document.querySelector('.agent-diff')) throw new Error('build shows diff cards');
    await until(() => document.querySelector('.build-card [data-tour="build-run"]'), 5000, 'no build card');
    if (document.querySelectorAll('.build-file').length !== 2) throw new Error('build files ' + document.querySelectorAll('.build-file').length);
    await shot('39b-build-done');
    document.querySelector('.build-card [data-tour="build-run"]').click();
    await until(() => getState().console.some((l) => l.text.includes('Summe:')), 15000, 'program did not run');
    [...document.querySelectorAll('.build-foot .btn-quiet')].pop().click();
    await until(() => !getState().files['Wuerfel.java'] && !getState().files['Spiel.java'], 10000, 'undo all');
    await until(() => document.querySelector('.build-card[data-status="undone"]'), 3000, 'card not undone');
    A.setTutorMode('hints');
  });
  await step('home with recent projects', async () => {
    A.go('home');
    await until(() => document.querySelectorAll('.recent-tile').length >= 1);
    await shot('21-home-recent');
    await A.updateSettings({ theme: 'light' });
    await shot('21b-home-light');
    await A.updateSettings({ theme: 'dark' });
    await api.smoke.resize({ width: 1024, height: 680 });
    await shot('22-home-small');
    await api.smoke.resize({ width: 1440, height: 860 });
  });
  await log(failures ? `${failures} step(s) failed` : 'all steps passed');
  await api.smoke.done(failures ? 1 : 0);
}
