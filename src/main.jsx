import '@fontsource-variable/inter/opsz.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';

async function boot() {
  if (!window.blackj) {
    const { createMock } = await import('./mock.js');
    window.blackj = createMock();
  }
  const [{ createRoot }, { default: App }] = await Promise.all([import('react-dom/client'), import('./App.jsx')]);
  createRoot(document.getElementById('root')).render(<App />);
}

boot();
