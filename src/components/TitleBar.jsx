import { useMemo } from 'react';
import { useStore } from '../store.js';
import { useT, formatKeys } from '../i18n.js';
import * as A from '../actions.js';
import Icon from './Icon.jsx';

/** The window's own title bar: where you are, search, and the actions you use most. */
export default function TitleBar() {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const view = useStore((s) => s.view);
  const project = useStore((s) => s.project);
  const pkg = useStore((s) => s.pkg);
  const files = useStore((s) => s.files);
  const compileState = useStore((s) => s.compile.state);
  const benchState = useStore((s) => s.bench.state);
  const selected = useStore((s) => s.selectedClass);
  const activeTab = useStore((s) => s.activeTab);
  const paused = useStore((s) => s.debug && s.debug.paused);
  const tutorOpen = useStore((s) => s.tutorOpen);
  const model = useMemo(() => (project ? A.modelOf(files) : null), [files, project]);
  const mains = model ? model.list.filter((c) => c.hasMain) : [];
  const running = benchState === 'running' || benchState === 'waiting';
  const inProject = view === 'project' && project;
  const mainTarget = mains.find((c) => c.fileClass === selected) || mains.find((c) => c.file === activeTab) || mains[0];
  const viewTitle = { learn: t('nav.learn'), settings: t('nav.settings') }[view];

  return (
    <header className="titlebar">
      <div className="tb-left">
        {inProject ? (
          <nav className="crumbs-bar" aria-label="Pfad">
            <h1 className="tb-title">
              <button className="crumb" onClick={() => A.enterPackage('')}>{project.name}</button>
            </h1>
            {pkg && pkg.split('.').map((part, i, all) => (
              <span key={i} className="crumb-wrap">
                <span className="crumb-sep" aria-hidden="true">/</span>
                <button className="crumb" onClick={() => A.enterPackage(all.slice(0, i + 1).join('.'))}>{part}</button>
              </span>
            ))}
          </nav>
        ) : (
          <span className="tb-title">{viewTitle || 'BlackJ'}</span>
        )}
      </div>

      <button className="tb-search" onClick={() => A.openPalette()} aria-label={t('palette.placeholder')}>
        <Icon name="search" />
        <span>{inProject ? t('palette.placeholder') : t('palette.placeholderHome')}</span>
        <kbd>{formatKeys(lang, 'ctrl P')}</kbd>
      </button>

      <div className="tb-right">
        {inProject && (
          <>
            {running || paused ? (
              <button className="btn btn-sm" onClick={A.stopProgram} title={t('ws.stop')}>
                <Icon name="stop" />
                <span className="tb-label">{t('ws.stop')}</span>
              </button>
            ) : (
              mains.length > 0 && (
                <button
                  className="btn btn-sm"
                  title={mainTarget ? `${mainTarget.simple}.main(String[] args) · F5` : ''}
                  onClick={(e) => {
                    if (mains.length === 1) A.runMain(mains[0].fileClass);
                    else {
                      const r = e.currentTarget.getBoundingClientRect();
                      A.openMenu({ x: r.left, y: r.bottom + 6, items: mains.map((c) => ({ label: <span className="sig">{c.simple}.main()</span>, onClick: () => A.runMain(c.fileClass) })) });
                    }
                  }}
                >
                  <Icon name="play" />
                  <span className="tb-label">{t('ws.runMain')}</span>
                  {mains.length > 1 && <Icon name="chevron" />}
                </button>
              )
            )}
            <button className="btn btn-sm btn-primary" onClick={A.compile} disabled={compileState === 'compiling'} title={t('ws.compile') + ' · ' + formatKeys(lang, 'ctrl K', '+')}>
              <Icon name="build" />
              <span className="tb-label">{compileState === 'compiling' ? t('ws.compiling') : t('ws.compile')}</span>
            </button>
            <button className={'icon-btn tb-toggle' + (tutorOpen ? ' on' : '')} aria-pressed={tutorOpen} aria-label={t('ws.sidePanel')} title={t('ws.sidePanel') + ' · ' + formatKeys(lang, 'ctrl shift L', '+')} onClick={A.toggleTutor}>
              <Icon name="sidebar" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
