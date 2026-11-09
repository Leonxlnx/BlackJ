// Snippets for school Java: short names, German placeholders, each one only where it fits
// (a statement inside a method, a member inside a class, a type at the top of a file).
// [prefix, body, German description, English description, where, import]

export const SNIPPETS = [
  ['sout', 'System.out.println(${1});', 'Zeile ausgeben', 'Print a line', 'stmt'],
  ['souf', 'System.out.printf("${1:%d}%n", ${2:wert});', 'Formatiert ausgeben', 'Print formatted', 'stmt'],
  ['serr', 'System.err.println(${1});', 'Fehlermeldung ausgeben', 'Print an error', 'stmt'],
  ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:anzahl}; ${1:i}++) {\n\t$0\n}', 'Zählschleife', 'Counting loop', 'stmt'],
  ['forr', 'for (int ${1:i} = ${2:anzahl} - 1; ${1:i} >= 0; ${1:i}--) {\n\t$0\n}', 'Rückwärts zählen', 'Count down', 'stmt'],
  ['foreach', 'for (${1:Typ} ${2:element} : ${3:liste}) {\n\t$0\n}', 'Für jedes Element', 'For each element', 'stmt'],
  ['if', 'if (${1:bedingung}) {\n\t$0\n}', 'Wenn …', 'If …', 'stmt'],
  ['ifelse', 'if (${1:bedingung}) {\n\t$2\n} else {\n\t$0\n}', 'Wenn … sonst …', 'If … else …', 'stmt'],
  ['elseif', 'else if (${1:bedingung}) {\n\t$0\n}', 'Sonst wenn …', 'Else if …', 'stmt'],
  ['while', 'while (${1:bedingung}) {\n\t$0\n}', 'Solange …', 'While …', 'stmt'],
  ['dowhile', 'do {\n\t$0\n} while (${1:bedingung});', 'Erst tun, dann prüfen', 'Do, then check', 'stmt'],
  ['switch', 'switch (${1:wert}) {\n\tcase ${2:1}:\n\t\t$3\n\t\tbreak;\n\tdefault:\n\t\t$0\n}', 'Fallunterscheidung', 'Switch', 'stmt'],
  ['try', 'try {\n\t$1\n} catch (${2:Exception} ${3:e}) {\n\t${0:System.out.println(${3:e}.getMessage());}\n}', 'Fehler abfangen', 'Catch an error', 'stmt'],
  ['scanner', 'Scanner ${1:eingabe} = new Scanner(System.in);', 'Tastatur lesen', 'Read the keyboard', 'stmt', 'java.util.Scanner'],
  ['readint', 'System.out.print("${1:Zahl}: ");\nint ${2:zahl} = ${3:eingabe}.nextInt();', 'Zahl einlesen', 'Read a number', 'stmt'],
  ['readline', 'System.out.print("${1:Name}: ");\nString ${2:text} = ${3:eingabe}.nextLine();', 'Text einlesen', 'Read a line', 'stmt'],
  ['random', 'Random ${1:zufall} = new Random();', 'Zufallsgenerator', 'Random generator', 'stmt', 'java.util.Random'],
  ['wuerfel', 'int ${1:wurf} = ${2:zufall}.nextInt(${3:6}) + 1;', 'Zufallszahl 1 bis n', 'Random number 1 to n', 'stmt'],
  ['list', 'ArrayList<${1:String}> ${2:liste} = new ArrayList<>();', 'Neue Liste', 'New list', 'any', 'java.util.ArrayList'],
  ['map', 'HashMap<${1:String}, ${2:Integer}> ${3:tabelle} = new HashMap<>();', 'Neue Zuordnung', 'New map', 'any', 'java.util.HashMap'],
  ['array', '${1:int}[] ${2:zahlen} = new ${1:int}[${3:10}];', 'Neues Array', 'New array', 'any'],
  ['field', 'private ${1:int} ${2:name};', 'Attribut', 'Field', 'member'],
  ['ctor', 'public ${1:__CLASS__}(${2}) {\n\t$0\n}', 'Konstruktor', 'Constructor', 'member'],
  ['method', 'public ${1:void} ${2:name}(${3}) {\n\t$0\n}', 'Methode', 'Method', 'member'],
  ['main', 'public static void main(String[] args) {\n\t$0\n}', 'main-Methode', 'main method', 'member'],
  ['get', 'public ${1:int} get${2:Wert}() {\n\treturn ${3:wert};\n}', 'Getter', 'Getter', 'member'],
  ['set', 'public void set${1:Wert}(${2:int} ${3:wert}) {\n\tthis.${3:wert} = ${3:wert};\n}', 'Setter', 'Setter', 'member'],
  ['tostring', '@Override\npublic String toString() {\n\treturn "__CLASS__[" + ${0} + "]";\n}', 'Als Text beschreiben', 'Describe as text', 'member'],
  ['test', '@Test\npublic void ${1:testName}() {\n\t${0:assertEquals(erwartet, tatsaechlich);}\n}', 'JUnit-Test', 'JUnit test', 'member', 'org.junit.jupiter.api.Test'],
  ['ae', 'assertEquals(${1:erwartet}, ${2:tatsaechlich});', 'Erwarteten Wert prüfen', 'Check the expected value', 'stmt'],
  ['at', 'assertTrue(${1:bedingung});', 'Muss wahr sein', 'Must be true', 'stmt'],
  ['class', 'public class ${1:__FILE__} {\n\t$0\n}', 'Klasse', 'Class', 'top'],
  ['interface', 'public interface ${1:__FILE__} {\n\t$0\n}', 'Interface', 'Interface', 'top'],
  ['enum', 'public enum ${1:__FILE__} {\n\t${0:ROT, GRUEN, BLAU}\n}', 'Aufzählung', 'Enum', 'top'],
];

