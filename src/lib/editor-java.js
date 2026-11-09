// BlackJ's own Java grammar and editing rules for Monaco: finer colours than Monaco's built-in
// grammar (method names, types, constants, this/null, Javadoc tags), Javadoc that continues its
// stars on Enter, and indentation that follows braces, case labels and braceless if/else.

const KEYWORDS = [
  'abstract', 'assert', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'do', 'else', 'enum', 'extends',
  'final', 'finally', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'interface', 'native', 'new', 'package',
  'private', 'protected', 'public', 'return', 'static', 'strictfp', 'switch', 'synchronized', 'throw', 'throws', 'transient',
  'try', 'volatile', 'while', 'yield', 'record', 'sealed', 'permits',
];
const TYPE_KEYWORDS = ['boolean', 'byte', 'char', 'double', 'float', 'int', 'long', 'short', 'void', 'var'];

export function javaLanguage(monaco) {
  const { IndentAction } = monaco.languages;
  const conf = {
    wordPattern: /(-?\d*\.\d\w*)|([^`~!#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g,
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
      { open: '/**', close: ' */', notIn: ['string'] },
    ],
    autoCloseBefore: ';:.,=}])> \n\t',
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '<', close: '>' },
    ],
    folding: {
      markers: {
        start: /^\s*\/\/\s*(?:(?:#?region\b)|(?:<editor-fold\b))/,
        end: /^\s*\/\/\s*(?:(?:#?endregion\b)|(?:<\/editor-fold>))/,
      },
    },
    indentationRules: {
      increaseIndentPattern: /^((?!\/\/).)*(\{[^}"'`]*|\([^)"'`]*|\[[^\]"'`]*)$/,
      decreaseIndentPattern: /^((?!.*?\/\*).*\*\/)?\s*[}\])].*$/,
    },
    onEnterRules: [
      // /** | */ : the cursor goes on a new " * " line between.
      { beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/, afterText: /^\s*\*\/$/, action: { indentAction: IndentAction.IndentOutdent, appendText: ' * ' } },
      { beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/, action: { indentAction: IndentAction.None, appendText: ' * ' } },
      { beforeText: /^(\t|[ ])*[ ]\*([ ]([^*]|\*(?!\/))*)?$/, previousLineText: /(?=^(\s*(\/\*\*|\*)).*)(?=(?!(\s*\*\/)))/, action: { indentAction: IndentAction.None, appendText: '* ' } },
      { beforeText: /^(\t|[ ])*[ ]\*\/\s*$/, action: { indentAction: IndentAction.None, removeText: 1 } },
      { beforeText: /^(\t|[ ])*[ ]\*[^/]*\*\/\s*$/, action: { indentAction: IndentAction.None, removeText: 1 } },
      // case 1: | → the statements one level in.
      { beforeText: /^\s*(case\s[^;]*|default\s*):\s*$/, action: { indentAction: IndentAction.Indent } },
      // if (x) | without a brace: one statement one level in, then back.
      { beforeText: /^\s*(?:(?:\}\s*)?(?:else\s+)?if|for|while)\s*\(.*\)\s*$/, action: { indentAction: IndentAction.Indent } },
      { beforeText: /^\s*(?:\}\s*)?else\s*$/, action: { indentAction: IndentAction.Indent } },
      { previousLineText: /^\s*(((else ?)?if|for|while)\s*\(.*\)\s*|(\}\s*)?else\s*)$/, beforeText: /^\s+([^{i\s]|i(?!f\b))/, action: { indentAction: IndentAction.Outdent } },
    ],
  };

  const language = {
    defaultToken: '',
    tokenPostfix: '.java',
    keywords: KEYWORDS,
    typeKeywords: TYPE_KEYWORDS,
    literals: ['true', 'false', 'null'],
    selfs: ['this', 'super'],
    operators: ['=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '>>>=', '->', '::'],
    symbols: /[=><!~?:&|+\-*/^%]+/,
    escapes: /\\(?:[abfnrtvs\\"']|x[0-9A-Fa-f]{1,4}|u+[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[0-7]{1,3})/,
    digits: /\d+(_+\d+)*/,
    octaldigits: /[0-7]+(_+[0-7]+)*/,
    binarydigits: /[0-1]+(_+[0-1]+)*/,
    hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,
    tokenizer: {
      root: [
        ['non-sealed', 'keyword'],
        [/@\s*[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*/, 'annotation'],
        // A name followed by ( is a method (or a constructor: then it is a type).
        [/[a-z_$][\w$]*(?=\s*\()/, { cases: { '@keywords': 'keyword', '@typeKeywords': 'keyword.type', '@literals': 'constant.language', '@selfs': 'keyword.self', '@default': 'function' } }],
        [/[A-Z][A-Z0-9_]*[A-Z0-9_](?![\w$])/, 'constant'],
        [/[A-Z][\w$]*/, 'type'],
        [/[a-z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@typeKeywords': 'keyword.type', '@literals': 'constant.language', '@selfs': 'keyword.self', '@default': 'identifier' } }],
        { include: '@whitespace' },
        [/[{}()[\]]/, '@brackets'],
        [/[<>](?!@symbols)/, 'delimiter.angle'],
        [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
        [/(@digits)[eE]([-+]?(@digits))?[fFdD]?/, 'number.float'],
        [/(@digits)\.(@digits)([eE][-+]?(@digits))?[fFdD]?/, 'number.float'],
        [/\.(@digits)([eE][-+]?(@digits))?[fFdD]?/, 'number.float'],
        [/0[xX](@hexdigits)[Ll]?/, 'number.hex'],
        [/0(@octaldigits)[Ll]?/, 'number.octal'],
        [/0[bB](@binarydigits)[Ll]?/, 'number.binary'],
        [/(@digits)[fFdD]/, 'number.float'],
        [/(@digits)[lL]?/, 'number'],
        [/[;,.]/, 'delimiter'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"""/, 'string', '@textblock'],
        [/"/, 'string', '@string'],
        [/'[^\\']'/, 'string.char'],
        [/(')(@escapes)(')/, ['string.char', 'string.escape', 'string.char']],
        [/'/, 'string.invalid'],
      ],
      whitespace: [
        [/[ \t\r\n]+/, ''],
        [/\/\*\*(?!\/)/, 'comment.doc', '@javadoc'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/\s*(TODO|FIXME)\b.*$/, 'comment.todo'],
        [/\/\/.*$/, 'comment'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
      javadoc: [
        [/(@@param)(\s+)([\w$]+)/, ['comment.doc.tag', '', 'comment.doc.name']],
        [/@[a-zA-Z]+/, 'comment.doc.tag'],
        [/\{@[a-zA-Z]+[^}]*\}/, 'comment.doc.code'],
        [/<\/?[a-zA-Z][^>]*>/, 'comment.doc.html'],
        [/[^/*@{<]+/, 'comment.doc'],
        [/\*\//, 'comment.doc', '@pop'],
        [/[/*@{<]/, 'comment.doc'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, 'string', '@pop'],
      ],
      textblock: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"""/, 'string', '@pop'],
        [/./, 'string'],
      ],
    },
  };
  return { conf, language };
}
