import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, setState, getState } from '../store.js';
import { useT } from '../i18n.js';
import * as A from '../actions.js';
import { childPackages, simpleName } from '../model.js';
import { signature } from '../lib/javaParse.js';
import Icon from './Icon.jsx';

const VIS = { public: '+', private: '−', protected: '#', package: '~' };
const MAX_MEMBERS = 7;
const SNAP = 8;

function clip(a, p) {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Inheritance flows upwards in a soft curve; "uses" is a straight dashed line. */
function Edge({ from, to, kind, hl }) {
  const cls = (kind === 'uses' ? 'uses' : kind === 'impl' ? 'impl' : '') + (hl ? ' hl' : '');
  const head = (b, ang, len = 11, spread = 0.5) => {
    const p1 = { x: b.x - len * Math.cos(ang - spread), y: b.y - len * Math.sin(ang - spread) };
    const p2 = { x: b.x - len * Math.cos(ang + spread), y: b.y - len * Math.sin(ang + spread) };
    return { p1, p2, base: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  };
  if (kind !== 'uses' && from.y > to.y + to.h + 24) {
    const s = { x: from.x + from.w / 2, y: from.y };
    const e = { x: to.x + to.w / 2, y: to.y + to.h };
    const h = head(e, -Math.PI / 2);
    const mid = (s.y - h.base.y) / 2;
    return (
      <g>
        <path className={cls} d={`M${s.x} ${s.y} C${s.x} ${s.y - mid} ${h.base.x} ${h.base.y + mid} ${h.base.x} ${h.base.y}`} />
        <path className={'head' + (hl ? ' hl' : '')} d={`M${e.x} ${e.y} L${h.p1.x} ${h.p1.y} L${h.p2.x} ${h.p2.y} Z`} />
      </g>
    );
  }
  const c1 = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const c2 = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const a = clip(from, c2);
  const b = clip(to, c1);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const h = head(b, ang, kind === 'uses' ? 9 : 11, kind === 'uses' ? 0.45 : 0.5);
  return (
    <g>
      <path className={cls} d={`M${a.x} ${a.y} L${kind === 'uses' ? b.x : h.base.x} ${kind === 'uses' ? b.y : h.base.y}`} />
      {kind === 'uses' ? (
        <path className={'open' + (hl ? ' hl' : '')} d={`M${h.p1.x} ${h.p1.y} L${b.x} ${b.y} L${h.p2.x} ${h.p2.y}`} />
      ) : (
        <path className={'head' + (hl ? ' hl' : '')} d={`M${b.x} ${b.y} L${h.p1.x} ${h.p1.y} L${h.p2.x} ${h.p2.y} Z`} />
      )}
    </g>
  );
}

function Members({ info }) {
  const methods = [...info.ctors.map((c) => ({ ...c, ctor: true })), ...info.methods];
  const row = (m, i, isField) => {
    const text = isField ? `${m.name}: ${m.type}` : `${signature(m, false)}${m.ctor ? '' : ': ' + m.returnType}`;
    return (
      <button
        key={i}
        className={'member' + (m.static ? ' static' : '') + (m.abstract ? ' abstract' : '') + (m.visibility === 'private' ? ' priv' : '')}
        title={(m.doc && m.doc.text) || text}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          A.openClass(info.fileClass, m.line);
        }}
      >
        <span className="vis">{VIS[m.visibility] || '~'}</span>
        <span className="member-text">{text}</span>
      </button>
    );
  };
  const list = (items, isField) => (
    <>
      {items.slice(0, MAX_MEMBERS).map((m, i) => row(m, i, isField))}
      {items.length > MAX_MEMBERS && <div className="member-more">+ {items.length - MAX_MEMBERS}</div>}
    </>
  );
  if (info.kind === 'enum') {
    return info.constants.length ? <div className="class-members">{info.constants.slice(0, MAX_MEMBERS).map((c) => <div key={c} className="member enum-const">{c}</div>)}</div> : null;
  }
  return (
    <>
      {info.fields.length > 0 && <div className="class-members">{list(info.fields, true)}</div>}
      {methods.length > 0 && <div className="class-members">{list(methods, false)}</div>}
    </>
  );
}

