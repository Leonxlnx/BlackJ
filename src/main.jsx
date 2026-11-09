import '@fontsource-variable/inter/opsz.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import './styles.css';
import { loadEditorFonts } from './lib/editor-fonts.js';

async function boot() {
  // The editor font loads first: Monaco measures it once, and a fallback measured instead puts
  // the caret beside the text (see lib/editor-fonts.js).
  const fonts = loadEditorFonts();
  // Monaco's own words (find, rename, peek, quick fix) in German unless BlackJ was last used in English.
  let lang = 'de';
  try {
    lang = localStorage.getItem('blackj.lang') || 'de';
  } catch {
    /* storage blocked */
  }
  if (lang !== 'en') await import('monaco-editor/nls/lang/de.js').catch(() => null);
  await Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]);
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
