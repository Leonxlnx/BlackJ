// Smoke steps of the class diagram: every relation measured geometrically (Tiere, Bankkonto,
// Bibliothek and a project made here), panning with the left and middle button and with Space,
// wheel and pinch zoom without snapping back, picking several cards and moving them together.
import { routeDiagram, diagramEdges } from '../model.js';

const nums = (s) => (String(s).match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number);
const parsePts = (s) => String(s).trim().split(/\s+/).map((p) => {
  const [x, y] = p.split(',').map(Number);
  return { x, y };
});
const near = (a, b, e = 0.6) => Math.abs(a.x - b.x) <= e && Math.abs(a.y - b.y) <= e;
const onBorder = (p, b) =>
  ((Math.abs(p.x - b.x) <= 1 || Math.abs(p.x - b.x - b.w) <= 1) && p.y >= b.y - 1 && p.y <= b.y + b.h + 1) ||
  ((Math.abs(p.y - b.y) <= 1 || Math.abs(p.y - b.y - b.h) <= 1) && p.x >= b.x - 1 && p.x <= b.x + b.w + 1);
const inside = (p, b) => p.x > b.x + 0.5 && p.x < b.x + b.w - 0.5 && p.y > b.y + 0.5 && p.y < b.y + b.h - 0.5;
// An axis-parallel segment that enters a card (its border may be touched, never crossed).
const through = (p, q, b) => {
  const x0 = Math.min(p.x, q.x);
  const x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const y1 = Math.max(p.y, q.y);
  return x1 > b.x + 1 && x0 < b.x + b.w - 1 && y1 > b.y + 1 && y0 < b.y + b.h - 1;
};

