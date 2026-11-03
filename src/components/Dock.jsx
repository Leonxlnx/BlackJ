import { useEffect, useRef, useState } from 'react';
import { useStore, setState, getState } from '../store.js';
import { useT, translate } from '../i18n.js';
import A, { PANEL } from '../panels.js';
import { explainProblem } from '../lib/errors.js';
import { explainException } from '../lib/exceptions.js';
import Icon, { Why } from './Icon.jsx';
import CodePad from './CodePad.jsx';
import TestsPanel from './TestsPanel.jsx';
import DebugPanel from './DebugPanel.jsx';
import PopOut from './PopOut.jsx';

function methodLabel(m) {
  return (
    <span className="sig">
      <span className="ret">{m.returnType} </span>
      {m.name}({m.params.map((p) => (/^arg\d+$/.test(p.name) ? p.type : `${p.type} ${p.name}`)).join(', ')})
    </span>
  );
}

export async function objectMenu(obj, x, y) {
  const s = getState();
  const t = (k, p) => translate(s.settings.lang, k, p);
  const items = [];
  const desc = obj.value && obj.value.project ? await A.describe(obj.className) : null;
  if (desc) {
    const groups = new Map();
    for (const m of desc.methods) {
      if (m.abstract) continue;
      const g = m.declaringClass === desc.name ? '' : m.declaringClass;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    }
    const seen = new Set();
    for (const [g, list] of groups) {
      if (g) {
        items.push({ type: 'sep' });
        items.push({ type: 'label', text: t('menu.inheritedFrom', { cls: A.simpleName(g) }) });
      }
      for (const m of list) {
        const tour = seen.has(m.name) ? undefined : 'method:' + m.name;
        seen.add(m.name);
        items.push({ label: methodLabel(m), tour, onClick: () => A.openDialogBox({ type: 'call', kind: m.static ? 'static' : 'method', cls: obj.className, target: obj.name, method: m }) });
      }
    }
    items.push({ type: 'sep' });
  } else if (obj.className && obj.value && obj.value.kind !== 'null' && obj.value.kind !== 'array') {
    // A library object (String, ArrayList, Random …): its methods in a searchable list.
    items.push({ label: t('menu.libMethods'), tour: 'libMethods', onClick: () => A.openDialogBox({ type: 'library', target: obj.name, cls: obj.className, typeLabel: obj.type }) });
    items.push({ type: 'sep' });
  }
  items.push({ label: t('menu.inspect'), tour: 'inspect', onClick: () => A.showInspector(obj.name, obj.name) });
  items.push({ label: t('menu.remove'), tour: 'remove', onClick: () => A.removeObject(obj.name) });
  A.openMenu({ x, y, items });
}

