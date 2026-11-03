import { useMemo } from 'react';
import { useStore, setState } from '../store.js';
import { useT, formatKeys } from '../i18n.js';
import * as A from '../actions.js';
import { POPPABLE } from '../lib/layout.js';
import Icon from './Icon.jsx';

/** The view menu: panels into windows of their own and back, and the layout as it came. */
export function viewMenu(t, detached) {
  const items = POPPABLE.map((p) => (detached.includes(p)
    ? { label: t('layout.dockBack', { panel: A.panelTitle(p) }), icon: 'sidebar', onClick: () => A.dockBack(p) }
    : { label: t('layout.popOut', { panel: A.panelTitle(p) }), icon: 'external', disabled: !window.blackj.panel, onClick: () => A.popOut(p) }));
  return [...items, { type: 'sep' }, { label: t('layout.reset'), icon: 'layout', onClick: A.resetLayout }];
}

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
  const detached = useStore((s) => s.layout.detached);
  const jdk = useStore((s) => s.info.jdk);
  const errors = useStore((s) => (s.compile.state === 'errors' ? s.compile.problems.filter((p) => p.severity === 'error').length : 0));
  const model = useMemo(() => (project ? A.modelOf(files) : null), [files, project]);
  const mains = model ? model.list.filter((c) => c.hasMain) : [];
  const running = benchState === 'running' || benchState === 'waiting';
  const inProject = view === 'project' && project;
  const mainTarget = mains.find((c) => c.fileClass === selected) || mains.find((c) => c.file === activeTab) || mains[0];
  const viewTitle = { learn: t('nav.learn'), settings: t('nav.settings') }[view];
  // What needs attention, where the status bar used to say it: no Java, a breakpoint, input, errors.
  let attention = null;
  if (inProject) {
    if (!jdk) attention = { dot: 'bad', text: t('tb.noJava'), go: () => { A.go('settings'); setState({ settingsFocus: 'java' }); } };
    else if (paused) attention = { dot: 'warn', text: t('status.paused', { line: paused.frames && paused.frames[0] ? paused.frames[0].line : '?' }), go: () => setState({ dock: 'debug', dockCollapsed: false }) };
    else if (benchState === 'waiting') attention = { dot: 'warn', text: t('ws.status.waiting'), go: () => { setState({ dock: 'console', dockCollapsed: false }); setTimeout(() => { const el = document.getElementById('console-in'); if (el) el.focus(); }, 0); } };
    else if (errors) attention = { dot: 'bad', text: errors === 1 ? t('ws.status.error1') : t('ws.status.errors', { n: errors }), go: () => setState({ dock: 'problems', dockCollapsed: false }) };
  }

  return (
    <header className="titlebar">
      <div className="tb-left">
        {inProject ? (
          <nav className="crumbs-bar" aria-label={t('a11y.path')}>
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

      <button className="tb-search" data-tour="search" onClick={() => A.openPalette()} aria-label={t('palette.placeholder')}>
        <Icon name="search" />
        <span>{inProject ? t('palette.placeholder') : t('palette.placeholderHome')}</span>
        <kbd>{formatKeys(lang, 'ctrl P')}</kbd>
      </button>

      <div className="tb-right">
        {inProject && (
          <>
            {attention && (
              <button className="btn btn-sm btn-quiet tb-state" data-tour="state" onClick={attention.go}>
                <span className={'state-dot ' + attention.dot} />
                {attention.text}
              </button>
            )}
            {running || paused ? (
              <button className="btn btn-sm" data-tour="stop" onClick={A.stopProgram} title={t('ws.stop')}>
                <Icon name="stop" />
                <span className="tb-label">{t('ws.stop')}</span>
              </button>
            ) : (
              mains.length > 0 && (
                <button
                  className="btn btn-sm"
                  data-tour="run-main"
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
            <button className="btn btn-sm btn-primary" data-tour="compile" onClick={A.compile} disabled={compileState === 'compiling'} title={t('ws.compile') + ' · ' + formatKeys(lang, 'ctrl K', '+')}>
              <Icon name="build" />
              <span className="tb-label">{compileState === 'compiling' ? t('ws.compiling') : t('ws.compile')}</span>
            </button>
            <button
              className="icon-btn tb-view"
              aria-label={t('layout.view')}
              title={t('layout.view')}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                A.openMenu({ x: r.right - 260, y: r.bottom + 6, items: viewMenu(t, detached) });
              }}
            >
              <Icon name="layout" />
            </button>
            <button data-tour="side-panel" className={'icon-btn tb-toggle' + (tutorOpen ? ' on' : '')} aria-pressed={tutorOpen} aria-label={t('ws.sidePanel')} title={t('ws.sidePanel') + ' · ' + formatKeys(lang, 'ctrl shift L', '+')} onClick={A.toggleTutor}>
              <Icon name="sidebar" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