/** Packages of the library classes students use most, for automatic imports. */
export const IMPORTS = {
  ArrayList: 'java.util', LinkedList: 'java.util', List: 'java.util', HashMap: 'java.util', TreeMap: 'java.util', Map: 'java.util',
  HashSet: 'java.util', TreeSet: 'java.util', Set: 'java.util', Iterator: 'java.util', Scanner: 'java.util', Random: 'java.util',
  Arrays: 'java.util', Collections: 'java.util', Objects: 'java.util', Optional: 'java.util', Stack: 'java.util', Queue: 'java.util',
  Deque: 'java.util', ArrayDeque: 'java.util', PriorityQueue: 'java.util', Comparator: 'java.util', LocalDate: 'java.time',
  LocalDateTime: 'java.time', LocalTime: 'java.time', Duration: 'java.time', File: 'java.io', IOException: 'java.io',
  FileReader: 'java.io', FileWriter: 'java.io', BufferedReader: 'java.io', PrintWriter: 'java.io', Files: 'java.nio.file',
  Path: 'java.nio.file', Paths: 'java.nio.file', BigDecimal: 'java.math', BigInteger: 'java.math', DecimalFormat: 'java.text',
  Function: 'java.util.function', Predicate: 'java.util.function', Consumer: 'java.util.function', Supplier: 'java.util.function',
  Collectors: 'java.util.stream', Stream: 'java.util.stream', IntStream: 'java.util.stream',
  Test: 'org.junit.jupiter.api', BeforeEach: 'org.junit.jupiter.api', AfterEach: 'org.junit.jupiter.api', DisplayName: 'org.junit.jupiter.api',
};

/** Classes that need no import. */
export const JAVA_LANG = new Set(['String', 'StringBuilder', 'Math', 'Integer', 'Double', 'Character', 'Boolean', 'Long', 'Float', 'Short', 'Byte', 'Object', 'System', 'Thread', 'Runnable', 'Exception', 'RuntimeException', 'IllegalArgumentException', 'IllegalStateException', 'NullPointerException', 'ArithmeticException', 'IndexOutOfBoundsException', 'ArrayIndexOutOfBoundsException', 'NumberFormatException', 'Comparable', 'Iterable', 'Override', 'Record', 'Enum', 'Error', 'Number', 'CharSequence', 'Cloneable', 'Void']);

/** Where `import x.y.Z;` goes in this text, and the edit, or null if it is not needed. */
export function importEdit(text, qualified) {
  const simple = qualified.split('.').pop();
  const pkg = qualified.slice(0, qualified.lastIndexOf('.'));
  const own = (text.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1] || '';
  if (pkg === own || pkg === 'java.lang') return null;
  const already = new RegExp(`^\\s*import\\s+(${qualified.replace(/\./g, '\\.')}|${pkg.replace(/\./g, '\\.')}\\.\\*)\\s*;`, 'm');
  if (already.test(text)) return null;
  // A class of the same simple name imported from elsewhere: leave it alone.
  if (new RegExp(`^\\s*import\\s+[\\w.]+\\.${simple}\\s*;`, 'm').test(text)) return null;
  const lines = text.split('\n');
  let after = -1;
  let pkgLine = -1;
  lines.forEach((l, i) => {
    if (/^\s*import\s/.test(l)) after = i;
    if (/^\s*package\s/.test(l)) pkgLine = i;
  });
  const line = `import ${qualified};`;
  if (after >= 0) {
    // Keep imports sorted when they already are.
    let at = after + 1;
    for (let i = 0; i <= after; i++) {
      const m = lines[i].match(/^\s*import\s+(?!static)([\w.]+)\s*;/);
      if (m && m[1] > qualified) {
        at = i;
        break;
      }
    }
    return { line: at + 1, text: line + '\n' };
  }
  if (pkgLine >= 0) return { line: pkgLine + 2, text: '\n' + line + '\n' };
  return { line: 1, text: line + '\n\n' };
}