function Bench() {
  const t = useT();
  const objects = useStore((s) => s.bench.objects);
  const benchState = useStore((s) => s.bench.state);
  const lastNew = useStore((s) => s.bench.lastNew);
  const inspected = useStore((s) => s.inspect && s.inspect.ref);
  if (!objects.length) {
    return (
      <div className="dock-empty" data-tour="bench">
        <div className="empty-line">{benchState === 'off' ? <>{t('bench.emptyNotCompiled')} <kbd>{t('bench.compileKey')}</kbd></> : t('bench.empty')}</div>
      </div>
    );
  }
  return (
    <div className="bench" data-tour="bench">
      {objects.map((o) => (
        <div
          key={o.name}
          data-tour={'object:' + o.name}
          className={'obj' + (o.name === lastNew ? ' new' : '') + (o.name === inspected ? ' inspected' : '')}
          role="button"
          tabIndex={0}
          onClick={(e) => objectMenu(o, e.clientX, e.clientY)}
          onContextMenu={(e) => {
            e.preventDefault();
            objectMenu(o, e.clientX, e.clientY);
          }}
          onDoubleClick={() => A.showInspector(o.name, o.name)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              objectMenu(o, r.left + 12, r.bottom + 4);
            }
          }}
          onMouseEnter={() => setState({ highlightClass: o.className })}
          onMouseLeave={() => setState({ highlightClass: null })}
          aria-label={`${o.name}: ${o.type}`}
        >
          <span className="obj-name">
            <span className="n">{o.name}</span>
            <span className="type">{o.type}</span>
          </span>
          {o.preview && o.preview.length > 0 ? (
            <span className="obj-fields">
              {o.preview.map((p) => (
                <span key={p.name} className="obj-field">
                  <span className="k">{p.name}</span>
                  <span className="v">{p.text}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="obj-value">{o.value && o.value.text ? o.value.text : ' '}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Console() {
  const t = useT();
  const lines = useStore((s) => s.console);
  const benchState = useStore((s) => s.bench.state);
  const [text, setText] = useState('');
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const waiting = benchState === 'waiting';

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  useEffect(() => {
    if (waiting && inputRef.current) inputRef.current.focus();
  }, [waiting]);

  return (
    <>
      <div className="dock-body" ref={bodyRef}>
        {lines.length === 0 ? (
          <div className="dock-empty">
            <div className="empty-line">{t('console.empty')}</div>
          </div>
        ) : (
          <pre className="console">
            {lines.map((l) =>
              l.stream === 'note' ? (
                <div key={l.id} className="note">{l.text}</div>
              ) : l.stream === 'call' ? (
                <div key={l.id} className="call">{'> '}<b>{l.text}</b></div>
              ) : (
                <span key={l.id} className={l.stream === 'err' ? 'err' : l.stream === 'in' ? 'in' : ''}>{l.text}</span>
              ),
            )}
          </pre>
        )}
      </div>
      <form
        className={'console-input' + (waiting ? ' waiting' : '')}
        data-tour="console-input"
        onSubmit={(e) => {
          e.preventDefault();
          A.sendInput(text);
          setText('');
        }}
      >
        <label htmlFor="console-in">{waiting ? t('console.inputWaiting') : t('console.input')}</label>
        <input id="console-in" ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} disabled={benchState === 'off'} autoComplete="off" spellCheck="false" />
        <button className="btn btn-sm" type="submit" disabled={benchState === 'off'}>{t('console.send')}</button>
      </form>
    </>
  );
}

function Problems() {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const compile = useStore((s) => s.compile);
  const exception = useStore((s) => s.exception);
  const hasKey = useStore((s) => A.aiOn(s));
  const aiOff = useStore((s) => !!s.settings.aiOff);
  const problems = compile.state === 'errors' ? compile.problems : [];
  if (!problems.length && !exception) {
    return (
      <div className="dock-empty">
        <div className="empty-line">{compile.state === 'never' ? t('problems.never') : t('problems.empty')}</div>
      </div>
    );
  }
  return (
    <div className="problems">
      {exception && (() => {
        const ex = explainException(exception.simpleType, lang);
        return (
          <div className="problem" data-tour="problem:1">
            <div className="problem-title">
              <span className="pill pill-neg">{exception.simpleType}</span>
              {ex.title}
            </div>
            {!aiOff && (
              <div className="problem-actions">
                <button className="btn btn-sm btn-quiet" onClick={() => A.askTutor(translate(lang, 'tutor.prompt.explainException', { type: exception.simpleType, message: exception.message ? ': ' + exception.message : '' }))}>
                  <Icon name="tutor" />
                  {t('problems.ask')}
                </button>
              </div>
            )}
            <p className="problem-fix">{ex.fix}</p>
            <div className="problem-loc">
              {(exception.frames || []).filter((fr) => fr.project).map((fr, i) => (
                <button key={i} className="problem-where" onClick={() => A.openClass(fr.className, fr.line)}>
                  {t('problems.at', { file: A.simpleName(fr.className).split('$')[0] + '.java', method: fr.method, line: fr.line })}
                </button>
              ))}
            </div>
            <Why>
              <span>{ex.explain}</span>
              {exception.message && <span className="mono">{exception.simpleType}: {exception.message}</span>}
            </Why>
          </div>
        );
      })()}
      {problems.map((p, i) => {
        const ex = explainProblem(p, lang);
        return (
          <div className="problem" key={i} data-tour={'problem:' + (i + 1 + (exception ? 1 : 0))}>
            <div className="problem-title">{ex.title}</div>
            <div className="problem-actions">
              {/class (\S+) is public, should be declared in a file named/.test(p.message) && (
                <button className="btn btn-sm btn-primary" onClick={() => A.renameToClass(p.file, p.message.match(/class (\S+) is public/)[1])}>
                  {t('problems.rename', { name: p.message.match(/class (\S+) is public/)[1] + '.java' })}
                </button>
              )}
              {hasKey && (
                <button className="btn btn-sm" onClick={() => A.aiFix(p)}>
                  <Icon name="tutor" />
                  {t('ai.fix')}
                </button>
              )}
              {!aiOff && (
                <button className="btn btn-sm btn-quiet" onClick={() => A.askTutor(translate(lang, 'tutor.prompt.explainProblem', { file: p.file, line: p.line, message: p.message }))}>
                  <Icon name="tutor" />
                  {t('problems.ask')}
                </button>
              )}
            </div>
            <p className="problem-fix">{ex.fix}</p>
            <div className="problem-loc">
              <button className="problem-where" onClick={() => A.openFile(p.file, p.line)}>
                {p.file.split('/').pop()} · {t('problems.line', { line: p.line })}
              </button>
            </div>
            <Why>
              <span>{ex.explain}</span>
              <span className="mono">javac: {p.message}{p.details.length ? ' · ' + p.details.join(' · ') : ''}</span>
            </Why>
          </div>
        );
      })}
    </div>
  );
}

export default function Dock() {
  const t = useT();
  const dock = useStore((s) => s.dock);
  const objects = useStore((s) => s.bench.objects);
  const benchState = useStore((s) => s.bench.state);
  const compile = useStore((s) => s.compile);
  const exception = useStore((s) => s.exception);
  const consoleLines = useStore((s) => s.console.length);
  const tests = useStore((s) => s.tests);
  const paused = useStore((s) => s.debug && s.debug.paused);
  const recording = useStore((s) => s.recording);
  const collapsed = useStore((s) => s.dockCollapsed);
  // Switching to another tab (also automatically: input needed, errors, breakpoint) opens the dock.
  useEffect(() => {
    if (getState().dockCollapsed) setState({ dockCollapsed: false });
  }, [dock]);
  const problemCount = (compile.state === 'errors' ? compile.problems.length : 0) + (exception ? 1 : 0);
  // In a narrow column the strip scrolls (wheel too) under a fade, and the tabs that do not fit
  // are also in a "…" menu, so moving the dock never hides a feature.
  const tabsRef = useRef(null);
  const [hidden, setHidden] = useState([]);
  const updateStrip = () => {
    const el = tabsRef.current;
    if (!el) return;
    el.classList.toggle('fade-l', el.scrollLeft > 1);
    el.classList.toggle('fade-r', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    const box = el.getBoundingClientRect();
    const out = [...el.querySelectorAll('.tab')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.left < box.left - 1 || r.right > box.right + 1;
    }).map((b) => b.dataset.tour.slice(5));
    setHidden((prev) => (prev.join() === out.join() ? prev : out));
  };
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(updateStrip);
    ro.observe(el);
    const wheel = (e) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, []);
  useEffect(() => {
    const el = tabsRef.current && tabsRef.current.querySelector('.tab[aria-selected="true"]');
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateStrip();
  }, [dock, collapsed, objects.length, problemCount, tests.summary, paused]);
  const labels = { objects: t('dock.objects'), console: t('dock.console'), pad: t('dock.pad'), tests: t('dock.tests'), problems: t('dock.problems'), debug: t('dock.debug') };
  const tab = (id, label, count, bad) => (
    <button className="tab" role="tab" data-tour={'dock:' + id} aria-selected={dock === id && !collapsed} onClick={() => setState({ dock: id, dockCollapsed: false })}>
      <span className="tab-label">{label}</span>
      {count != null && <span className={'count' + (bad ? ' bad' : '')}>{count}</span>}
    </button>
  );
  return (
    <section className="panel dock-panel" aria-label={t('dock.objects')}>
      <div className="panel-head">
        <div className="tabs" role="tablist" ref={tabsRef} onScroll={updateStrip}>
          {tab('objects', t('dock.objects'), objects.length || null)}
          {tab('console', t('dock.console'), null)}
          {tab('pad', t('dock.pad'), null)}
          {tab('tests', t('dock.tests'), tests.summary ? `${tests.summary.passed}/${tests.summary.total}` : null, tests.summary && tests.summary.failed > 0)}
          {tab('problems', t('dock.problems'), problemCount || null, problemCount > 0)}
          {tab('debug', t('dock.debug'), paused ? '●' : null, !!paused)}
        </div>
        {hidden.length > 0 && (
          <button
            className="icon-btn dock-more"
            aria-label={t('dock.more')}
            title={t('dock.more')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              A.openMenu({ x: r.left, y: r.bottom + 4, items: hidden.map((id) => ({ label: labels[id], onClick: () => setState({ dock: id, dockCollapsed: false }) })) });
            }}
          >
            <Icon name="more" />
          </button>
        )}
        <span className="grow" />
        {recording && (
          <>
            <span className="rec-pill"><span className="rec-dot" />{t('record.banner', { method: recording.method })}</span>
            <button className="btn btn-sm" onClick={() => A.stopRecording(true)}>{t('record.stop')}</button>
            <button className="btn btn-sm btn-quiet" onClick={() => A.stopRecording(false)}>{t('common.cancel')}</button>
          </>
        )}
        {!recording && dock === 'objects' && (
          <button className="btn btn-sm btn-quiet" data-tour="library" onClick={() => A.openDialogBox({ type: 'library' })} title={t('lib.text')}>
            <Icon name="book" />
            <span className="wide-only">{t('lib.short')}</span>
          </button>
        )}
        {!recording && dock === 'objects' && objects.length > 0 && (
          <button className="btn btn-sm btn-quiet" onClick={A.stopProgram}>
            <Icon name="reset" />
            <span className="wide-only">{t('ws.reset')}</span>
          </button>
        )}
        {dock === 'console' && consoleLines > 0 && <button className="btn btn-sm btn-quiet" onClick={A.clearConsole}>{t('console.clear')}</button>}
        {(benchState === 'running' || benchState === 'waiting') && dock !== 'debug' && (
          <button className="btn btn-sm" onClick={A.stopProgram}>
            <Icon name="stop" />
            <span className="wide-only">{t('ws.stop')}</span>
          </button>
        )}
        <PopOut panel="dock" />
        {!PANEL && <button className="icon-btn" aria-label={collapsed ? t('dock.expand') : t('dock.collapse')} title={collapsed ? t('dock.expand') : t('dock.collapse')} onClick={() => setState({ dockCollapsed: !collapsed })}>
          <Icon name={collapsed ? 'chevronUp' : 'chevron'} />
        </button>}
      </div>
      <div className="dock-body" style={{ display: collapsed ? 'none' : 'flex', flexDirection: 'column' }}>
        {dock === 'objects' && <div className="dock-body"><Bench /></div>}
        {dock === 'console' && <Console />}
        {dock === 'pad' && <CodePad />}
        {dock === 'tests' && <TestsPanel />}
        {dock === 'problems' && <div className="dock-body"><Problems /></div>}
        {dock === 'debug' && <DebugPanel />}
      </div>
    </section>
  );
}
