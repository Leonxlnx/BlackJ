import { useMemo } from 'react';
import { useStore } from '../store.js';
import { useT, formatNumber } from '../i18n.js';
import A from '../panels.js';
import Icon from './Icon.jsx';

const STATUS = { passed: 'ok', failed: 'bad', error: 'bad', skipped: 'off' };

/** JUnit results like BlueJ's test window: a bar, then each test with what went wrong. */
export default function TestsPanel() {
  const t = useT();
  const tests = useStore((s) => s.tests);
  const files = useStore((s) => s.files);
  const lang = useStore((s) => s.settings.lang);
  const testClasses = useMemo(() => A.modelOf(files).list.filter((c) => c.isTest), [files]);
  const groups = useMemo(() => {
    const g = new Map();
    for (const r of tests.results || []) {
      if (!g.has(r.className)) g.set(r.className, []);
      g.get(r.className).push(r);
    }
    return [...g.entries()];
  }, [tests.results]);
  const s = tests.summary;

  if (!testClasses.length) {
    return (
      <div className="dock-body">
        <div className="dock-empty">
          <div className="empty-line">{t('tests.noTests')}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="tests">
      <div className="tests-bar">
        <button className="btn btn-sm" data-tour="tests-run" onClick={() => A.runTests({ all: true })} disabled={tests.running}>
          <Icon name="play" />
          {tests.running ? t('tests.running') : t('tests.runAll')}
        </button>
        {s && (
          <>
            <div className="tests-meter" role="img" aria-label={t('tests.summary', { passed: s.passed, failed: s.failed, total: s.total })}>
              <span className="ok" style={{ width: `${(s.passed / Math.max(1, s.total)) * 100}%` }} />
              <span className="bad" style={{ width: `${(s.failed / Math.max(1, s.total)) * 100}%` }} />
            </div>
            <span className={s.failed ? 'bad' : 'dim'}>{t('tests.summary', { passed: s.passed, failed: s.failed, total: s.total })}</span>
            <span className="muted">{formatNumber(lang, s.ms)} ms</span>
          </>
        )}
        {!s && !tests.running && <span className="muted">{t('tests.hint', { n: testClasses.length })}</span>}
      </div>
      <div className="dock-body">
        {groups.map(([cls, list]) => (
          <div key={cls} className="test-group">
            <div className="test-class">
              <span>{A.simpleName(cls)}</span>
              <button className="link" onClick={() => A.runTests({ className: cls })}>{t('tests.runClass')}</button>
            </div>
            {list.map((r) => (
              <div key={r.name} className={'test-row ' + STATUS[r.status]}>
                <span className={'state-dot ' + STATUS[r.status]} />
                <button className="test-name" onClick={() => r.file && A.openFile(r.file.replace(/\\/g, '/'), r.line)} title={r.file ? `${r.file}:${r.line}` : ''}>
                  {!r.displayName || r.displayName === r.name || r.displayName === r.name + '()' ? r.name : r.displayName.startsWith('[') ? `${r.name} ${r.displayName}` : r.displayName}
                </button>
                <span className="muted test-time">{r.ms != null ? `${formatNumber(lang, r.ms)} ms` : ''}</span>
                <button className="link" onClick={() => A.runTests({ className: cls, method: r.name })}>{t('tests.runOne')}</button>
                {(r.status === 'failed' || r.status === 'error') && (
                  <div className="test-fail">
                    {r.expected != null && r.actual != null ? (
                      <div className="test-diff">
                        <span><span className="muted">{t('tests.expected')}</span> <code>{r.expected}</code></span>
                        <span><span className="muted">{t('tests.actual')}</span> <code>{r.actual}</code></span>
                      </div>
                    ) : (
                      <div className="mono">{r.message}</div>
                    )}
                    {r.line ? <button className="problem-where" onClick={() => A.openFile(r.file.replace(/\\/g, '/'), r.line)}>{t('problems.line', { line: r.line })}</button> : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        {!groups.length && !tests.running && (
          <div className="dock-empty">
            <div className="test-classes">
              {testClasses.map((c) => (
                <button key={c.fileClass} className="btn btn-sm btn-quiet" onClick={() => A.runTests({ className: c.fileClass })}>
                  <Icon name="play" />
                  {c.simple}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
