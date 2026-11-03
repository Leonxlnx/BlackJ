import { useEffect } from 'react';
import { useStore, getState, setState } from '../store.js';
import { useT } from '../i18n.js';
import A, { PANEL, WIN, startMirror } from '../panels.js';
import { api } from '../api.js';
import monaco from '../lib/monaco.js';
import EditorPanel from './EditorPanel.jsx';
import Dock from './Dock.jsx';
import { SidePanel } from './Workspace.jsx';
import Menu from './Menu.jsx';
import Dialogs from './Dialogs.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import Icon from './Icon.jsx';

const PANELS = { editor: EditorPanel, dock: Dock, side: SidePanel };

/** A pop-out window: one panel of the main window with a title bar of its own. Its state comes
    from the main window (panels.js); closing the window puts the panel back there. */
export default function PanelApp() {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const theme = useStore((s) => s.settings.theme);
  const lang = useStore((s) => s.settings.lang);
  const project = useStore((s) => s.project);
  const smoke = useStore((s) => !!(s.info && s.info.smoke));
  const toast = useStore((s) => (s.activeWin === WIN ? s.toast : null));

  useEffect(() => {
    startMirror();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
    if (ready && api.windowTheme) api.windowTheme(theme);
  }, [theme, lang, ready]);
  useEffect(() => {
    document.title = project ? `${A.panelTitle(PANEL)} – ${project.name}` : 'BlackJ';
  }, [project, lang]);
  useEffect(() => {
    if (!smoke) return;
    // The smoke test (in the main window) types into this editor through the main process.
    document.documentElement.dataset.smoke = '1';
    window.blackjSmoke = { editor: () => monaco.editor.getEditors().find((e) => e.getModel()) || null };
  }, [smoke]);

  useEffect(() => {
    const onKey = (e) => {
      const s = getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (s.menu) A.closeMenu();
        else if (s.dialog) A.closeDialog();
        else if (s.aiPrompt) setState({ aiPrompt: null });
        else if (s.aiBusy) A.stopEdit();
        return;
      }
      if (!s.project || s.dialog) return;
      if (mod && key === 'p') {
        e.preventDefault();
        A.openPalette(e.shiftKey ? 'commands' : 'all');
      } else if (mod && key === 'k') {
        e.preventDefault();
        A.compile();
      } else if (mod && key === 's') {
        e.preventDefault();
        A.saveAll();
      } else if (mod && key === 'n') {
        e.preventDefault();
        A.openDialogBox({ type: 'newClass' });
      } else if (s.debug && s.debug.paused && ['F8', 'F10', 'F11'].includes(e.key)) {
        e.preventDefault();
        A.debugCommand(e.key === 'F8' ? 'resume' : e.key === 'F10' ? 'stepOver' : e.shiftKey ? 'stepOut' : 'stepInto');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return <div className="app popout" />;
  const Panel = PANELS[PANEL];
  return (
    <div className="app popout">
      <header className="titlebar">
        <div className="tb-left">
          <span className="tb-title">{A.panelTitle(PANEL)}</span>
          {project && <span className="popout-project">{project.name}</span>}
        </div>
        <div className="tb-right">
          <button className="btn btn-sm btn-quiet" onClick={() => A.dockBack(PANEL)} title={t('panel.dockBackHint')}>
            <Icon name="sidebar" />
            <span className="tb-label">{t('panel.dockBack')}</span>
          </button>
        </div>
      </header>
      <main className="app-main">
        <div className="ws">
          <ErrorBoundary>
            {project && Panel ? <Panel /> : <div className="empty-line">{t('panel.noProject')}</div>}
          </ErrorBoundary>
        </div>
      </main>
      <Menu />
      <ErrorBoundary>
        <Dialogs />
      </ErrorBoundary>
      {toast && (
        <div className={'toast' + (toast.kind === 'bad' ? ' bad' : '')} role="status" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
