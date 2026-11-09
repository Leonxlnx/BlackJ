// Why the caret sometimes stood beside the text: Monaco measures how wide a character of the
// editor font is once, when an editor first needs that font, and caches where each character of a
// rendered line sits. If JetBrains Mono is still loading at that moment, the browser measures the
// fallback font instead (Consolas is 0.55 em wide, JetBrains Mono 0.6 em), while the text later
// paints in JetBrains Mono. The caret then drifts from the text, further with every column, or only
// on the lines rendered before the font arrived. The font is split into subsets by character
// range (Latin, Latin Extended, …), so a line with an unusual character can load a subset late
// and shift again. The fix: load the exact faces before the editor appears, and have Monaco
// measure again whenever any font finishes loading.

export const EDITOR_FONT = "'JetBrains Mono', Consolas, 'Courier New', monospace";
const FACES = ['400 14px "JetBrains Mono"', '500 14px "JetBrains Mono"', 'italic 400 14px "JetBrains Mono"'];
const SAMPLE = 'Aa0 {}[]();:"\'äöüßÄÖÜ€…ĞőŁ';

/** What the smoke test reads: when fonts arrived and what Monaco measured before and after. */
export const fontLog = [];

let loading = null;
/** Starts loading the editor's faces (called at boot, long before Monaco measures anything). */
export function loadEditorFonts() {
  if (loading) return loading;
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (!fonts || !fonts.load) return (loading = Promise.resolve());
  loading = Promise.all(FACES.map((f) => fonts.load(f, SAMPLE).catch(() => []))).then(() => undefined);
  return loading;
}

export function editorFontLoaded() {
  try {
    return document.fonts.check('14px "JetBrains Mono"', 'Aa0');
  } catch {
    return true;
  }
}

let watching = false;
/** Monaco measures again after the editor font (or any later subset of it) has loaded. */
export function remeasureOnFontLoad(monaco, after) {
  if (watching) return;
  watching = true;
  const fonts = document.fonts;
  if (!fonts) return;
  let timer = null;
  const again = (why) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      monaco.editor.remeasureFonts();
      fontLog.push({ at: Math.round(performance.now()), why, loaded: editorFontLoaded() });
      if (after) after();
    }, 20);
  };
  loadEditorFonts().then(() => again('faces'));
  fonts.ready.then(() => again('ready'));
  fonts.addEventListener('loadingdone', () => again('loadingdone'));
}
