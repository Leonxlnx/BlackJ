// Monaco with all editor features but only the Java language, bundled for offline use.
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import 'monaco-editor/languages/definitions/java/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker&inline';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

/** Editor themes in the app's own colours, so the editor matches the rest of the window. */
export function defineThemes() {
  const base = {
    dark: {
      base: 'vs-dark',
      rules: [
        { token: 'keyword', foreground: 'e8913a' },
        { token: 'type', foreground: '9cc3e8' },
        { token: 'type.identifier', foreground: 'f2f2f3' },
        { token: 'string', foreground: '9fd0a8' },
        { token: 'number', foreground: 'd9b26f' },
        { token: 'comment', foreground: '8a8c92', fontStyle: 'italic' },
        { token: 'annotation', foreground: 'bdbdc0' },
        { token: 'delimiter', foreground: 'bdbdc0' },
      ],
    },
    light: {
      base: 'vs',
      rules: [
        { token: 'keyword', foreground: 'b0540a' },
        { token: 'type', foreground: '1f5f99' },
        { token: 'type.identifier', foreground: '111111' },
        { token: 'string', foreground: '247b50' },
        { token: 'number', foreground: '8a5a00' },
        { token: 'comment', foreground: '5f6368', fontStyle: 'italic' },
        { token: 'annotation', foreground: '5f6368' },
      ],
    },
  };
  for (const [name, def] of Object.entries(base)) {
    const isDark = name === 'dark';
    const ground = isDark ? '#131217' : '#ffffff';
    monaco.editor.defineTheme('blackj-' + name, {
      base: def.base,
      inherit: true,
      rules: def.rules,
      colors: {
        'editor.background': ground,
        'editor.foreground': isDark ? '#f2f2f3' : '#111111',
        'editorLineNumber.foreground': isDark ? '#5c5e64' : '#9a9ca1',
        'editorLineNumber.activeForeground': isDark ? '#bdbdc0' : '#111111',
        'editor.lineHighlightBackground': isDark ? '#1b1a1f' : '#f6f7f8',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': isDark ? '#3a3a3e' : '#d7dce2',
        'editorCursor.foreground': isDark ? '#e8913a' : '#b0540a',
        'editorIndentGuide.background1': isDark ? '#222224' : '#eeeeee',
        'editorWidget.background': isDark ? '#212023' : '#ffffff',
        'editorWidget.border': isDark ? '#3a3a3e' : '#d1d5db',
        'editorHoverWidget.background': isDark ? '#212023' : '#ffffff',
        'editorHoverWidget.border': isDark ? '#3a3a3e' : '#d1d5db',
        'editorSuggestWidget.background': isDark ? '#212023' : '#ffffff',
        'editorSuggestWidget.border': isDark ? '#3a3a3e' : '#d1d5db',
        'editorSuggestWidget.selectedBackground': isDark ? '#2c2b30' : '#eeeeee',
        'editorError.foreground': isDark ? '#e5566f' : '#c4242a',
        'editorWarning.foreground': isDark ? '#d9a441' : '#92400e',
        'scrollbarSlider.background': isDark ? '#ffffff14' : '#0000001a',
        'scrollbarSlider.hoverBackground': isDark ? '#ffffff24' : '#0000002a',
        'editorGutter.background': ground,
        focusBorder: '#00000000',
      },
    });
  }
}

export default monaco;
