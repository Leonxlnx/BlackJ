// Plain-language explanations for javac's messages (javac runs in English, see compiler.cjs).
// Each rule: a pattern on the message, then title / why it happens / one short thing to do,
// in German and English. {1}, {2} … are filled from the pattern's groups, {symbol} from javac's
// "symbol:" detail line.

const RULES = [
  {
    id: 'semicolon',
    re: /^';' expected$/,
    de: ['Semikolon fehlt', 'Jede Anweisung in Java endet mit einem Semikolon ;. Hier hat der Compiler eins erwartet. Oft fehlt es am Ende der Zeile davor.', 'Setz ein ; ans Ende der Anweisung.'],
    en: ['Missing semicolon', 'Every statement in Java ends with a semicolon ;. The compiler expected one here. Often it is missing at the end of the line before.', 'Put a ; at the end of the statement.'],
  },
  {
    id: 'symbol',
    re: /^cannot find symbol$/,
    de: ['Unbekannter Name: {symbol}', 'Java kennt den Namen {symbol} an dieser Stelle nicht. Vielleicht ist er anders geschrieben, nicht deklariert (in dieser Methode oder als Attribut), oder die Methode hat andere Parameter.', 'Prüf Schreibweise und Groß-/Kleinschreibung.'],
    en: ['Unknown name: {symbol}', 'Java does not know the name {symbol} at this point. It may be spelled differently, not declared (in this method or as a field), or the method has other parameters.', 'Check the spelling, including upper and lower case.'],
  },
  {
    id: 'lossy',
    re: /^incompatible types: possible lossy conversion from (\S+) to (\S+)$/,
    de: ['{1} passt nicht in {2}', 'Ein Wert vom Typ {1} soll in einen {2} gespeichert werden. Dabei könnten Nachkommastellen oder große Werte verloren gehen, deshalb macht Java das nicht von selbst. Bewusst umwandeln geht mit ({2}) wert.', 'Ändere den Typ der Variablen auf {1}.'],
    en: ['{1} does not fit into {2}', 'A value of type {1} is stored in a {2}. Decimals or large values could be lost, so Java will not do it on its own. To convert on purpose, write ({2}) value.', 'Change the variable\'s type to {1}.'],
  },
  {
    id: 'incompatible',
    re: /^incompatible types: (.+) cannot be converted to (.+)$/,
    de: ['Falscher Datentyp', 'Hier steht ein Wert vom Typ {1}, gebraucht wird aber {2}. Text wird mit Integer.parseInt(text) zur Zahl, eine Zahl mit "" + zahl zu Text.', 'Prüf, welchen Typ die Variable erwartet.'],
    en: ['Wrong data type', 'There is a value of type {1} here, but {2} is needed. Integer.parseInt(text) turns text into a number, "" + number turns a number into text.', 'Check which type the variable expects.'],
  },
  {
    id: 'missingReturn',
    re: /^missing return statement$/,
    de: ['return fehlt', 'Die Methode verspricht einen Rückgabewert, aber nicht jeder Weg durch die Methode endet mit return, auch nicht in jedem Zweig von if/else. Soll sie nichts zurückgeben, ist void der richtige Rückgabetyp.', 'Schreib am Ende jedes Wegs ein return mit Wert.'],
    en: ['Missing return', 'The method promises a return value, but not every path through it ends with return, including every branch of if/else. If it should return nothing, void is the right return type.', 'End every path with a return and a value.'],
  },
  {
    id: 'fileName',
    re: /^class (\S+) is public, should be declared in a file named (\S+)$/,
    de: ['Dateiname passt nicht', 'Eine public-Klasse muss genauso heißen wie ihre Datei. Die Klasse heißt {1}, die Datei aber nicht {2}.', 'Benenne Klasse oder Datei um, damit beide gleich heißen.'],
    en: ['File name does not match', 'A public class must have the same name as its file. The class is called {1}, but the file is not {2}.', 'Rename the class or the file so both match.'],
  },
  {
    id: 'eof',
    re: /^reached end of file while parsing$/,
    de: ['Klammer } fehlt', 'Die Datei ist zu Ende, aber mindestens eine geschweifte Klammer { ist noch offen. „Einrücken“ zeigt dir, wo die Einrückung nicht mehr stimmt.', 'Gib jeder { ihre passende }.'],
    en: ['Missing }', 'The file ends, but at least one curly brace { is still open. “Indent” shows you where the indentation goes wrong.', 'Give every { its matching }.'],
  },
  {
    id: 'expected',
    re: /^(<identifier>|'\('|'\)'|'\{'|'\}'|'\['|'\]'|'='|'\.'|class, interface, enum, or record|class, interface, or enum) expected$/,
    de: ['Hier fehlt etwas: {1}', 'An dieser Stelle hat der Compiler {1} erwartet. Meist ist die Zeile davor unvollständig, oder Code wie x = 5; steht direkt in der Klasse statt in einer Methode.', 'Prüf Klammern und Semikolons in dieser und der Zeile davor.'],
    en: ['Something is missing: {1}', 'At this point the compiler expected {1}. Usually the line before is incomplete, or code such as x = 5; sits directly in the class instead of a method.', 'Check braces and semicolons here and in the line before.'],
  },
  {
    id: 'illegalStart',
    re: /^illegal start of (expression|type|statement)$/,
    de: ['Code an der falschen Stelle', 'Hier beginnt etwas, das an dieser Stelle nicht erlaubt ist. Oft fehlt kurz davor eine Klammer, oder eine Methode steht in einer anderen Methode. „Einrücken“ zeigt schnell, wo eine Methode zu früh endet.', 'Prüf die Klammern vor dieser Zeile.'],
    en: ['Code in the wrong place', 'Something starts here that is not allowed at this point. Often a brace is missing just before it, or a method sits inside another method. “Indent” quickly shows where a method ends too early.', 'Check the braces before this line.'],
  },
  {
    id: 'already',
    re: /^variable (\S+) is already defined in (.+)$/,
    de: ['{1} gibt es schon', 'Die Variable {1} wurde in {2} bereits deklariert. Ein Name darf im selben Bereich nur einmal deklariert werden. Ohne Typ ist es eine Zuweisung: {1} = …', 'Lass beim zweiten Mal den Typ weg, oder nimm einen anderen Namen.'],
    en: ['{1} already exists', 'The variable {1} was already declared in {2}. A name may be declared only once in the same scope. Without the type it is an assignment: {1} = …', 'Drop the type the second time, or pick another name.'],
  },
  {
    id: 'uninit',
    re: /^variable (\S+) might not have been initialized$/,
    de: ['{1} hat noch keinen Wert', 'Die lokale Variable {1} wird benutzt, bevor ihr sicher ein Wert zugewiesen wurde.', 'Gib ihr bei der Deklaration einen Startwert: int {1} = 0;'],
    en: ['{1} has no value yet', 'The local variable {1} is used before it has surely been given a value.', 'Give it a starting value when declaring it: int {1} = 0;'],
  },
  {
    id: 'staticContext',
    re: /^non-static (variable|method) (\S+) cannot be referenced from a static context$/,
    de: ['{2} braucht ein Objekt', '{2} gehört zu einem Objekt, aber du bist in einer static-Methode (zum Beispiel main). Dort gibt es kein „aktuelles Objekt“, also z. B. Klasse k = new Klasse(); k.{2}…', 'Erzeuge zuerst ein Objekt und ruf {2} darüber auf.'],
    en: ['{2} needs an object', '{2} belongs to an object, but you are in a static method (for example main). There is no “current object” there, so e.g. MyClass c = new MyClass(); c.{2}…', 'Create an object first and call {2} through it.'],
  },
  {
    id: 'unreachable',
    re: /^unreachable statement$/,
    de: ['Diese Zeile wird nie erreicht', 'Davor steht ein return, break oder eine Endlosschleife. Danach kann nichts mehr ausgeführt werden.', 'Lösche die Zeile oder setze sie vor das return.'],
    en: ['This line is never reached', 'Before it there is a return, break or an endless loop. Nothing after it can run.', 'Delete the line or move it before the return.'],
  },
  {
    id: 'abstractNew',
    re: /^(\S+) is abstract; cannot be instantiated$/,
    de: ['{1} ist abstrakt', 'Von einer abstrakten Klasse kann man mit new kein Objekt erzeugen. Sie ist nur eine Vorlage für Unterklassen, z. B. new Hund(…) statt new Tier(…).', 'Erzeuge ein Objekt einer Unterklasse.'],
    en: ['{1} is abstract', 'You cannot create an object of an abstract class with new. It is only a template for subclasses, e.g. new Dog(…) instead of new Animal(…).', 'Create an object of a subclass.'],
  },
  {
    id: 'notOverride',
    re: /^(\S+) is not abstract and does not override abstract method (.+) in (\S+)$/,
    de: ['{2} fehlt in {1}', '{3} schreibt vor, dass es die Methode {2} gibt. {1} hat sie aber nicht geschrieben.', 'Schreib {2} in {1}, mit derselben Signatur wie in {3}.'],
    en: ['{2} is missing in {1}', '{3} requires the method {2}. But {1} does not implement it.', 'Write {2} in {1}, with the same signature as in {3}.'],
  },
  {
    id: 'badOperand',
    re: /^bad operand types? for (binary|unary) operator '(.+)'$/,
    de: ['{2} passt nicht zu diesen Typen', 'Der Operator {2} funktioniert mit diesen Datentypen nicht, z. B. && mit Zahlen oder - mit Text. Texte vergleichst du mit a.equals(b), nicht mit ==.', 'Prüf die Typen links und rechts vom Operator.'],
    en: ['{2} does not work with these types', 'The operator {2} does not work with these data types, e.g. && with numbers or - with text. Compare texts with a.equals(b), not with ==.', 'Check the types on both sides of the operator.'],
  },
  {
    id: 'cannotApply',
    re: /^(constructor|method) (\S+) in (class|interface|enum) (\S+) cannot be applied to given types;?$/,
    de: ['Falsche Parameter für {2}', 'Der Aufruf passt nicht zur Deklaration: Anzahl oder Typen der Parameter stimmen nicht. Unten steht, was verlangt ist (required) und was du übergibst (found).', 'Übergib genau die Parameter, die {2} verlangt.'],
    en: ['Wrong parameters for {2}', 'The call does not match the declaration: the number or types of parameters differ. Below it says what is required and what you passed (found).', 'Pass exactly the parameters {2} requires.'],
  },
  {
    id: 'noSuitable',
    re: /^no suitable (constructor|method) found for (.+)$/,
    de: ['Keine passende Version von {2}', 'Es gibt keine Variante, die zu deinen Parametern passt. javac zählt die Varianten darunter auf.', 'Vergleiche deine Parameter mit den aufgezählten Varianten.'],
    en: ['No matching version of {2}', 'There is no variant that fits your parameters. javac lists the variants below.', 'Compare your parameters with the listed variants.'],
  },
  {
    id: 'unclosedString',
    re: /^unclosed (string|character) literal$/,
    de: ['Anführungszeichen nicht geschlossen', 'Ein Text in "…" (oder ein Zeichen in \'…\') wird nicht geschlossen. Ein Text darf nicht über das Zeilenende gehen.', 'Setz das schließende Anführungszeichen.'],
    en: ['Quote not closed', 'A text in "…" (or a character in \'…\') is not closed. A text may not run past the end of the line.', 'Add the closing quote.'],
  },
  {
    id: 'elseWithoutIf',
    re: /^'else' without 'if'$/,
    de: ['else ohne if', 'Zu diesem else gehört kein if. Oft steht ein ; direkt nach if (…) oder eine Klammer } fehlt.', 'Entferne das ; nach der Bedingung.'],
    en: ['else without if', 'This else has no matching if. Often there is a ; right after if (…) or a } is missing.', 'Remove the ; after the condition.'],
  },
  {
    id: 'returnType',
    re: /^invalid method declaration; return type required$/,
    de: ['Rückgabetyp fehlt', 'Vor dem Methodennamen muss stehen, was die Methode zurückgibt (z. B. int, String oder void). Oder: Es soll ein Konstruktor sein, aber er heißt anders als die Klasse.', 'Schreib den Rückgabetyp vor den Methodennamen.'],
    en: ['Return type missing', 'Before the method name there must be what it returns (e.g. int, String or void). Or: it is meant to be a constructor, but it is named differently from the class.', 'Write the return type before the method name.'],
  },
  {
    id: 'privateAccess',
    re: /^(\S+) has private access in (\S+)$/,
    de: ['{1} ist private', '{1} ist in {2} private. Nur Code in {2} selbst darf darauf zugreifen. Das ist Datenkapselung.', 'Benutze eine öffentliche Methode von {2}, z. B. einen Getter.'],
    en: ['{1} is private', '{1} is private in {2}. Only code inside {2} may access it. That is encapsulation.', 'Use a public method of {2}, such as a getter.'],
  },
  {
    id: 'voidReturn',
    re: /^incompatible types: unexpected return value$/,
    de: ['void-Methode gibt etwas zurück', 'Die Methode ist als void deklariert, gibt aber mit return einen Wert zurück. Ohne Wert reicht return;', 'Ändere void in den passenden Typ.'],
    en: ['void method returns a value', 'The method is declared void but returns a value with return. Without a value, return; is enough.', 'Change void to the matching type.'],
  },
  {
    id: 'missingBody',
    re: /^missing method body, or declare abstract$/,
    de: ['Methodenrumpf fehlt', 'Nach dem Methodenkopf fehlt { … }. Oft steht dort ein ; zu viel.', 'Entferne das ; nach der Klammer ) und schreib den Rumpf.'],
    en: ['Method body missing', 'The method header is not followed by { … }. Often there is an extra ; there.', 'Remove the ; after the ) and write the body.'],
  },
  {
    id: 'notStatement',
    re: /^not a statement$/,
    de: ['Keine vollständige Anweisung', 'Hier steht ein Ausdruck, mit dem nichts passiert, z. B. x + 1; ohne Zuweisung.', 'Speichere das Ergebnis, z. B. x = x + 1;'],
    en: ['Not a complete statement', 'This is an expression that does nothing, e.g. x + 1; without an assignment.', 'Store the result, e.g. x = x + 1;'],
  },
  {
    id: 'dereference',
    re: /^(int|double|char|boolean|long|float|short|byte) cannot be dereferenced$/,
    de: ['{1} hat keine Methoden', '{1} ist ein einfacher Datentyp, kein Objekt. Deshalb kannst du keinen Punkt dahinter setzen. Hilfsklassen helfen, z. B. String.valueOf(zahl).', 'Lass den Methodenaufruf hinter {1} weg.'],
    en: ['{1} has no methods', '{1} is a primitive type, not an object. That is why you cannot put a dot after it. Helper classes help, e.g. String.valueOf(number).', 'Drop the method call after the {1}.'],
  },
  {
    id: 'finalAssign',
    re: /^cannot assign a value to final variable (\S+)$/,
    de: ['{1} ist final', '{1} ist mit final deklariert und kann danach nicht mehr geändert werden.', 'Entferne final, wenn sich der Wert ändern soll.'],
    en: ['{1} is final', '{1} is declared final and cannot be changed afterwards.', 'Remove final if the value should change.'],
  },
];