async function classMenu(cls, x, y, t) {
  const s = getState();
  const info = A.modelOf(s.files).byName[cls];
  const compiled = s.compile.state === 'ok' && !A.isStale(A.fileOfClass(cls)) && s.bench.state !== 'off';
  const items = [];
  const simple = simpleName(cls);
  if (compiled) {
    const desc = await A.describe(cls);
    if (desc) {
      if (desc.kind === 'abstract') items.push({ type: 'note', text: t('menu.abstractNote') });
      else if (desc.kind === 'interface') items.push({ type: 'note', text: t('menu.interfaceNote') });
      else if (desc.kind === 'class') {
        if (!desc.constructors.length) items.push({ type: 'note', text: t('menu.noCtor') });
        for (const c of desc.constructors) {
          items.push({ label: <span className="sig">new {simple}({c.params.map((p) => `${p.type} ${p.name}`).join(', ')})</span>, onClick: () => A.openDialogBox({ type: 'call', kind: 'new', cls, method: c }) });
        }
      }
      const statics = desc.methods.filter((m) => m.static && !(m.name === 'main' && m.params.length === 1) && m.declaringClass === desc.name);
      if (statics.length) items.push({ type: 'sep' });
      for (const m of statics) {
        items.push({ label: <span className="sig"><span className="ret">static {m.returnType} </span>{m.name}({m.params.map((p) => `${p.type} ${p.name}`).join(', ')})</span>, onClick: () => A.openDialogBox({ type: 'call', kind: 'static', cls, method: m }) });
      }
      items.push({ type: 'sep' });
      if (info && info.hasMain) items.push({ label: t('menu.runMain'), icon: 'play', onClick: () => A.runMain(cls) });
      if (info && info.isTest) {
        items.push({ label: t('menu.runTests'), icon: 'check', onClick: () => A.runTests({ className: cls }) });
        items.push({ label: t('menu.record'), icon: 'record', onClick: () => A.openDialogBox({ type: 'record', cls }) });
      }
      items.push({ label: t('menu.inspectClass'), icon: 'eye', onClick: () => A.showInspector(cls, simple, true) });
    }
  } else {
    items.push({ label: t('menu.compileFirst'), disabled: true });
    items.push({ label: t('menu.compileNow'), icon: 'build', onClick: A.compile });
  }
  items.push({ type: 'sep' });
  items.push({ label: t('menu.open'), icon: 'file', onClick: () => A.openClass(cls) });
  if (info && !info.isTest && info.kind !== 'interface' && !s.project.readOnly) items.push({ label: t('menu.createTest'), icon: 'check', onClick: () => A.newClass(simple + 'Test', 'test') });
  items.push({ label: t('menu.explain'), icon: 'tutor', onClick: () => { A.openClass(cls); setTimeout(() => A.askTutor(t('tutor.prompt.explainClass', { name: simple })), 50); } });
  if (!s.project.readOnly) {
    items.push({ type: 'sep' });
    items.push({ label: t('menu.delete'), icon: 'trash', danger: true, onClick: () => A.openDialogBox({ type: 'delete', cls }) });
  }
  A.openMenu({ x, y, items });
}

async function quickNew(cls, t, anchor) {
  const desc = await A.describe(cls);
  if (!desc || desc.kind !== 'class' || !desc.constructors.length) return classMenu(cls, anchor.left, anchor.bottom + 4, t);
  if (desc.constructors.length === 1) return A.openDialogBox({ type: 'call', kind: 'new', cls, method: desc.constructors[0] });
  return classMenu(cls, anchor.left, anchor.bottom + 4, t);
}

