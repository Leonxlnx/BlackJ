// Monaco with all editor features but only the Java language, bundled for offline use.
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker&inline';
import { javaLanguage } from './editor-java.js';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

// Java with BlackJ's own grammar and editing rules (lib/editor-java.js), set once and up front so
// no lazily loaded default can replace them later.
if (!monaco.languages.getLanguages().some((l) => l.id === 'java')) monaco.languages.register({ id: 'java', extensions: ['.java', '.jav'], aliases: ['Java', 'java'] });
const java = javaLanguage(monaco);
monaco.languages.setLanguageConfiguration('java', java.conf);
monaco.languages.setMonarchTokensProvider('java', java.language);

// Token colours: calm and few. Blue for the language's own words, lavender for types, sage for
// text, teal for numbers and constants, near-white for methods, grey for comments.
const RULES = {
  dark: [
    { token: '', foreground: 'd6d6db' },
    { token: 'identifier', foreground: 'cfcfd5' },
    { token: 'keyword', foreground: '8fb4ff' },
    { token: 'keyword.type', foreground: '8fb4ff' },
    { token: 'keyword.self', foreground: '8fb4ff', fontStyle: 'italic' },
    { token: 'constant.language', foreground: '7cc8d6' },
    { token: 'constant', foreground: '7cc8d6' },
    { token: 'type', foreground: 'c3b8f2' },
    { token: 'function', foreground: 'ededf1' },
    { token: 'string', foreground: '9ccfa9' },
    { token: 'string.char', foreground: '9ccfa9' },
    { token: 'string.escape', foreground: '7cc8d6' },
    { token: 'string.invalid', foreground: 'f0616d' },
    { token: 'number', foreground: '7cc8d6' },
    { token: 'comment', foreground: '6c6c74', fontStyle: 'italic' },
    { token: 'comment.todo', foreground: 'a5a5ad', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '74747c', fontStyle: 'italic' },
    { token: 'comment.doc.tag', foreground: '9a9aa3', fontStyle: '' },
    { token: 'comment.doc.name', foreground: 'b3b3ba', fontStyle: 'italic' },
    { token: 'comment.doc.code', foreground: '8f8f98', fontStyle: '' },
    { token: 'comment.doc.html', foreground: '5e5e66', fontStyle: '' },
    { token: 'annotation', foreground: 'a99be0' },
    { token: 'operator', foreground: 'a3a3ab' },
    { token: 'delimiter', foreground: '8a8a92' },
    { token: 'delimiter.angle', foreground: '8a8a92' },
  ],
  light: [
    { token: '', foreground: '1f1f23' },
    { token: 'identifier', foreground: '2c2c31' },
    { token: 'keyword', foreground: '2251c9' },
    { token: 'keyword.type', foreground: '2251c9' },
    { token: 'keyword.self', foreground: '2251c9', fontStyle: 'italic' },
    { token: 'constant.language', foreground: '0b7285' },
    { token: 'constant', foreground: '0b7285' },
    { token: 'type', foreground: '6d3fc0' },
    { token: 'function', foreground: '0a0a0b' },
    { token: 'string', foreground: '18794e' },
    { token: 'string.char', foreground: '18794e' },
    { token: 'string.escape', foreground: '0b7285' },
    { token: 'string.invalid', foreground: 'd1242f' },
    { token: 'number', foreground: '0b7285' },
    { token: 'comment', foreground: '8d8d95', fontStyle: 'italic' },
    { token: 'comment.todo', foreground: '5c5c64', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '85858d', fontStyle: 'italic' },
    { token: 'comment.doc.tag', foreground: '66666e', fontStyle: '' },
    { token: 'comment.doc.name', foreground: '4d4d55', fontStyle: 'italic' },
    { token: 'comment.doc.code', foreground: '6e6e76', fontStyle: '' },
    { token: 'comment.doc.html', foreground: 'a0a0a8', fontStyle: '' },
    { token: 'annotation', foreground: '7a5cc4' },
    { token: 'operator', foreground: '5c5c64' },
    { token: 'delimiter', foreground: '6e6e76' },
    { token: 'delimiter.angle', foreground: '6e6e76' },
  ],
};
// Nesting levels of brackets: neutral, blue, lavender, again.
export const BRACKETS = { dark: ['#b4b4bb', '#8fb4ff', '#c3b8f2'], light: ['#55555d', '#2251c9', '#6d3fc0'] };