export default async function ({ step, shot, until, wait, A, api, getState }) {
  const host = () => document.querySelector('.diagram');
  const world = () => document.querySelector('.diagram .world');
  const viewOf = () => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.e]+)\)/.exec(world().style.transform);
    return { x: +m[1], y: +m[2], k: +m[3] };
  };
  const boxOf = (el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight });
  const cardEl = (c) => document.querySelector(`.world [data-tour="class:${c}"]`);
  const classCards = () => Object.fromEntries([...document.querySelectorAll('.world .class-card')].map((el) => [el.dataset.tour.slice(6), boxOf(el)]));
  const everyCard = () => [...document.querySelectorAll('.world .dcard')].map((el) => ({ key: (el.dataset.tour || '').startsWith('class:') ? el.dataset.tour.slice(6) : null, ...boxOf(el) }));
  const fire = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: 'mouse', ...extra }));
  const settle = async () => {
    let last = '';
    let same = 0;
    await until(() => {
      const edges = document.querySelector('.edges');
      const s = (world() ? world().style.transform : '') + '|' + (edges ? edges.innerHTML.length : 0) + '|' + [...document.querySelectorAll('.world .dcard')].map((e) => e.style.left + e.style.top + e.offsetWidth + 'x' + e.offsetHeight).join();
      if (s === last) same++;
      else {
        same = 0;
        last = s;
      }
      return same >= 5;
    }, 10000, 'diagram did not settle');
  };
  /** A point on the empty canvas (nothing but the canvas under it), in screen coordinates. */
  const emptySpot = (prefer) => {
    const b = host().getBoundingClientRect();
    const ok = (x, y) => x > b.left + 4 && x < b.right - 4 && y > b.top + 4 && y < b.bottom - 60 && document.elementFromPoint(x, y) === host();
    if (prefer && ok(prefer.x, prefer.y)) return prefer;
    for (let y = b.top + 20; y < b.bottom - 60; y += 12) for (let x = b.left + 20; x < b.right - 20; x += 12) if (ok(x, y)) return { x, y };
    throw new Error('no empty spot on the canvas');
  };

  /** Measures every relation the diagram draws against the model and the cards. */
  const checkRelations = (label) => {
    const problems = [];
    const add = (s) => problems.push(label + ': ' + s);
    const cards = classCards();
    const all = everyCard();
    const canvas = getComputedStyle(host()).backgroundColor;
    const model = A.modelOf(getState().files);
    const showUses = getState().settings.showUses !== false;
    const shown = new Set(Object.keys(cards));
    const inherit = new Set(model.edges.filter((e) => e.kind !== 'uses').map((e) => e.from + '>' + e.to));
    const expected = new Set(model.edges
      .filter((e) => shown.has(e.from) && shown.has(e.to) && e.from !== e.to && (e.kind !== 'uses' || (showUses && !inherit.has(e.from + '>' + e.to))))
      .map((e) => e.from + '>' + e.to + '>' + e.kind));
    const drawn = [];
    const dashes = {};
    for (const g of document.querySelectorAll('.edges g.rel')) {
      const kind = g.dataset.kind;
      const to = g.dataset.to;
      const froms = g.dataset.from.split(' ').filter(Boolean);
      const id = froms.join(',') + '>' + to + ' (' + kind + ')';
      for (const f of froms) {
        drawn.push(f + '>' + to + '>' + kind);
        if (f === to) add('self-edge ' + id);
      }
      const target = cards[to];
      if (!target) {
        add('no card for ' + id);
        continue;
      }
      // The head: a closed hollow triangle filled with the canvas for extends/implements, two
      // open strokes for uses; its tip on the target's border, pointing into it.
      const head = g.querySelector('path.head');
      const d = head.getAttribute('d');
      const n = nums(d);
      const tri = kind !== 'uses';
      const hs = getComputedStyle(head);
      if (n.length !== 6) add(id + ': head ' + d);
      if (tri && (!head.classList.contains('tri') || !/Z\s*$/i.test(d) || hs.fill !== canvas)) add(`${id}: triangle ${d} fill ${hs.fill} (canvas ${canvas})`);
      if (!tri && (!head.classList.contains('open') || /Z/i.test(d) || hs.fill !== 'none')) add(`${id}: open head ${d} fill ${hs.fill}`);
      const tip = tri ? { x: n[0], y: n[1] } : { x: n[2], y: n[3] };
      const w1 = tri ? { x: n[2], y: n[3] } : { x: n[0], y: n[1] };
      const w2 = { x: n[4], y: n[5] };
      const base = { x: (w1.x + w2.x) / 2, y: (w1.y + w2.y) / 2 };
      if (!near(tip, { x: nums(head.dataset.tip)[0], y: nums(head.dataset.tip)[1] })) add(id + ': data-tip differs from the drawn tip');
      if (!onBorder(tip, target)) add(`${id}: tip ${tip.x},${tip.y} not on the border of ${to} ${JSON.stringify(target)}`);
      if (inside(base, target) || onBorder(base, target)) add(id + ': head points the wrong way');
      // Lines: the dash by kind, one of them ends where the head starts, all of them orthogonal,
      // none through another card, and each subclass/user is where a line starts.
      const lines = [...g.querySelectorAll('path.line:not(.trace)')];
      if (!lines.length) add(id + ': no line');
      const want = tri ? base : tip;
      let reaches = false;
      for (const l of lines) {
        const ls = getComputedStyle(l);
        dashes[kind] = ls.strokeDasharray;
        if ((kind === 'extends') !== (ls.strokeDasharray === 'none')) add(`${id}: dash ${ls.strokeDasharray}`);
        const dn = nums(l.getAttribute('d'));
        const ends = [{ x: dn[0], y: dn[1] }, { x: dn[dn.length - 2], y: dn[dn.length - 1] }];
        if (ends.some((e) => near(e, want))) reaches = true;
        const pts = parsePts(l.dataset.pts);
        for (let i = 0; i + 1 < pts.length; i++) {
          const p = pts[i];
          const q = pts[i + 1];
          if (Math.abs(p.x - q.x) > 0.01 && Math.abs(p.y - q.y) > 0.01) add(`${id}: diagonal segment ${p.x},${p.y} ${q.x},${q.y}`);
          for (const c of all) {
            if (c.key === to || froms.includes(c.key)) continue;
            if (through(p, q, c)) add(`${id}: runs through ${c.key || 'a card'} at ${p.x},${p.y} ${q.x},${q.y}`);
          }
        }
        if (!g.classList.contains('tree') && !near(pts[pts.length - 1], tip)) add(id + ': route does not end at the tip');
      }
      if (!reaches) add(`${id}: no line reaches the head at ${want.x},${want.y}`);
      for (const f of froms) {
        if (!cards[f]) continue;
        const starts = lines.flatMap((l) => {
          const pts = parsePts(l.dataset.pts);
          return [pts[0], pts[pts.length - 1]];
        });
        if (!starts.some((p) => onBorder(p, cards[f]))) add(`${id}: no line leaves ${f}`);
      }
      if (g.classList.contains('tree')) {
        const ys = new Set();
        for (const l of lines) {
          const pts = parsePts(l.dataset.pts);
          for (let i = 0; i + 1 < pts.length; i++) if (Math.abs(pts[i].y - pts[i + 1].y) < 0.01) ys.add(pts[i].y);
        }
        if (ys.size > 1) add(id + ': tree with more than one bus ' + [...ys].join(','));
        if (froms.some((f) => cards[f] && cards[f].y < target.y + target.h)) add(id + ': a tree kid is not below its superclass');
      }
    }
    const seen = new Set();
    for (const e of drawn) {
      if (seen.has(e)) add('drawn twice: ' + e);
      seen.add(e);
      if (!expected.has(e)) add('not in the model (wrong direction or kind?): ' + e);
    }
    for (const e of expected) if (!seen.has(e)) add('missing: ' + e);
    if (dashes.impl && dashes.uses && dashes.impl === dashes.uses) add('implements and uses share a dash pattern');
    // Stereotypes: «interface», «abstract» (with an italic name), «enum», «Test».
    for (const [k] of Object.entries(cards)) {
      const info = model.byName[k];
      const el = cardEl(k);
      const want = info.isTest ? '«Test»' : info.kind === 'abstract' ? '«abstract»' : info.kind === 'interface' ? '«interface»' : info.kind === 'enum' ? '«enum»' : '';
      const st = el.querySelector('.stereo');
      if ((st ? st.textContent : '') !== want) add(`${k}: stereotype ${st && st.textContent} instead of ${want}`);
      const italic = getComputedStyle(el.querySelector('.class-name')).fontStyle === 'italic';
      if (italic !== (info.kind === 'abstract')) add(`${k}: name ${italic ? '' : 'not '}italic`);
    }
    return { problems, drawn: drawn.length };
  };
  const expectClean = (label) => {
    const r = checkRelations(label);
    if (r.problems.length) throw new Error(r.problems.slice(0, 12).join('\n'));
    return r;
  };
  const openFresh = async (name, count) => {
    const before = getState().project && getState().project.dir;
    await A.openExample(name);
    await until(() => getState().project && getState().project.dir !== before && document.querySelectorAll('.world .class-card').length === count, 15000, 'open ' + name);
    await settle();
  };

  await step('diagram: UML relations in Tiere, Bankkonto and Bibliothek, measured', async () => {
    for (const [name, count] of [['Tiere', 5], ['Bankkonto', 2], ['Bibliothek', 3]]) {
      await openFresh(name, count);
      const r = expectClean(name);
      if (!r.drawn) throw new Error(name + ': no relations drawn');
      await shot('diagram-01-' + name.toLowerCase());
    }
    A.enterPackage('medien');
    await until(() => document.querySelectorAll('.world .class-card').length === 3);
    await settle();
    const r = expectClean('Bibliothek/medien');
    if (r.drawn !== 2) throw new Error('medien: ' + r.drawn + ' relations');
    await shot('diagram-01-medien');
    A.enterPackage('');
    await until(() => document.querySelectorAll('.world .class-card').length === 3);
  });

  const generated = {
    Zeichenbar: '/** Alles, was sich zeichnen lässt. */\npublic interface Zeichenbar {\n    void zeichne();\n}\n',
    Skalierbar: 'public interface Skalierbar extends Zeichenbar {\n    void skaliere(double faktor);\n}\n',
    Farbe: 'public enum Farbe {\n    ROT, GRUEN, BLAU\n}\n',
    Figur: 'public abstract class Figur implements Zeichenbar {\n    protected Farbe farbe = Farbe.ROT;\n\n    public abstract double flaeche();\n}\n',
    Rechteck: 'public class Rechteck extends Figur implements Skalierbar {\n    protected double breite = 2;\n    protected double hoehe = 1;\n\n    public double flaeche() {\n        return breite * hoehe;\n    }\n\n    public void zeichne() {\n        System.out.println("Rechteck " + flaeche());\n    }\n\n    public void skaliere(double faktor) {\n        breite *= faktor;\n        hoehe *= faktor;\n    }\n}\n',
    Quadrat: 'public class Quadrat extends Rechteck {\n    public Quadrat(double seite) {\n        breite = seite;\n        hoehe = seite;\n    }\n}\n',
    Kreis: 'public class Kreis extends Figur {\n    private double radius = 1;\n\n    public double flaeche() {\n        return Math.PI * radius * radius;\n    }\n\n    public void zeichne() {\n        System.out.println("Kreis " + flaeche());\n    }\n}\n',
    Leinwand: 'import java.util.ArrayList;\n\npublic class Leinwand {\n    private ArrayList<Figur> figuren = new ArrayList<>();\n    private Farbe grund = Farbe.BLAU;\n\n    public void hinzufuegen(Figur f) {\n        figuren.add(f);\n    }\n}\n',
    Zeichnung: 'public class Zeichnung {\n    public static void main(String[] args) {\n        Leinwand leinwand = new Leinwand();\n        leinwand.hinzufuegen(new Kreis());\n        leinwand.hinzufuegen(new Quadrat(2));\n        System.out.println(Farbe.GRUEN);\n    }\n}\n',
  };
  const mustHave = [
    'Skalierbar>Zeichenbar>extends', 'Figur>Zeichenbar>impl', 'Rechteck>Figur>extends', 'Rechteck>Skalierbar>impl', 'Quadrat>Rechteck>extends', 'Kreis>Figur>extends',
    'Leinwand>Figur>uses', 'Leinwand>Farbe>uses', 'Zeichnung>Leinwand>uses', 'Zeichnung>Kreis>uses', 'Zeichnung>Quadrat>uses', 'Zeichnung>Farbe>uses', 'Figur>Farbe>uses', 'KontoTest>Konto>uses',
  ];
  const drawnSet = () => new Set([...document.querySelectorAll('.edges g.rel')].flatMap((g) => g.dataset.from.split(' ').map((f) => f + '>' + g.dataset.to + '>' + g.dataset.kind)));

  await step('diagram: a project with interfaces, an abstract class, a 3-level chain and uses, in flow and hand-made layouts', async () => {
    await openFresh('Bankkonto', 2);
    for (const [name, content] of Object.entries(generated)) {
      const err = await A.newClass(name, 'class');
      if (err) throw new Error(err);
      A.editFile(name + '.java', content);
      await A.saveFile(name + '.java');
    }
    await until(() => document.querySelectorAll('.world .class-card').length === 11, 10000, 'cards');
    await settle();
    const t0 = performance.now();
    expectClean('generated, flow layout');
    const have = drawnSet();
    for (const e of mustHave) if (!have.has(e)) throw new Error('missing ' + e + ' in ' + [...have].join(' '));
    // Trees: Figur's subclasses share one triangle, Zeichenbar has an extends and an implements tree
    // side by side.
    const figTree = document.querySelector('.edges g.rel.tree[data-to="Figur"][data-kind="extends"]');
    if (!figTree || figTree.dataset.from.split(' ').length !== 2) throw new Error('Figur tree: ' + (figTree && figTree.dataset.from));
    const zTrees = [...document.querySelectorAll('.edges g.rel.tree[data-to="Zeichenbar"]')];
    if (zTrees.length === 2) {
      const tips = zTrees.map((g) => nums(g.querySelector('.head').dataset.tip)[0]);
      if (Math.abs(tips[0] - tips[1]) < 20) throw new Error('two triangles on Zeichenbar overlap: ' + tips);
    }
    await shot('diagram-02-generated');
    // Details off and on again (cards change size, the routes follow).
    await A.updateSettings({ diagramDetails: false });
    await settle();
    expectClean('generated, without members');
    await A.updateSettings({ diagramDetails: true });
    await settle();
    // Hand-made: a subclass beside its superclass, one above it, two users far away and an
    // unrelated card right in the way of a relation.
    const pkg = getState().pkg;
    const cards = classCards();
    A.pinLayout(pkg, Object.fromEntries(Object.entries(cards).map(([k, b]) => [k, { x: b.x, y: b.y }])));
    const snap = (v) => Math.round(v / 8) * 8;
    const r = cards.Rechteck;
    const f = cards.Figur;
    const left = Math.min(...Object.values(cards).map((b) => b.x));
    const right = Math.max(...Object.values(cards).map((b) => b.x + b.w));
    const bottom = Math.max(...Object.values(cards).map((b) => b.y + b.h));
    const rowRight = Math.max(...Object.entries(cards).filter(([k, b]) => k !== 'Quadrat' && b.y < r.y + cards.Quadrat.h && b.y + b.h > r.y).map(([, b]) => b.x + b.w));
    const moved = {
      Quadrat: { x: snap(rowRight + 72), y: r.y },
      Kreis: { x: snap(left - cards.Kreis.w - 96), y: snap(f.y - cards.Kreis.h - 120) },
      Leinwand: { x: snap(Math.max(right, rowRight + 72 + cards.Quadrat.w) + 96), y: snap(bottom + 120) },
    };
    moved.Farbe = { x: moved.Leinwand.x, y: snap(moved.Leinwand.y + cards.Leinwand.h + 56) };
    const boxes = { ...cards };
    for (const [k, p] of Object.entries(moved)) boxes[k] = { ...cards[k], ...p };
    const lc = { x: moved.Leinwand.x + cards.Leinwand.w / 2, y: moved.Leinwand.y + cards.Leinwand.h / 2 };
    const way = { x: snap((lc.x + f.x + f.w / 2) / 2 - cards.Konto.w / 2), y: snap((lc.y + f.y + f.h / 2) / 2 - cards.Konto.h / 2) };
    const clear = Object.entries(boxes).every(([k, b]) => k === 'Konto' || way.x > b.x + b.w + 24 || way.x + cards.Konto.w + 24 < b.x || way.y > b.y + b.h + 24 || way.y + cards.Konto.h + 24 < b.y);
    if (clear) moved.Konto = way;
    A.pinLayout(pkg, moved);
    await settle();
    expectClean('generated, hand-made layout' + (clear ? ' with a card in the way' : ''));
    await shot('diagram-02b-handmade');
    // Hovering a card brings its relations forward and the others back.
    const rect = cardEl('Rechteck');
    rect.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
    await until(() => document.querySelector('.edges g.rel.hl, .edges g.rel.part') && document.querySelector('.edges g.rel.dim'), 3000, 'hover highlight');
    if (!document.querySelector('.world .class-card.related')) throw new Error('no related card marked');
    await shot('diagram-03-hover');
    rect.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerId: 1, pointerType: 'mouse', relatedTarget: host() }));
    await until(() => !document.querySelector('.edges g.rel.dim'), 3000, 'hover not cleared');
    A.arrange();
    await settle();
    expectClean('generated, arranged again');
    // How long routing all relations of this diagram takes (it runs again whenever a card moves).
    const rects = classCards();
    const edges = diagramEdges(A.modelOf(getState().files), new Set(Object.keys(rects)), true);
    let best = Infinity;
    for (let i = 0; i < 8; i++) {
      const s = performance.now();
      routeDiagram(rects, edges);
      best = Math.min(best, performance.now() - s);
    }
    await api.smoke.log(`     diagram: ${edges.length} relations among ${Object.keys(rects).length} classes routed in ${best.toFixed(1)} ms; the step took ${Math.round(performance.now() - t0)} ms`);
  });

  await step('diagram: drag the canvas (left, middle, Space), wheel and pinch zoom, no snapping back', async () => {
    await settle();
    // Left button on the empty canvas.
    const v0 = viewOf();
    const s = emptySpot();
    fire(host(), 'pointerdown', s.x, s.y);
    try {
      for (let i = 1; i <= 5; i++) window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: s.x + i * 10, clientY: s.y + i * 6, pointerId: 1, buttons: 1 }));
      await wait(60);
      if (!host().classList.contains('panning') || !document.documentElement.classList.contains('diagram-panning')) throw new Error('no grabbing state while dragging');
    } finally {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: s.x + 50, clientY: s.y + 30, pointerId: 1 }));
    }
    await wait(80);
    const v1 = viewOf();
    if (Math.abs(v1.x - v0.x - 50) > 1 || Math.abs(v1.y - v0.y - 30) > 1 || v1.k !== v0.k) throw new Error('pan ' + JSON.stringify({ v0, v1 }));
    if (host().classList.contains('panning')) throw new Error('still panning');
    if (!Number.isInteger(v1.x) || !Number.isInteger(v1.y)) throw new Error('fractional shift ' + world().style.transform);
    // It stays where the user put it: after a while, after the panel changes size, after a card
    // grows.
    await wait(600);
    await api.smoke.resize({ width: 1400, height: 840 });
    await api.smoke.resize({ width: 1440, height: 860 });
    const konto = getState().files['Konto.java'].content;
    A.editFile('Konto.java', konto.replace(/\}\s*$/, '\n    public void extra1() {}\n    public void extra2() {}\n}\n'));
    await settle();
    let v2 = viewOf();
    if (v2.x !== v1.x || v2.y !== v1.y || v2.k !== v1.k) throw new Error('snapped back: ' + JSON.stringify({ v1, v2 }));
    A.editFile('Konto.java', konto);
    await A.saveFile('Konto.java');
    await settle();
    // Middle button over a card pans and leaves the card where it is.
    const card = cardEl('Konto');
    const cb = card.getBoundingClientRect();
    const before = { ...getState().positions.Konto };
    fire(card, 'pointerdown', cb.left + 20, cb.top + 10, { button: 1, buttons: 4 });
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cb.left - 10, clientY: cb.top + 30, pointerId: 1, buttons: 4 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cb.left - 10, clientY: cb.top + 30, pointerId: 1, button: 1 }));
    await wait(80);
    v2 = viewOf();
    if (Math.abs(v2.x - v1.x + 30) > 1 || Math.abs(v2.y - v1.y - 20) > 1) throw new Error('middle-drag ' + JSON.stringify({ v1, v2 }));
    if (JSON.stringify(getState().positions.Konto) !== JSON.stringify(before)) throw new Error('middle-drag moved the card');
    // Space held: the left button pans even over a card.
    const s2 = emptySpot();
    fire(host(), 'pointermove', s2.x, s2.y, { buttons: 0 });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
    await until(() => host().classList.contains('space'), 2000, 'space mode');
    fire(card, 'pointerdown', cb.left + 20, cb.top + 10);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cb.left + 60, clientY: cb.top + 10, pointerId: 1, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cb.left + 60, clientY: cb.top + 10, pointerId: 1 }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
    await until(() => !host().classList.contains('space'), 2000, 'space mode stays');
    const v3 = viewOf();
    if (Math.abs(v3.x - v2.x - 40) > 1 || JSON.stringify(getState().positions.Konto) !== JSON.stringify(before)) throw new Error('space-drag ' + JSON.stringify({ v2, v3 }));
    // The wheel scrolls; Ctrl+wheel zooms at the pointer, the diagram point under it stays put.
    const hb = host().getBoundingClientRect();
    const wheel = (extra) => {
      const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 0, ...extra });
      host().dispatchEvent(ev);
      return ev;
    };
    const ev = wheel({ deltaY: 120, clientX: hb.left + 100, clientY: hb.top + 100 });
    await wait(80);
    const v4 = viewOf();
    if (!ev.defaultPrevented || Math.abs(v4.y - v3.y + 120) > 1 || v4.x !== v3.x) throw new Error('wheel ' + JSON.stringify({ v3, v4, prevented: ev.defaultPrevented }));
    const px = hb.left + hb.width * 0.4;
    const py = hb.top + hb.height * 0.4;
    const under = (v) => ({ x: (px - hb.left - v.x) / v.k, y: (py - hb.top - v.y) / v.k });
    const w0 = under(v4);
    wheel({ deltaY: 100, ctrlKey: true, clientX: px, clientY: py });
    await wait(80);
    const v5 = viewOf();
    const w1 = under(v5);
    if (!(v5.k < v4.k) || Math.abs(w1.x - w0.x) > 1.5 || Math.abs(w1.y - w0.y) > 1.5) throw new Error('ctrl+wheel ' + JSON.stringify({ v4, v5, w0, w1 }));
    // A pinch: many small Ctrl+wheel steps.
    for (let i = 0; i < 12; i++) wheel({ deltaY: -6, ctrlKey: true, clientX: px, clientY: py });
    await wait(80);
    const v6 = viewOf();
    const w2 = under(v6);
    if (!(v6.k > v5.k) || Math.abs(w2.x - w0.x) > 1.5 || Math.abs(w2.y - w0.y) > 1.5) throw new Error('pinch ' + JSON.stringify({ v5, v6, w0, w2 }));
    await shot('diagram-04-panned');
    // "Show all" fits again; from then on the panel's size counts again.
    document.querySelector('.diagram-tools button:last-child').click();
    await settle();
    const v7 = viewOf();
    if (v7.x === v6.x && v7.y === v6.y && v7.k === v6.k) throw new Error('show all did nothing');
    const b = host().getBoundingClientRect();
    for (const el of document.querySelectorAll('.world .dcard')) {
      const r = el.getBoundingClientRect();
      if (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1) throw new Error('show all leaves a card outside: ' + el.textContent.slice(0, 20) + ' at ' + viewOf().k);
    }
    await shot('diagram-04b-show-all');
  });

  await step('diagram: Shift+drag picks several cards, dragging one moves them together', async () => {
    await settle();
    const cards = classCards();
    const k = viewOf();
    const hb = host().getBoundingClientRect();
    const toScreen = (p) => ({ x: hb.left + k.x + p.x * k.k, y: hb.top + k.y + p.y * k.k });
    // A rectangle around two neighbouring cards that are fully on screen, drawn from an empty
    // corner next to them to the opposite one.
    const shown = Object.keys(cards).filter((c) => {
      const r = cardEl(c).getBoundingClientRect();
      return r.left > hb.left + 24 && r.right < hb.right - 24 && r.top > hb.top + 24 && r.bottom < hb.bottom - 64;
    });
    const mid = (c) => ({ x: cards[c].x + cards[c].w / 2, y: cards[c].y + cards[c].h / 2 });
    let pair = null;
    let a = null;
    let z = null;
    const pairs = shown.flatMap((p, i) => shown.slice(i + 1).map((q) => [p, q])).sort((u, v) => Math.hypot(mid(u[0]).x - mid(u[1]).x, mid(u[0]).y - mid(u[1]).y) - Math.hypot(mid(v[0]).x - mid(v[1]).x, mid(v[0]).y - mid(v[1]).y));
    for (const pq of pairs) {
      const x0 = Math.min(...pq.map((c) => cards[c].x)) - 12;
      const y0 = Math.min(...pq.map((c) => cards[c].y)) - 12;
      const x1 = Math.max(...pq.map((c) => cards[c].x + cards[c].w)) + 12;
      const y1 = Math.max(...pq.map((c) => cards[c].y + cards[c].h)) + 12;
      for (const [s, e] of [[{ x: x0, y: y0 }, { x: x1, y: y1 }], [{ x: x1, y: y0 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x1, y: y0 }], [{ x: x1, y: y1 }, { x: x0, y: y0 }]]) {
        const sp = toScreen(s);
        if (document.elementFromPoint(sp.x, sp.y) === host()) {
          pair = pq;
          a = sp;
          z = toScreen(e);
          break;
        }
      }
      if (pair) break;
    }
    if (!pair) throw new Error('no two cards on screen with an empty corner');
    fire(host(), 'pointerdown', a.x, a.y, { shiftKey: true });
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: (a.x + z.x) / 2, clientY: (a.y + z.y) / 2, pointerId: 1, buttons: 1, shiftKey: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: z.x, clientY: z.y, pointerId: 1, buttons: 1, shiftKey: true }));
    await until(() => document.querySelector('.diagram .band'), 2000, 'no band');
    await shot('diagram-05-band');
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: z.x, clientY: z.y, pointerId: 1 }));
    await until(() => !document.querySelector('.diagram .band'), 2000, 'band stays');
    const picked = [...document.querySelectorAll('.world .class-card.selected')].map((el) => el.dataset.tour.slice(6));
    if (!pair.every((c) => picked.includes(c))) throw new Error('picked ' + picked.join(','));
    // Ctrl+click adds one more.
    const third = Object.keys(cards).find((c) => !picked.includes(c));
    const tb = cardEl(third).getBoundingClientRect();
    fire(cardEl(third), 'pointerdown', tb.left + 16, tb.top + 10, { ctrlKey: true });
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: tb.left + 16, clientY: tb.top + 10, pointerId: 1, ctrlKey: true }));
    await until(() => cardEl(third).classList.contains('selected'), 2000, 'ctrl+click');
    const group = [...document.querySelectorAll('.world .class-card.selected')].map((el) => el.dataset.tour.slice(6));
    if (group.length < 3) throw new Error('group ' + group.join(','));
    const before = Object.fromEntries(group.map((c) => [c, boxOf(cardEl(c))]));
    const gb = cardEl(pair[0]).getBoundingClientRect();
    fire(cardEl(pair[0]), 'pointerdown', gb.left + 20, gb.top + 10);
    for (let i = 1; i <= 4; i++) window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: gb.left + 20 + i * 12 * k.k, clientY: gb.top + 10 + i * 8 * k.k, pointerId: 1, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: gb.left + 20 + 48 * k.k, clientY: gb.top + 10 + 32 * k.k, pointerId: 1 }));
    await settle();
    const after = Object.fromEntries(group.map((c) => [c, boxOf(cardEl(c))]));
    const dx = after[pair[0]].x - before[pair[0]].x;
    const dy = after[pair[0]].y - before[pair[0]].y;
    if (Math.abs(dx - 48) > 8 || Math.abs(dy - 32) > 8) throw new Error('group drag moved by ' + dx + ',' + dy);
    for (const c of group) if (after[c].x - before[c].x !== dx || after[c].y - before[c].y !== dy) throw new Error(c + ' did not move with the group');
    expectClean('after moving a group');
    host().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => document.querySelectorAll('.world .class-card.selected').length <= 1, 2000, 'escape');
  });

  await step('diagram: legend draws the same arrows, light theme', async () => {
    await settle();
    for (const kind of ['extends', 'impl', 'uses']) {
      const glyph = document.querySelector('.diagram-legend svg.glyph.' + kind);
      const real = document.querySelector(`.edges g.rel[data-kind="${kind}"]`);
      if (!glyph || !real) throw new Error('legend or arrow missing for ' + kind);
      const gl = getComputedStyle(glyph.querySelector('.line'));
      const rl = getComputedStyle(real.querySelector('.line'));
      const gh = getComputedStyle(glyph.querySelector('.head'));
      const rh = getComputedStyle(real.querySelector('.head'));
      if (gl.strokeDasharray !== rl.strokeDasharray || gl.stroke !== rl.stroke || gh.fill !== rh.fill || gh.stroke !== rh.stroke) {
        throw new Error(kind + ' legend ' + JSON.stringify([gl.strokeDasharray, rl.strokeDasharray, gl.stroke, rl.stroke, gh.fill, rh.fill]));
      }
      if (glyph.querySelector('.head').getAttribute('d').split(' ').length !== real.querySelector('.head').getAttribute('d').split(' ').length) throw new Error(kind + ' legend head shape');
    }
    await A.updateSettings({ theme: 'light' });
    await settle();
    expectClean('light theme');
    await shot('diagram-06-light');
    await A.updateSettings({ theme: 'dark' });
  });
}
