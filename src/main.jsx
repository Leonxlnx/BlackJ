import '@fontsource-variable/inter/opsz.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';

async function boot() {
  if (!window.blackj) {
    const { createMock } = await import('./mock.js');
    window.blackj = createMock();
  }
  // A pop-out window (?panel=editor) shows one panel of the main window.
  const panel = new URLSearchParams(window.location.search).get('panel');
  const [{ createRoot }, { default: App }] = await Promise.all([import('react-dom/client'), panel ? import('./components/PanelApp.jsx') : import('./App.jsx')]);
  createRoot(document.getElementById('root')).render(<App />);
}

boot();