/** Editor themes in the app's own colours, so the editor matches the rest of the window. */
export function defineThemes() {
  const base = { dark: { base: 'vs-dark', rules: RULES.dark }, light: { base: 'vs', rules: RULES.light } };
  for (const [name, def] of Object.entries(base)) {
    const isDark = name === 'dark';
    // Same as --surface, so the editor sits flush in its panel.
    const ground = isDark ? '#161617' : '#ffffff';
    const br = BRACKETS[name];
    const accent = isDark ? '#8fb4ff' : '#1f6feb';
    monaco.editor.defineTheme('blackj-' + name, {
      base: def.base,
      inherit: true,
      rules: def.rules,
      colors: {
        'editor.background': ground,
        'editor.foreground': isDark ? '#d6d6db' : '#1f1f23',
        'editorLineNumber.foreground': isDark ? '#45454b' : '#b8b8be',
        'editorLineNumber.activeForeground': isDark ? '#c4c4ca' : '#2a2a2e',
        'editor.lineHighlightBackground': isDark ? '#1c1c1e' : '#f6f6f7',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': isDark ? '#2c4270' : '#cfe0fb',
        'editor.inactiveSelectionBackground': isDark ? '#242b3b' : '#e4ecfa',
        'editor.selectionHighlightBackground': isDark ? '#ffffff12' : '#0000000c',
        'editor.wordHighlightBackground': isDark ? '#ffffff10' : '#0000000a',
        'editor.wordHighlightStrongBackground': isDark ? '#8fb4ff26' : '#1f6feb1f',
        'editor.wordHighlightTextBackground': isDark ? '#ffffff10' : '#0000000a',
        'editor.findMatchBackground': isDark ? '#8fb4ff55' : '#1f6feb40',
        'editor.findMatchHighlightBackground': isDark ? '#8fb4ff26' : '#1f6feb1f',
        'editor.findRangeHighlightBackground': isDark ? '#ffffff08' : '#00000006',
        'editor.rangeHighlightBackground': isDark ? '#ffffff0a' : '#00000008',
        'editorCursor.foreground': isDark ? '#7aa7ff' : '#1f6feb',
        'editorIndentGuide.background1': isDark ? '#1f1f22' : '#efeff1',
        'editorIndentGuide.activeBackground1': isDark ? '#34343a' : '#d6d6db',
        'editorWhitespace.foreground': isDark ? '#3a3a40' : '#d0d0d5',
        'editorRuler.foreground': isDark ? '#222225' : '#ededef',
        'editorCodeLens.foreground': isDark ? '#7d7d86' : '#7a7a82',
        'editorInlayHint.foreground': isDark ? '#8a8a93' : '#77777f',
        'editorInlayHint.background': isDark ? '#ffffff0a' : '#0000000a',
        'editorInlayHint.parameterForeground': isDark ? '#8a8a93' : '#77777f',
        'editorInlayHint.parameterBackground': isDark ? '#ffffff0a' : '#0000000a',
        'editorInlayHint.typeForeground': isDark ? '#8a8a93' : '#77777f',
        'editorInlayHint.typeBackground': isDark ? '#ffffff0a' : '#0000000a',
        'editorGhostText.foreground': isDark ? '#6e6e76' : '#9a9aa2',
        'editorLightBulb.foreground': isDark ? '#c9c9cf' : '#55555d',
        'editorLightBulbAutoFix.foreground': accent,
        'editorLink.activeForeground': accent,
        'editorGutter.foldingControlForeground': isDark ? '#808087' : '#8e8e96',
        'editorStickyScroll.background': ground,
        'editorStickyScrollHover.background': isDark ? '#1e1e20' : '#f4f4f5',
        'editorStickyScroll.shadow': isDark ? '#00000080' : '#0a0a0b14',
        'editorStickyScroll.border': isDark ? '#232325' : '#ededef',
        'editorOverviewRuler.border': '#00000000',
        'editorOverviewRuler.errorForeground': isDark ? '#f0616daa' : '#d1242faa',
        'editorOverviewRuler.warningForeground': isDark ? '#e0a43a88' : '#9a670088',
        'editorOverviewRuler.findMatchForeground': isDark ? '#8fb4ff88' : '#1f6feb88',
        'editorOverviewRuler.selectionHighlightForeground': isDark ? '#ffffff22' : '#00000022',
        // Occurrence marks at the right edge: monochrome, the written one in the accent (no mauve).
        'editorOverviewRuler.wordHighlightForeground': isDark ? '#ffffff40' : '#00000033',
        'editorOverviewRuler.wordHighlightStrongForeground': isDark ? '#8fb4ff66' : '#1f6feb55',
        'editorOverviewRuler.wordHighlightTextForeground': isDark ? '#8fb4ff66' : '#1f6feb55',
        // Links in hovers ("Problem anzeigen"): the quiet grey of secondary text.
        'textLink.foreground': isDark ? '#adadb3' : '#4d4d55',
        'textLink.activeForeground': isDark ? '#f4f4f5' : '#0a0a0b',
        'minimap.background': ground,
        'minimapSlider.background': isDark ? '#ffffff10' : '#0000000d',
        'minimapSlider.hoverBackground': isDark ? '#ffffff18' : '#00000014',
        'minimapSlider.activeBackground': isDark ? '#ffffff20' : '#0000001c',
        'peekView.border': isDark ? '#303033' : '#d9d9dd',
        'peekViewTitle.background': isDark ? '#1c1c1e' : '#f6f6f7',
        'peekViewTitleLabel.foreground': isDark ? '#f4f4f5' : '#0a0a0b',
        'peekViewTitleDescription.foreground': isDark ? '#808087' : '#66666e',
        'peekViewEditor.background': isDark ? '#131314' : '#fbfbfc',
        'peekViewEditorGutter.background': isDark ? '#131314' : '#fbfbfc',
        'peekViewEditor.matchHighlightBackground': isDark ? '#8fb4ff33' : '#1f6feb26',
        'peekViewResult.background': isDark ? '#19191b' : '#f6f6f7',
        'peekViewResult.fileForeground': isDark ? '#f4f4f5' : '#0a0a0b',
        'peekViewResult.lineForeground': isDark ? '#adadb3' : '#4d4d55',
        'peekViewResult.selectionBackground': isDark ? '#26262a' : '#e9e9eb',
        'peekViewResult.selectionForeground': isDark ? '#f4f4f5' : '#0a0a0b',
        'peekViewResult.matchHighlightBackground': isDark ? '#8fb4ff33' : '#1f6feb26',
        'editorActionList.background': isDark ? '#1e1e20' : '#ffffff',
        'editorActionList.foreground': isDark ? '#e8e8ea' : '#0a0a0b',
        'editorActionList.focusBackground': isDark ? '#2a2a2e' : '#f0f0f2',
        'editorActionList.focusForeground': isDark ? '#f4f4f5' : '#0a0a0b',
        'input.background': isDark ? '#141415' : '#ffffff',
        'input.border': isDark ? '#303033' : '#d9d9dd',
        'input.foreground': isDark ? '#f4f4f5' : '#0a0a0b',
        'inputOption.activeBorder': accent,
        'inputOption.activeBackground': isDark ? '#8fb4ff22' : '#1f6feb18',
        'list.hoverBackground': isDark ? '#232326' : '#f2f2f3',
        'list.activeSelectionBackground': isDark ? '#2a2a2e' : '#e9e9eb',
        'list.activeSelectionForeground': isDark ? '#f4f4f5' : '#0a0a0b',
        'list.inactiveSelectionBackground': isDark ? '#232326' : '#f0f0f2',
        'list.focusOutline': '#00000000',
        'list.highlightForeground': accent,
        'widget.shadow': isDark ? '#00000066' : '#0a0a0b1f',
        'editorBracketPairGuide.background1': '#00000000',
        'editorBracketPairGuide.background2': '#00000000',
        'editorBracketPairGuide.background3': '#00000000',
        'editorBracketPairGuide.activeBackground1': br[0] + '55',
        'editorBracketPairGuide.activeBackground2': br[1] + '55',
        'editorBracketPairGuide.activeBackground3': br[2] + '55',
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
        // Bracket pairs in three calm tones by nesting depth; a bracket without a partner in red.
        'editorBracketHighlight.foreground1': br[0],
        'editorBracketHighlight.foreground2': br[1],
        'editorBracketHighlight.foreground3': br[2],
        'editorBracketHighlight.foreground4': br[0],
        'editorBracketHighlight.foreground5': br[1],
        'editorBracketHighlight.foreground6': br[2],
        'editorBracketHighlight.unexpectedBracket.foreground': isDark ? '#f0616d' : '#d1242f',
        'editorBracketMatch.background': isDark ? '#ffffff14' : '#0000000f',
        'editorBracketMatch.border': isDark ? '#ffffff26' : '#0000001f',
        focusBorder: '#00000000',
        // Diff: the app's positive/negative hues, faint; no border or hatching between the panes.
        'diffEditor.insertedLineBackground': isDark ? '#3fb27f1f' : '#18794e14',
        'diffEditor.insertedTextBackground': isDark ? '#3fb27f33' : '#18794e26',
        'diffEditor.removedLineBackground': isDark ? '#f0616d1f' : '#d1242f12',
        'diffEditor.removedTextBackground': isDark ? '#f0616d33' : '#d1242f22',
        'diffEditor.border': '#00000000',
        'diffEditor.diagonalFill': '#00000000',
        // Suggestion and outline icons take the muted colour of what they stand for in the code.
        ...Object.fromEntries(['field', 'variable', 'property', 'module', 'text', 'enumMember'].map((k) => ['symbolIcon.' + k + 'Foreground', isDark ? '#8a8a93' : '#66666e'])),
        ...Object.fromEntries(['method', 'function', 'constructor'].map((k) => ['symbolIcon.' + k + 'Foreground', isDark ? '#c9c9cf' : '#3a3a40'])),
        ...Object.fromEntries(['class', 'interface', 'enum', 'struct', 'typeParameter'].map((k) => ['symbolIcon.' + k + 'Foreground', isDark ? '#a99be0' : '#7a5cc4'])),
        ...Object.fromEntries(['keyword', 'snippet'].map((k) => ['symbolIcon.' + k + 'Foreground', isDark ? '#7f9fe0' : '#2251c9'])),
        'symbolIcon.constantForeground': isDark ? '#6fb3bf' : '#0b7285',
        'editorSuggestWidget.highlightForeground': accent,
        'editorSuggestWidget.focusHighlightForeground': accent,
        'editorSuggestWidget.foreground': isDark ? '#f4f4f5' : '#0a0a0b',
        'editorSuggestWidget.selectedForeground': isDark ? '#f4f4f5' : '#0a0a0b',
      },
    });
  }
}

export default monaco;
