import { useState } from 'react';
import { useStore } from '../store.js';
import { useT, formatKeys } from '../i18n.js';
import A from '../panels.js';
import { valueText } from './InspectorPanel.jsx';
import Icon from './Icon.jsx';
import { useRunState, frameLabel } from './RunStrip.jsx';
import { PauseGlyph, ResumeGlyph, StopGlyph, ArmedGlyph } from './RuntimeGlyphs.jsx';

function VarRow({ v, depth = 0 }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState(null);
  const expandable = v.value && v.value.objectId != null && (v.value.kind === 'object' || v.value.kind === 'array');
  const toggle = async () => {
    if (!expandable) return;
    if (!open && !children) {
      const r = await A.debugExpand(v.value.objectId);
      setChildren(Array.isArray(r) ? r : r.children || []);
    }
    setOpen(!open);
  };
  return (
    <>
      <div className="dbg-var" style={{ paddingLeft: 12 + depth * 14 }}>
        <button className={'dbg-twisty' + (expandable ? '' : ' none')} onClick={toggle} aria-label={open ? '−' : '+'}>{expandable ? (open ? '▾' : '▸') : ''}</button>
        <span className="dbg-name">{v.name}</span>
        <span className="pad-type">{v.type}</span>
        <span className={'mono dbg-val ' + (v.value && v.value.kind === 'string' ? 'v-str' : '')}>{valueText(v.value)}</span>
      </div>
      {open && children && children.map((c, i) => <VarRow key={c.name + i} v={c} depth={depth + 1} />)}
    </>
  );
}

/** The debugger: step through the program, see the call stack and every variable. */
export default function DebugPanel() {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const debug = useStore((s) => s.debug);
  const breakpoints = useStore((s) => s.breakpoints);
  const files = useStore((s) => s.files);
  const paused = debug && debug.paused;
  const armed = debug && debug.armed;
  const pausing = debug && debug.pausing;
  const run = useRunState();
  const noDebug = useStore((s) => !!s.bench.noDebug);
  const count = Object.values(breakpoints || {}).reduce((n, l) => n + l.length, 0);

  return (
    <div className="debug">
      <div className="tests-bar rt-debug-bar">
        {!paused && !armed && (run.canPause || pausing) ? (
          <button className="btn btn-sm" data-tour="debug:pause" disabled={pausing} onClick={() => A.debugCommand('pause')}><PauseGlyph />{pausing ? t('runtime.status.pausing') : t('debug.pause')}</button>
        ) : (
          <button className="btn btn-sm" data-tour="debug:resume" disabled={!paused && !armed} onClick={() => A.debugCommand('resume')} title="F8"><ResumeGlyph />{t('debug.continue')}</button>
        )}
        <button className="btn btn-sm" data-tour="debug:stepOver" disabled={!paused} onClick={() => A.debugCommand('stepOver')} title="F10"><Icon name="stepOver" />{t('debug.over')}</button>
        <button className="btn btn-sm" data-tour="debug:stepInto" disabled={!paused} onClick={() => A.debugCommand('stepInto')} title="F11"><Icon name="stepInto" />{t('debug.into')}</button>
        <button className="btn btn-sm" data-tour="debug:stepOut" disabled={!paused} onClick={() => A.debugCommand('stepOut')} title={formatKeys(lang, 'shift F11', '+')}><Icon name="stepOut" />{t('debug.out')}</button>
        <button className="btn btn-sm btn-quiet" data-tour="debug:stop" disabled={!run.canStop} onClick={() => A.stopProgram()} title={t('runtime.stopTitle')}><StopGlyph running={run.canStop} />{t('ws.stop')}</button>
        <span className="grow" />
        <span className="muted">{count === 1 ? t('debug.bp1') : t('debug.bps', { n: count })}</span>
      </div>
      {!paused ? (
        <div className="dock-body">
          <div className="dock-empty">
            {armed && (
              <div className="rt-armed" role="status">
                <ArmedGlyph />
                <span>{t('runtime.armedHint')}</span>
              </div>
            )}
            {noDebug && <div className="rt-armed rt-armed-off"><span>{t('runtime.noDebug')}</span></div>}
            {!armed && <div className="empty-line">{count ? t('debug.waiting') : t('debug.empty')}</div>}
            {count > 0 && (
              <div className="bp-list">
                {Object.entries(breakpoints).flatMap(([file, lines]) => lines.map((l) => (
                  <button key={file + l} className="link" onClick={() => A.openFile(file, l)}>{files[file] ? A.simpleName(files[file].className) : file}:{l}</button>
                )))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="debug-cols">
          <div className="debug-stack">
            <div className="pad-vars-head"><span>{t('debug.stack')}</span></div>
            {paused.frames.map((f, i) => (
              <button key={i} className={'dbg-frame' + (i === (paused.frame || 0) ? ' sel' : '')} onClick={() => A.debugFrame(i)}>
                <span title={`${f.className}.${f.method}`}>{frameLabel(f)}</span>
                <span className="muted">{t('problems.line', { line: f.line })}</span>
              </button>
            ))}
          </div>
          <div className="debug-vars">
            <div className="pad-vars-head"><span>{t('debug.vars')}</span></div>
            {(paused.variables || []).length === 0 && <p className="muted pad-16">{t('debug.noVars')}</p>}
            {(paused.variables || []).map((v, i) => <VarRow key={v.name + i} v={v} />)}
            {(paused.statics || []).length > 0 && <div className="pad-vars-head" style={{ paddingTop: 10 }}><span>static</span></div>}
            {(paused.statics || []).map((v, i) => <VarRow key={'s' + v.name + i} v={v} />)}
          </div>
        </div>
      )}
    </div>
  );
}
