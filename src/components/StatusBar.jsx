import { useStore, setState } from '../store.js';
import { useT } from '../i18n.js';
import * as A from '../actions.js';

/** One quiet line at the bottom: what state the project is in, and where the cursor is. */
export default function StatusBar() {
  const t = useT();
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const compile = useStore((s) => s.compile);
  const files = useStore((s) => s.files);
  const bench = useStore((s) => s.bench);
  const cursor = useStore((s) => s.cursor);
  const info = useStore((s) => s.info);
  const settings = useStore((s) => s.settings);
  const recording = useStore((s) => s.recording);
  const paused = useStore((s) => s.debug && s.debug.paused);
  const tests = useStore((s) => s.tests);
  const inProject = project && view === 'project';

  let state = null;
  if (inProject) {
    const stale = Object.keys(files).some((n) => compile.snapshot[n] !== files[n].content) || Object.keys(compile.snapshot).length !== Object.keys(files).length;
    if (paused) state = { cls: 'warn', text: t('status.paused', { line: paused.frames && paused.frames[0] ? paused.frames[0].line : '?' }) };
    else if (bench.state === 'waiting') state = { cls: 'warn', text: t('ws.status.waiting') };
    else if (bench.state === 'running') state = { cls: 'run', text: t('ws.status.running') };
    else if (compile.state === 'compiling') state = { cls: '', text: t('ws.compiling') };
    else if (compile.state === 'errors') {
      const n = compile.problems.filter((p) => p.severity === 'error').length;
      state = { cls: 'bad', text: n === 1 ? t('ws.status.error1') : t('ws.status.errors', { n }) };
    } else if (compile.state !== 'ok') state = { cls: 'off', text: t('ws.status.never') };
    else if (stale) state = { cls: 'off', text: t('ws.status.changed') };
    else state = { cls: 'ok', text: t('ws.status.ok', { n: Object.keys(files).length }) };
  }

  return (
    <footer className="statusbar">
      <div className="sb-group">
        {state && (
          <button className={'sb-item sb-state ' + state.cls} onClick={() => compile.state === 'errors' && setState({ dock: 'problems' })}>
            <span className="sb-dot" />
            {state.text}
          </button>
        )}
        {inProject && bench.state !== 'off' && <span className="sb-item">{bench.objects.length === 1 ? t('status.object1') : t('status.objects', { n: bench.objects.length })}</span>}
        {inProject && tests.summary && (
          <span className={'sb-item' + (tests.summary.failed ? ' bad' : '')}>{t('tests.summaryShort', { passed: tests.summary.passed, total: tests.summary.total })}</span>
        )}
        {recording && (
          <span className="sb-item rec">
            <span className="rec-dot" />
            {t('record.banner', { method: recording.method })}
          </span>
        )}
      </div>
      <div className="sb-group">
        {inProject && cursor && <span className="sb-item">{t('status.ln', { line: cursor.line, col: cursor.col })}</span>}
        {inProject && settings.aiOff && <span className="sb-item off">{t('status.aiOff')}</span>}
        {inProject && !settings.aiOff && (
          <button
            className={'sb-item' + (settings.aiInline && info.tutor.hasKey ? '' : ' off')}
            onClick={() => A.updateSettings({ aiInline: !settings.aiInline })}
            title={t('settings.aiInlineText')}
          >
            {t('status.aiInline')} {settings.aiInline ? t('settings.on') : t('settings.off')}
          </button>
        )}
        <span className="sb-item sb-hide-narrow">{info.jdk ? `Java ${info.jdk.version}` : t('home.javaMissing')}</span>
      </div>
    </footer>
  );
}
