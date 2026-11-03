import { useEffect, useRef, useState } from 'react';
import { useStore, setState, getState } from '../store.js';
import { useT, translate } from '../i18n.js';
import * as A from '../actions.js';
import { explainProblem } from '../lib/errors.js';
import { explainException } from '../lib/exceptions.js';
import Icon from './Icon.jsx';
import CodePad from './CodePad.jsx';
import TestsPanel from './TestsPanel.jsx';
import DebugPanel from './DebugPanel.jsx';

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
    for (const [g, list] of groups) {
      if (g) {
        items.push({ type: 'sep' });
        items.push({ type: 'label', text: t('menu.inheritedFrom', { cls: A.simpleName(g) }) });
      }
      for (const m of list) items.push({ label: methodLabel(m), onClick: () => A.openDialogBox({ type: 'call', kind: m.static ? 'static' : 'method', cls: obj.className, target: obj.name, method: m }) });
    }
    items.push({ type: 'sep' });
  }
  items.push({ label: t('menu.inspect'), icon: 'eye', onClick: () => A.showInspector(obj.name, obj.name) });
  items.push({ label: t('menu.remove'), icon: 'trash', onClick: () => A.removeObject(obj.name) });
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
      <div className="dock-empty">
        <div className="empty-line">{benchState === 'off' ? t('bench.emptyNotCompiled') : t('bench.empty')}</div>
      </div>
    );
  }
  return (
    <div className="bench">
      {objects.map((o) => (
        <div
          key={o.name}
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
  const hasKey = useStore((s) => s.info.tutor.hasKey);
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
          <div className="problem">
            <div className="problem-title">
              <span className="pill pill-neg">{exception.simpleType}</span>
              {ex.title}
            </div>
            <div className="problem-actions">
              <button className="btn btn-sm btn-quiet" onClick={() => A.askTutor(translate(lang, 'tutor.prompt.explainException', { type: exception.simpleType, message: exception.message ? ': ' + exception.message : '' }))}>
                <Icon name="tutor" />
                {t('problems.ask')}
              </button>
            </div>
            {exception.message && <p className="mono" style={{ color: 'var(--text)' }}>{exception.message}</p>}
            <p>{ex.explain} <span className="fix">{ex.fix}</span></p>
            <div className="frames">
              {(exception.frames || []).filter((fr) => fr.project).map((fr, i) => (
                <button key={i} className="problem-where" style={{ textAlign: 'left' }} onClick={() => A.openClass(fr.className, fr.line)}>
                  {t('problems.at', { cls: A.simpleName(fr.className), method: fr.method, line: fr.line })}
                </button>
              ))}
            </div>
          </div>
        );
      })()}
      {problems.map((p, i) => {
        const ex = explainProblem(p, lang);
        return (
          <div className="problem" key={i}>
            <div className="problem-title">{ex.title}</div>
            <div className="problem-actions">
              {hasKey && (
                <button className="btn btn-sm" onClick={() => A.aiFix(p)}>
                  <Icon name="spark" />
                  {t('ai.fix')}
                </button>
              )}
              <button className="btn btn-sm btn-quiet" onClick={() => A.askTutor(translate(lang, 'tutor.prompt.explainProblem', { file: p.file, line: p.line, message: p.message }))}>
                <Icon name="tutor" />
                {t('problems.ask')}
              </button>
            </div>
            <div>
              <button className="problem-where" onClick={() => A.openFile(p.file, p.line)}>
                {p.file} · {t('problems.line', { line: p.line })}
              </button>
            </div>
            <p>{ex.explain} <span className="fix">{ex.fix}</span></p>
            <div className="orig">javac: {p.message}{p.details.length ? ' · ' + p.details.join(' · ') : ''}</div>
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
  const problemCount = (compile.state === 'errors' ? compile.problems.length : 0) + (exception ? 1 : 0);
  const tab = (id, label, count, bad) => (
    <button className="tab" role="tab" aria-selected={dock === id} onClick={() => setState({ dock: id })}>
      <span className="tab-label">{label}</span>
      {count != null && <span className={'count' + (bad ? ' bad' : '')}>{count}</span>}
    </button>
  );
  return (
    <section className="panel" aria-label={t('dock.objects')}>
      <div className="panel-head">
        <div className="tabs" role="tablist">
          {tab('objects', t('dock.objects'), objects.length)}
          {tab('console', t('dock.console'), null)}
          {tab('pad', t('dock.pad'), null)}
          {tab('tests', t('dock.tests'), tests.summary ? `${tests.summary.passed}/${tests.summary.total}` : null, tests.summary && tests.summary.failed > 0)}
          {tab('problems', t('dock.problems'), problemCount || null, problemCount > 0)}
          {tab('debug', t('dock.debug'), paused ? '●' : null, !!paused)}
        </div>
        <span className="grow" />
        {recording && (
          <>
            <span className="rec-pill"><span className="rec-dot" />{t('record.banner', { method: recording.method })}</span>
            <button className="btn btn-sm" onClick={() => A.stopRecording(true)}>{t('record.stop')}</button>
            <button className="btn btn-sm btn-quiet" onClick={() => A.stopRecording(false)}>{t('common.cancel')}</button>
          </>
        )}
        {!recording && dock === 'objects' && objects.length > 0 && (
          <button className="btn btn-sm btn-quiet" onClick={A.stopProgram}>
            <Icon name="reset" />
            {t('ws.reset')}
          </button>
        )}
        {dock === 'console' && consoleLines > 0 && <button className="btn btn-sm btn-quiet" onClick={A.clearConsole}>{t('console.clear')}</button>}
        {(benchState === 'running' || benchState === 'waiting') && (
          <button className="btn btn-sm" onClick={A.stopProgram}>
            <Icon name="stop" />
            {t('ws.stop')}
          </button>
        )}
      </div>
      <div className="dock-body" style={{ display: 'flex', flexDirection: 'column' }}>
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