export default function Diagram({ model }) {
  const t = useT();
  const positions = useStore((s) => s.positions);
  const compile = useStore((s) => s.compile);
  const files = useStore((s) => s.files);
  const objects = useStore((s) => s.bench.objects);
  const benchState = useStore((s) => s.bench.state);
  const details = useStore((s) => s.settings.diagramDetails);
  const selected = useStore((s) => s.selectedClass);
  const highlight = useStore((s) => s.highlightClass);
  const pkg = useStore((s) => s.pkg);
  const extraPackages = useStore((s) => s.extraPackages || []);
  const readme = useStore((s) => s.readme);
  const tests = useStore((s) => s.tests);
  const projectDir = useStore((s) => s.project.dir);
  const readOnly = useStore((s) => s.project.readOnly);
  const showUses = useStore((s) => s.settings.showUses !== false);
  const arrangedAt = useStore((s) => s.arrangedAt);
  const hostRef = useRef(null);
  const cardRefs = useRef({});
  const [sizes, setSizes] = useState({});
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState(null);
  const fitted = useRef(null);

  const classes = model.list.filter((c) => c.pkg === pkg);
  const subPkgs = [...new Set([...childPackages(model, pkg), ...extraPackages.filter((p) => (pkg ? p.startsWith(pkg + '.') && !p.slice(pkg.length + 1).includes('.') : !p.includes('.')))])];
  const keys = [...subPkgs.map((p) => 'pkg:' + p), ...classes.map((c) => c.fileClass)];

  useLayoutEffect(() => {
    const next = {};
    let changed = false;
    for (const k of keys) {
      const el = cardRefs.current[k];
      if (!el) continue;
      next[k] = { w: el.offsetWidth, h: el.offsetHeight };
      if (!sizes[k] || sizes[k].w !== next[k].w || sizes[k].h !== next[k].h) changed = true;
    }
    if (changed || Object.keys(next).length !== Object.keys(sizes).length) setSizes(next);
  });

  const pos = (k) => positions[k] || { x: 32, y: 32 };
  // The README note (root) or the "parent package" card sits above the top-left of the content.
  const minX0 = keys.length ? Math.min(...keys.map((k) => pos(k).x)) : 32;
  const minY0 = keys.length ? Math.min(...keys.map((k) => pos(k).y)) : 32;
  const noteAt = { x: minX0, y: minY0 - 76 };
  const hasNote = (readme && !pkg) || !!pkg;
  const fit = () => {
    const host = hostRef.current;
    if (!host || !keys.length) return;
    const xs = keys.map((k) => pos(k).x);
    const ys = [...keys.map((k) => pos(k).y), ...(hasNote ? [noteAt.y] : [])];
    const x2 = keys.map((k) => pos(k).x + (sizes[k]?.w || 200));
    const y2 = keys.map((k) => pos(k).y + (sizes[k]?.h || 90));
    const minX = Math.min(...xs) - 24;
    const minY = Math.min(...ys) - 24;
    const w = Math.max(...x2) - minX + 24;
    const h = Math.max(...y2) - minY + 56;
    const k = Math.min(1, Math.max(0.55, Math.min(host.clientWidth / w, host.clientHeight / h)));
    setView({ k, x: (host.clientWidth - w * k) / 2 - minX * k, y: Math.max(0, (host.clientHeight - h * k) / 2) - minY * k });
  };

  useEffect(() => {
    const id = projectDir + '|' + pkg + '|' + (arrangedAt || 0);
    if (fitted.current === id || !Object.keys(sizes).length) return;
    fitted.current = id;
    fit();
  });

  const objectsOf = {};
  for (const o of objects) if (o.className) (objectsOf[o.className] = objectsOf[o.className] || []).push(o.name);
  const errorCount = {};
  if (compile.state === 'errors') for (const p of compile.problems) if (p.severity === 'error') errorCount[p.file] = (errorCount[p.file] || 0) + 1;
  const testResult = {};
  for (const r of (tests && tests.results) || []) {
    const e = (testResult[r.className] = testResult[r.className] || { passed: 0, total: 0 });
    e.total++;
    if (r.status === 'passed') e.passed++;
  }

  const rects = {};
  for (const k of keys) rects[k] = { ...pos(k), w: sizes[k]?.w || 200, h: sizes[k]?.h || 80 };
  const visible = new Set(classes.map((c) => c.fileClass));
  const edges = model.edges.filter((e) => visible.has(e.from) && visible.has(e.to) && (showUses || e.kind !== 'uses'));

  /** Arrow keys move the selection to the nearest class card in that direction. */
  const moveSelection = (from, key) => {
    const a = rects[from];
    if (!a) return;
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    let best = null;
    for (const c of classes) {
      if (c.fileClass === from) continue;
      const b = rects[c.fileClass];
      const dx = b.x + b.w / 2 - cx;
      const dy = b.y + b.h / 2 - cy;
      const along = key === 'ArrowRight' ? dx : key === 'ArrowLeft' ? -dx : key === 'ArrowDown' ? dy : -dy;
      const across = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 4) continue;
      const score = along + across * 2;
      if (!best || score < best.score) best = { score, cls: c.fileClass };
    }
    if (best) {
      setState({ selectedClass: best.cls });
      const el = cardRefs.current[best.cls];
      if (el) el.focus();
    }
  };
  const kinds = new Set(edges.map((e) => e.kind));

  const onWheel = (e) => {
    if (e.ctrlKey) {
      const host = hostRef.current.getBoundingClientRect();
      const mx = e.clientX - host.left;
      const my = e.clientY - host.top;
      setView((v) => {
        const k = Math.min(1.6, Math.max(0.4, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
      });
    } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };
  const zoomBy = (f) => {
    const host = hostRef.current;
    const mx = host.clientWidth / 2;
    const my = host.clientHeight / 2;
    setView((v) => {
      const k = Math.min(1.6, Math.max(0.4, v.k * f));
      return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
    });
  };

  const startPan = (e) => {
    if (e.button !== 0 || e.target.closest('.dcard') || e.target.closest('button')) return;
    setState({ selectedClass: null });
    setPanning(true);
    let lx = e.clientX;
    let ly = e.clientY;
    const move = (ev) => {
      setView((v) => ({ ...v, x: v.x + ev.clientX - lx, y: v.y + ev.clientY - ly }));
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startDrag = (e, key, onClick) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    const origin = { ...pos(key) };
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / view.k;
      const dy = (ev.clientY - start.y) / view.k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      setDragging(key);
      A.setPosition(key, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(null);
      if (moved) {
        const p = getState().positions[key];
        A.setPosition(key, { x: Math.round(p.x / SNAP) * SNAP, y: Math.round(p.y / SNAP) * SNAP });
      } else onClick && onClick();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const compiledOk = compile.state === 'ok' && benchState !== 'off';

  return (
    <section className="panel" aria-label={t('diagram.title')}>
      <div className="panel-head">
        <h2>{t('diagram.title')}</h2>
        {pkg && <span className="muted mono head-pkg">{pkg}</span>}
        <span className="grow" />
        {!readOnly && (
          <>
            <button className="icon-btn" aria-label={t('ws.newClass')} title={t('ws.newClass') + ' · Strg+N'} onClick={() => A.openDialogBox({ type: 'newClass' })}>
              <Icon name="plus" />
            </button>
            <button className="icon-btn" aria-label={t('diagram.newPackage')} title={t('diagram.newPackage')} onClick={() => A.openDialogBox({ type: 'newPackage' })}>
              <Icon name="folderPlus" />
            </button>
          </>
        )}
        <button className="icon-btn" aria-pressed={details} aria-label={t('diagram.details')} title={t('diagram.details')} onClick={() => A.updateSettings({ diagramDetails: !details })} style={details ? { color: 'var(--text)' } : undefined}>
          <Icon name="layers" />
        </button>
        <button className="icon-btn" aria-pressed={showUses} aria-label={t('diagram.showUses')} title={t('diagram.showUses')} onClick={() => A.updateSettings({ showUses: !showUses })} style={showUses ? { color: 'var(--text)' } : undefined}>
          <Icon name="link" />
        </button>
        {!readOnly && (
          <button className="icon-btn" aria-label={t('diagram.arrange')} title={t('diagram.arrange')} onClick={A.arrange}>
            <Icon name="arrange" />
          </button>
        )}
      </div>
      <div className={'diagram' + (panning ? ' panning' : '')} ref={hostRef} onPointerDown={startPan} onWheel={onWheel}>
        {keys.length === 0 && !pkg ? (
          <div className="diagram-empty">
            <span>{t('diagram.empty')}</span>
            <button className="btn btn-sm" onClick={() => A.openDialogBox({ type: 'newClass' })}>
              <Icon name="plus" />
              {t('diagram.emptyAction')}
            </button>
          </div>
        ) : (
          <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            <svg className="edges" width="1" height="1">
              {edges.map((e, i) => (
                <Edge key={i} from={rects[e.from]} to={rects[e.to]} kind={e.kind} hl={highlight && (e.from === highlight || e.to === highlight) && e.kind !== 'uses'} />
              ))}
            </svg>

            {readme && !pkg && (
              <div className="dcard note-card" style={{ left: noteAt.x, top: noteAt.y }} onDoubleClick={A.openReadme} onClick={A.openReadme} role="button" tabIndex={0} title={readme.name}>
                <Icon name="file" />
                <span>{readme.name}</span>
              </div>
            )}

            {pkg && (
              <div className="dcard pkg-card up" style={{ left: noteAt.x, top: noteAt.y }} onDoubleClick={() => A.enterPackage(pkg.includes('.') ? pkg.slice(0, pkg.lastIndexOf('.')) : '')} onClick={() => A.enterPackage(pkg.includes('.') ? pkg.slice(0, pkg.lastIndexOf('.')) : '')} role="button" tabIndex={0}>
                <span className="pkg-tab" />
                <span className="pkg-name">{t('diagram.up')}</span>
              </div>
            )}

            {subPkgs.map((p) => {
              const k = 'pkg:' + p;
              const count = model.list.filter((c) => c.pkg === p || c.pkg.startsWith(p + '.')).length;
              return (
                <div
                  key={k}
                  ref={(el) => { cardRefs.current[k] = el; }}
                  className={'dcard pkg-card' + (dragging === k ? ' dragging' : '')}
                  style={{ left: pos(k).x, top: pos(k).y }}
                  onPointerDown={(e) => startDrag(e, k)}
                  onDoubleClick={() => A.enterPackage(p)}
                  onKeyDown={(e) => e.key === 'Enter' && A.enterPackage(p)}
                  role="button"
                  tabIndex={0}
                  aria-label={p}
                >
                  <span className="pkg-tab" />
                  <span className="pkg-name">{simpleName(p)}</span>
                  <span className="pkg-meta">{count === 1 ? t('diagram.class1') : t('diagram.classes', { n: count })}</span>
                </div>
              );
            })}

            {classes.map((info) => {
              const cls = info.fileClass;
              const p = pos(cls);
              const file = files[info.file];
              const stale = compile.state !== 'ok' || compile.snapshot[info.file] !== file.content;
              const errors = errorCount[info.file] || 0;
              const objs = objectsOf[cls] || [];
              const tr = testResult[cls];
              const stereo = info.isTest ? 'Test' : info.kind === 'abstract' ? 'abstract' : info.kind === 'interface' ? 'interface' : info.kind === 'enum' ? 'enum' : null;
              const state = errors ? 'bad' : stale ? 'stale' : 'ok';
              const canNew = compiledOk && !stale && info.kind === 'class' && !info.isTest;
              return (
                <div
                  key={cls}
                  ref={(el) => { cardRefs.current[cls] = el; }}
                  className={['dcard', 'class-card', info.kind, info.isTest ? 'test' : '', stale ? 'uncompiled' : '', selected === cls ? 'selected' : '', highlight === cls ? 'hl' : '', dragging === cls ? 'dragging' : ''].join(' ')}
                  style={{ left: p.x, top: p.y }}
                  onPointerDown={(e) => startDrag(e, cls, () => setState({ selectedClass: cls }))}
                  onDoubleClick={() => A.openClass(cls)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setState({ selectedClass: cls });
                    classMenu(cls, e.clientX, e.clientY, t);
                  }}
                  onFocus={() => setState({ selectedClass: cls })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') A.openClass(cls);
                    if (e.key.startsWith('Arrow')) {
                      e.preventDefault();
                      moveSelection(cls, e.key);
                    }
                    if (e.key === 'Delete' && !readOnly) A.openDialogBox({ type: 'delete', cls });
                    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                      const r = e.currentTarget.getBoundingClientRect();
                      classMenu(cls, r.left + 16, r.top + 24, t);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={info.simple}
                >
                  <div className="class-top">
                    {stereo && <div className="stereo">«{stereo}»</div>}
                    <div className="class-name-row">
                      <span className="class-name">{info.simple}</span>
                      <span className={'state-dot ' + state} title={errors ? t('diagram.errors', { n: errors }) : stale ? t('diagram.notCompiled') : t('diagram.compiled')} />
                    </div>
                    {(errors > 0 || (!details && (info.extends[0] || info.implements.length))) && (
                      <div className="class-meta">
                        {errors > 0 ? <span className="pill pill-neg">{t('diagram.errors', { n: errors })}</span> : <span>{info.extends[0] ? `extends ${info.extends[0]}` : `implements ${info.implements.join(', ')}`}</span>}
                      </div>
                    )}
                  </div>
                  {details && <Members info={info} />}
                  {(objs.length > 0 || tr) && (
                    <div className="class-foot">
                      {tr ? (
                        <span className={tr.passed === tr.total ? 'tests-ok' : 'tests-bad'}>{t('tests.cardResult', { passed: tr.passed, total: tr.total })}</span>
                      ) : (
                        objs.slice(0, 4).map((n) => (
                          <button key={n} className="obj-chip" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); A.showInspector(n, n); }}>{n}</button>
                        ))
                      )}
                      {!tr && objs.length > 4 && <span className="muted">+{objs.length - 4}</span>}
                    </div>
                  )}
                  {(canNew || (info.isTest && compiledOk && !stale)) && (
                    <button
                      className="card-quick"
                      title={info.isTest ? t('menu.runTests') : t('diagram.quickNew', { name: info.simple })}
                      aria-label={info.isTest ? t('menu.runTests') : t('diagram.quickNew', { name: info.simple })}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (info.isTest) A.runTests({ className: cls });
                        else quickNew(cls, t, e.currentTarget.getBoundingClientRect());
                      }}
                    >
                      <Icon name={info.isTest ? 'play' : 'plus'} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="diagram-tools">
          <button className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(0.85)}><Icon name="minus" /></button>
          <span className="zoom-label">{Math.round(view.k * 100)}%</span>
          <button className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.15)}><Icon name="plus" /></button>
          <button className="icon-btn" aria-label={t('diagram.fit')} title={t('diagram.fit')} onClick={fit}><Icon name="fit" /></button>
        </div>
        {kinds.size > 0 && (
          <div className="diagram-legend" aria-hidden="true">
            {kinds.has('extends') && (
              <span>
                <svg viewBox="0 0 26 10"><path d="M1 5h16" stroke="var(--edge)" /><path d="M24 5l-7 -4v8z" fill="var(--surface)" stroke="var(--edge)" /></svg>
                {t('diagram.legend.extends')}
              </span>
            )}
            {kinds.has('impl') && (
              <span>
                <svg viewBox="0 0 26 10"><path d="M1 5h16" stroke="var(--edge)" strokeDasharray="4 3" /><path d="M24 5l-7 -4v8z" fill="var(--surface)" stroke="var(--edge)" /></svg>
                {t('diagram.legend.implements')}
              </span>
            )}
            {kinds.has('uses') && (
              <span>
                <svg viewBox="0 0 26 10"><path d="M1 5h22" stroke="var(--edge)" strokeDasharray="3 3" /><path d="M18 1l6 4-6 4" fill="none" stroke="var(--edge)" /></svg>
                {t('diagram.legend.uses')}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
