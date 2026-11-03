import { useEffect } from 'react';
import { useStore, getState, setState } from './store.js';
import * as A from './actions.js';
import TitleBar from './components/TitleBar.jsx';
import StatusBar from './components/StatusBar.jsx';
import Rail from './components/Rail.jsx';
import Home from './components/Home.jsx';
import Workspace from './components/Workspace.jsx';
import Learn from './components/Learn.jsx';
import Settings from './components/Settings.jsx';
import Menu from './components/Menu.jsx';
import Dialogs from './components/Dialogs.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ShortcutsDialog from './components/ShortcutsDialog.jsx';
import { api } from './api.js';

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  const dropping = useStore((s) => s.dropping);

  useEffect(() => {
    A.init();
    // A project folder (or a .java / package.bluej inside it) given on the command line or dropped on the window.
    const off = api.onOpenPath ? api.onOpenPath((dir) => A.openRecent(dir)) : null;
    const over = (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
        e.preventDefault();
        if (!getState().dropping) setState({ dropping: true });
      }
    };
    const leave = (e) => {
      if (!e.relatedTarget) setState({ dropping: false });
    };
    const drop = (e) => {
      e.preventDefault();
      setState({ dropping: false });
      const file = e.dataTransfer && e.dataTransfer.files[0];
      const p = file && api.pathForFile ? api.pathForFile(file) : null;
      if (p) A.openPath(p);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      if (off) off();
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const s = getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (s.palette) A.closePalette();
        else if (s.menu) A.closeMenu();
        else if (s.dialog) A.closeDialog();
        else if (s.shortcuts) setState({ shortcuts: false });
        else if (s.aiPrompt) setState({ aiPrompt: null });
        return;
      }
      if (mod && key === 'p') {
        e.preventDefault();
        A.openPalette(e.shiftKey ? 'commands' : 'all');
        return;
      }
      if (e.key === 'F1' || (mod && e.key === '/')) {
        e.preventDefault();
        setState({ shortcuts: !s.shortcuts });
        return;
      }
      if (!s.project || s.dialog || s.palette) return;
      const paused = s.debug && s.debug.paused;
      if (mod && key === 'k') {
        e.preventDefault();
        A.compile();
      } else if (mod && key === 's') {
        e.preventDefault();
        A.saveAll();
      } else if (mod && key === 'n') {
        e.preventDefault();
        A.openDialogBox({ type: 'newClass' });
      } else if (mod && key === 'i') {
        e.preventDefault();
        setState({ aiPrompt: { at: Date.now() } });
      } else if (e.key === 'F5') {
        e.preventDefault();
        const mains = A.modelOf(s.files).list.filter((c) => c.hasMain);
        const pick = mains.find((c) => c.fileClass === s.selectedClass) || mains.find((c) => c.file === s.activeTab) || mains[0];
        if (pick) A.runMain(pick.fileClass);
      } else if (paused && e.key === 'F8') {
        e.preventDefault();
        A.debugCommand('resume');
      } else if (paused && e.key === 'F10') {
        e.preventDefault();
        A.debugCommand('stepOver');
      } else if (paused && e.key === 'F11') {
        e.preventDefault();
        A.debugCommand(e.shiftKey ? 'stepOut' : 'stepInto');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return <div className="app" />;
  const current = view === 'project' && !project ? 'home' : view;
  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Rail view={current} />
        <main className="main">
          <ErrorBoundary key={current}>
            {current === 'home' && <Home />}
            {current === 'project' && <Workspace />}
            {current === 'learn' && <Learn />}
            {current === 'settings' && <Settings />}
          </ErrorBoundary>
        </main>
      </div>
      <StatusBar />
      <Menu />
      <ErrorBoundary>
        <Dialogs />
      </ErrorBoundary>
      <CommandPalette />
      <ShortcutsDialog />
      {dropping && (
        <div className="drop-hint" aria-hidden="true">
          <div>{A.dropText()}</div>
        </div>
      )}
      {toast && (
        <div className={'toast' + (toast.kind === 'bad' ? ' bad' : '')} role="status" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
