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
        { token: 'keyword', foreground: '8db4ff' },
        { token: 'type', foreground: 'e8e8ea' },
        { token: 'type.identifier', foreground: 'e8e8ea' },
        { token: 'string', foreground: '9bd4a9' },
        { token: 'number', foreground: 'e5c07b' },
        { token: 'comment', foreground: '6e6e76' },
        { token: 'annotation', foreground: 'a1a1a6' },
        { token: 'delimiter', foreground: 'a1a1a6' },
      ],
    },
    light: {
      base: 'vs',
      rules: [
        { token: 'keyword', foreground: '1f5fd1' },
        { token: 'type', foreground: '0a0a0b' },
        { token: 'type.identifier', foreground: '0a0a0b' },
        { token: 'string', foreground: '18794e' },
        { token: 'number', foreground: '94620a' },
        { token: 'comment', foreground: '8e8e96' },
        { token: 'annotation', foreground: '52525b' },
        { token: 'delimiter', foreground: '52525b' },
      ],
    },
  };
  for (const [name, def] of Object.entries(base)) {
    const isDark = name === 'dark';
    // Same as --surface, so the editor sits flush in its panel.
    const ground = isDark ? '#161617' : '#ffffff';
    monaco.editor.defineTheme('blackj-' + name, {
      base: def.base,
      inherit: true,
      rules: def.rules,
      colors: {
        'editor.background': ground,
        'editor.foreground': isDark ? '#e8e8ea' : '#0a0a0b',
        'editorLineNumber.foreground': isDark ? '#4a4a50' : '#b4b4ba',
        'editorLineNumber.activeForeground': isDark ? '#adadb3' : '#0a0a0b',
        'editor.lineHighlightBackground': isDark ? '#1b1b1d' : '#f7f7f8',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': isDark ? '#2b3b5c' : '#d6e4fb',
        'editor.inactiveSelectionBackground': isDark ? '#23283a' : '#e6eefc',
        'editorCursor.foreground': isDark ? '#4c8dff' : '#1f6feb',
        'editorIndentGuide.background1': isDark ? '#1f1f21' : '#efeff1',
        'editorIndentGuide.activeBackground1': isDark ? '#303033' : '#d9d9dd',
        'editorWidget.background': isDark ? '#1e1e20' : '#ffffff',
        'editorWidget.border': isDark ? '#303033' : '#d9d9dd',
        'editorHoverWidget.background': isDark ? '#1e1e20' : '#ffffff',
        'editorHoverWidget.border': isDark ? '#303033' : '#d9d9dd',
        'editorSuggestWidget.background': isDark ? '#1e1e20' : '#ffffff',
        'editorSuggestWidget.border': isDark ? '#303033' : '#d9d9dd',
        'editorSuggestWidget.selectedBackground': isDark ? '#262628' : '#f2f2f3',
        'editorError.foreground': isDark ? '#f0616d' : '#d1242f',
        'editorWarning.foreground': isDark ? '#e0a43a' : '#9a6700',
        'scrollbarSlider.background': isDark ? '#ffffff14' : '#0000001a',
        'scrollbarSlider.hoverBackground': isDark ? '#ffffff24' : '#0000002a',
        'editorGutter.background': ground,
        // Brackets stay neutral: nesting is shown by the scope tones, not by colour.
        'editorBracketHighlight.foreground1': isDark ? '#a1a1a6' : '#52525b',
        'editorBracketHighlight.foreground2': isDark ? '#a1a1a6' : '#52525b',
        'editorBracketHighlight.foreground3': isDark ? '#a1a1a6' : '#52525b',
        'editorBracketHighlight.foreground4': isDark ? '#a1a1a6' : '#52525b',
        'editorBracketHighlight.foreground5': isDark ? '#a1a1a6' : '#52525b',
        'editorBracketHighlight.foreground6': isDark ? '#a1a1a6' : '#52525b',
        'editorBracketHighlight.unexpectedBracket.foreground': isDark ? '#f0616d' : '#d1242f',
        'editorBracketMatch.background': isDark ? '#ffffff10' : '#0000000d',
        'editorBracketMatch.border': '#00000000',
        focusBorder: '#00000000',
        // Diff: the app's positive/negative hues, faint; no border or hatching between the panes.
        'diffEditor.insertedLineBackground': isDark ? '#3fb27f1f' : '#18794e14',
        'diffEditor.insertedTextBackground': isDark ? '#3fb27f33' : '#18794e26',
        'diffEditor.removedLineBackground': isDark ? '#f0616d1f' : '#d1242f12',
        'diffEditor.removedTextBackground': isDark ? '#f0616d33' : '#d1242f22',
        'diffEditor.border': '#00000000',
        'diffEditor.diagonalFill': '#00000000',
        // Suggestion icons stay neutral (one accent rule); the matched letters use the accent.
        ...Object.fromEntries(['method', 'function', 'field', 'variable', 'class', 'constructor', 'keyword', 'interface', 'enum', 'enumMember', 'property', 'module', 'snippet', 'text', 'constant'].map((k) => ['symbolIcon.' + k + 'Foreground', isDark ? '#808087' : '#66666e'])),
        'editorSuggestWidget.highlightForeground': isDark ? '#4c8dff' : '#1f6feb',
        'editorSuggestWidget.focusHighlightForeground': isDark ? '#4c8dff' : '#1f6feb',
        'editorSuggestWidget.foreground': isDark ? '#f4f4f5' : '#0a0a0b',
        'editorSuggestWidget.selectedForeground': isDark ? '#f4f4f5' : '#0a0a0b',
      },
    });
  }
}

export default monaco;
