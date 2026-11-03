import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { useT } from '../i18n.js';
import A from '../panels.js';
import { explainProblem } from '../lib/errors.js';
import { explainException } from '../lib/exceptions.js';
import { valueText } from './InspectorPanel.jsx';
import Icon from './Icon.jsx';

function Result({ e, t, lang }) {
  if (e.status === 'running') return <div className="pad-out muted">…</div>;
  if (e.status === 'value') {
    const v = e.value;
    const ref = (v.kind === 'object' || v.kind === 'array') && v.handle;
    return (
      <div className="pad-out">
        <span className={'pad-value ' + (v.kind === 'string' ? 'v-str' : v.kind === 'null' ? 'v-null' : 'v-num')}>{valueText(v)}</span>
        <span className="pad-type">{e.type}</span>
        {ref && (
          <span className="pad-actions">
            <button className="link" onClick={() => A.showInspector(v.handle, e.code.slice(0, 24))}>{t('result.inspect')}</button>
            <button className="link" onClick={() => A.storeOnBench(v.handle)}>{t('result.toBench')}</button>
          </span>
        )}
      </div>
    );
  }
  if (e.status === 'done') return <div className="pad-out muted">{t('pad.done')}</div>;
  if (e.status === 'error') {
    return (
      <div className="pad-out pad-err">
        {e.diagnostics.slice(0, 3).map((d, i) => {
          const [message, ...details] = d.message.split('\n').map((x) => x.trim());
          const ex = explainProblem({ message, details }, lang);
          return (
            <div key={i} title={ex.fix + '\n' + d.message.replace(/\n\s*/g, ' · ')}>
              <strong>{ex.title}</strong>
              <span className="fix">{ex.fix}</span>
            </div>
          );
        })}
      </div>
    );
  }
  if (e.status === 'exception') {
    const ex = explainException(e.exception.simpleType, lang);
    return (
      <div className="pad-out pad-err">
        <span className="pill pill-neg">{e.exception.simpleType}</span> <strong>{ex.title}</strong>
        {e.exception.message && <div className="mono">{e.exception.message}</div>}
      </div>
    );
  }
  return <div className="pad-out pad-err">{e.error}</div>;
}

/** BlueJ's code pad: type Java, see the value. Variables and bench objects stay available. */
export default function CodePad() {
  const t = useT();
  const pad = useStore((s) => s.pad);
  const objects = useStore((s) => s.bench.objects);
  const lang = useStore((s) => s.settings.lang);
  const [code, setCode] = useState('');
  const [hist, setHist] = useState(-1);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pad.entries]);

  const history = pad.entries.map((e) => e.code);
  const run = () => {
    if (!code.trim()) return;
    A.padRun(code);
    setCode('');
    setHist(-1);
  };

  return (
    <div className="pad">
      <div className="pad-main">
        <div className="pad-list" ref={listRef}>
          {pad.entries.length === 0 && (
            <div className="pad-intro">
              <p>{t('pad.empty')}</p>
              <div className="pad-examples">
                {['1 + 2 * 3', '"Hallo".length()', 'Math.sqrt(16)', ...(objects[0] ? [`${objects[0].name}.toString()`] : [])].map((ex) => (
                  <button key={ex} className="pad-example" onClick={() => { setCode(ex); inputRef.current && inputRef.current.focus(); }}>{ex}</button>
                ))}
              </div>
            </div>
          )}
          {pad.entries.map((e) => (
            <div key={e.id} className="pad-entry">
              <div className="pad-in mono">
                <span className="pad-prompt">›</span>
                <span>{e.code}</span>
              </div>
              <Result e={e} t={t} lang={lang} />
            </div>
          ))}
        </div>
        <div className="pad-input" data-tour="pad-input">
          <span className="pad-prompt">›</span>
          <textarea
            ref={inputRef}
            className="mono"
            rows={Math.min(5, Math.max(1, code.split('\n').length))}
            value={code}
            placeholder={t('pad.placeholder')}
            spellCheck="false"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                run();
              } else if (e.key === 'ArrowUp' && !code.includes('\n') && history.length) {
                e.preventDefault();
                const i = hist < 0 ? history.length - 1 : Math.max(0, hist - 1);
                setHist(i);
                setCode(history[i]);
              } else if (e.key === 'ArrowDown' && hist >= 0) {
                e.preventDefault();
                const i = hist + 1;
                if (i >= history.length) { setHist(-1); setCode(''); } else { setHist(i); setCode(history[i]); }
              }
            }}
            aria-label={t('pad.title')}
          />
          <button className="btn btn-sm" onClick={run} disabled={!code.trim() || pad.busy}>
            <Icon name="play" />
            {t('pad.run')}
          </button>
        </div>
      </div>
      <aside className="pad-vars">
        <div className="pad-vars-head">
          <span>{t('pad.vars')}</span>
          {(pad.entries.length > 0 || pad.vars.length > 0) && <button className="btn btn-sm btn-quiet" onClick={A.padReset}>{t('pad.reset')}</button>}
        </div>
        {pad.vars.length === 0 && objects.length === 0 && <p className="muted">{t('pad.noVars')}</p>}
        {pad.vars.map((v) => (
          <div key={v.name} className="pad-var">
            <span className="pad-var-name">{v.name}</span>
            <span className="pad-type">{v.type}</span>
            <span className="pad-var-val mono" title={valueText(v.value)}>{valueText(v.value)}</span>
          </div>
        ))}
        {objects.length > 0 && <div className="pad-vars-sub">{t('pad.benchVars')}</div>}
        {objects.map((o) => (
          <div key={o.name} className="pad-var">
            <span className="pad-var-name">{o.name}</span>
            <span className="pad-type">{o.type}</span>
          </div>
        ))}
      </aside>
    </div>
  );
}
