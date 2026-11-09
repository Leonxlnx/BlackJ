import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { useT } from '../i18n.js';
import A from '../panels.js';
import { benchReasonText } from '../actions.js';
import { StopGlyph, RunningGlyph, PauseGlyph, ResumeGlyph, PromptGlyph, WindowGlyph, ThreadGlyph, ArmedGlyph, StartingGlyph, FaultGlyph } from './RuntimeGlyphs.jsx';
import '../styles/runtime.css';

/**
 * What the program does right now, from the bench and the debugger:
 * starting, running, waiting (for input), live (main returned, windows or threads go on),
 * paused, armed (pauses when its code runs next), stopping, failed (Java does not start), idle.
 */
export function runState(bench, debug) {
  const paused = debug && debug.paused;
  const armed = debug && debug.armed;
  const running = bench.state === 'running';
  const waiting = bench.state === 'waiting';
  // Windows or threads that objects on the bench opened (a Leinwand) are not a running program:
  // "main starten" stays, and the objects stay too.
  const live = bench.live && bench.liveFrom !== 'bench' ? bench.live : null;
  let kind = 'idle';
  if (bench.stopping) kind = 'stopping';
  else if (paused) kind = 'paused';
  else if (armed) kind = 'armed';
  else if (waiting) kind = 'waiting';
  else if (running) kind = 'running';
  else if (live) kind = 'live';
  else if (bench.starting && !bench.recycling) kind = 'starting';
  else if (bench.error && bench.state === 'off') kind = 'failed';
  const active = ['paused', 'armed', 'waiting', 'running', 'live', 'stopping'].includes(kind);
  return {
    kind,
    active,
    live,
    paused,
    canPause: !paused && !armed && !(debug && debug.pausing) && (running || waiting || !!live) && !bench.noDebug,
    canResume: !!paused || !!armed,
    canStop: active && kind !== 'stopping',
  };
}

/**
 * The run state for the interface. "Running" shows only after a moment, so a quick method call
 * does not make Stop and the strip flicker; waiting, a live window, paused show at once.
 */
export function useRunState() {
  const bench = useStore((s) => s.bench);
  const debug = useStore((s) => s.debug);
  const rs = runState(bench, debug);
  const isRunning = rs.kind === 'running';
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!isRunning) {
      setSettled(false);
      return undefined;
    }
    const id = setTimeout(() => setSettled(true), 200);
    return () => clearTimeout(id);
  }, [isRunning]);
  if (isRunning && !settled) return runState({ ...bench, state: 'ready' }, debug);
  return rs;
}

/**
 * A stack frame as a student reads it: "Spiel.tick", a constructor as "Spiel()", the code of a
 * lambda as "λ in Spiel()" (the JVM calls it lambda$new$0), an inner class without its $1.
 */
export function frameLabel(f) {
  if (!f) return '';
  const simple = String(f.className || '').split('.').pop();
  const outer = simple.split('$')[0];
  const m = String(f.method || '');
  const lambda = /^lambda\$(.+?)\$\d+$/.exec(m);
  if (lambda) return `λ in ${lambda[1] === 'new' ? outer + '()' : lambda[1] === 'static' ? outer : outer + '.' + lambda[1]}`;
  if (m === '<init>') return `${simple.replace(/\$\d+$/, '')}()`;
  if (m === '<clinit>') return `${outer} static { }`;
  return `${/\$\d+$/.test(simple) ? outer : simple.replace('$', '.')}.${m}`;
}

/** "1 window · 2 threads": what keeps a program alive after main() returned. */
export function liveParts(t, live) {
  if (!live) return [];
  const parts = [];
  const n = live.windows.length;
  if (n) parts.push({ key: 'w', glyph: <WindowGlyph />, text: n === 1 ? (live.windows[0].title ? `„${live.windows[0].title}“` : t('runtime.windows1')) : t('runtime.windowsN', { n }) });
  if (live.threads) parts.push({ key: 't', glyph: <ThreadGlyph />, text: live.threads === 1 ? t('runtime.threads1') : t('runtime.threadsN', { n: live.threads }) });
  return parts;
}

/** The program's state above the console: what it does, and Pause / Continue / Stop. */
export default function RunStrip() {
  const t = useT();
  const bench = useStore((s) => s.bench);
  const debug = useStore((s) => s.debug);
  const lang = useStore((s) => s.settings.lang);
  const rs = useRunState();
  if (rs.kind === 'idle') return null;
  const pausing = debug && debug.pausing;
  let glyph;
  let text;
  let sub = null;
  switch (rs.kind) {
    case 'starting':
      glyph = <StartingGlyph />;
      text = t('runtime.status.starting');
      break;
    case 'failed':
      glyph = <FaultGlyph />;
      text = t('runtime.status.failed');
      sub = benchReasonText(bench.error);
      break;
    case 'stopping':
      glyph = <StopGlyph running />;
      text = t('runtime.status.stopping');
      break;
    case 'paused': {
      const f = rs.paused.frames && rs.paused.frames[rs.paused.frame || 0];
      glyph = <PauseGlyph />;
      text = f && f.line ? t('runtime.status.paused', { line: f.line }) : t('runtime.status.pausedHere');
      if (f) sub = frameLabel(f);
      break;
    }
    case 'armed':
      glyph = <ArmedGlyph />;
      text = t('runtime.status.armed');
      break;
    case 'waiting':
      glyph = <PromptGlyph waiting />;
      text = t('runtime.status.waiting');
      break;
    default:
      glyph = <RunningGlyph />;
      text = pausing ? t('runtime.status.pausing') : t('runtime.status.running');
  }
  const parts = rs.kind === 'running' || rs.kind === 'live' || rs.kind === 'waiting' ? liveParts(t, rs.live) : [];
  return (
    <div className="rt-strip" data-state={rs.kind} role="status" aria-live="polite" lang={lang}>
      <span className="rt-strip-lead">{glyph}</span>
      <span className="rt-strip-text">{text}</span>
      {sub && <span className="rt-strip-sub mono">{sub}</span>}
      {parts.map((p) => (
        <span key={p.key} className="rt-chip">
          {p.glyph}
          <span>{p.text}</span>
        </span>
      ))}
      <span className="grow" />
      {rs.kind === 'failed' && (
        <button className="rt-key" onClick={() => A.stopProgram({ quiet: true })}>
          {t('runtime.retry')}
        </button>
      )}
      {rs.canPause && (
        <button className="rt-key" data-tour="console:pause" onClick={() => A.debugCommand('pause')} title={t('debug.pause')}>
          <PauseGlyph />
          <span className="rt-key-label">{t('debug.pause')}</span>
        </button>
      )}
      {rs.canResume && (
        <button className="rt-key" data-tour="console:resume" onClick={() => A.debugCommand('resume')} title={t('runtime.continue') + ' · F8'}>
          <ResumeGlyph />
          <span className="rt-key-label">{t('runtime.continue')}</span>
        </button>
      )}
      {rs.canStop && (
        <button className="rt-key rt-key-stop" data-tour="console:stop" onClick={() => A.stopProgram()} title={t('runtime.stopTitle')}>
          <StopGlyph />
          <span className="rt-key-label">{t('ws.stop')}</span>
        </button>
      )}
    </div>
  );
}