const FALLBACK = {
  de: ['Der Compiler hat ein Problem gefunden', 'javac hat diese Stelle nicht verstanden. Die Meldung unten sagt genauer, was fehlt.', 'Lies die Meldung, oder frag den Tutor.'],
  en: ['The compiler found a problem', 'javac did not understand this spot. The message below says more exactly what is missing.', 'Read the message, or ask the tutor.'],
};

function fill(s, groups, symbol) {
  return s.replace(/\{(\d)\}/g, (_, n) => groups[n] ?? '').replace(/\{symbol\}/g, symbol);
}

/** { title, explain, fix } for one javac problem. */
export function explainProblem(problem, lang) {
  const msg = problem.message.trim();
  const symbolLine = (problem.details || []).find((d) => d.startsWith('symbol:'));
  const symbol = symbolLine ? symbolLine.replace(/^symbol:\s*(variable|method|class)?\s*/, '').trim() : '';
  for (const rule of RULES) {
    const m = msg.match(rule.re);
    if (!m) continue;
    const [title, explain, fix] = rule[lang] || rule.de;
    return { id: rule.id, title: fill(title, m, symbol), explain: fill(explain, m, symbol), fix: fill(fix, m, symbol) };
  }
  const [title, explain, fix] = FALLBACK[lang] || FALLBACK.de;
  return { id: 'other', title, explain, fix };
}

/** The reference list on the Learn screen. */
export function commonErrors(lang) {
  const samples = {
    semicolon: "';' expected",
    symbol: 'cannot find symbol',
    incompatible: 'incompatible types: String cannot be converted to int',
    lossy: 'incompatible types: possible lossy conversion from double to int',
    missingReturn: 'missing return statement',
    eof: 'reached end of file while parsing',
    illegalStart: 'illegal start of expression',
    uninit: 'variable x might not have been initialized',
    staticContext: 'non-static variable name cannot be referenced from a static context',
    privateAccess: 'kontostand has private access in Konto',
    cannotApply: 'constructor Hund in class Hund cannot be applied to given types;',
    abstractNew: 'Tier is abstract; cannot be instantiated',
    notOverride: 'Katze is not abstract and does not override abstract method gibLaut() in Tier',
    badOperand: "bad operand types for binary operator '&&'",
  };
  return Object.entries(samples).map(([id, message]) => ({ id, message, ...explainProblem({ message, details: id === 'symbol' ? ['symbol:   variable zahl'] : [] }, lang) }));
}
