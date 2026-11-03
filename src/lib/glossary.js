// The concepts on the Learn screen. Each: group, title, text and a short example.
export const GROUPS = {
  de: { oop: 'Objektorientierung', basics: 'Grundlagen', flow: 'Ablauf', more: 'Weiter' },
  en: { oop: 'Object orientation', basics: 'Basics', flow: 'Control flow', more: 'Further' },
};

export const CONCEPTS = [
  {
    id: 'klasse', group: 'oop',
    de: ['Klasse', 'Eine Klasse ist ein Bauplan. Sie legt fest, was sich Objekte merken (Attribute) und was sie können (Methoden). Im Klassendiagramm ist jede Karte eine Klasse.'],
    en: ['Class', 'A class is a blueprint. It defines what objects remember (fields) and what they can do (methods). Every card in the class diagram is a class.'],
    code: 'public class Hund {\n    private String name;\n\n    public void bellen() {\n        System.out.println("Wuff!");\n    }\n}',
  },
  {
    id: 'objekt', group: 'oop',
    de: ['Objekt', 'Ein Objekt ist ein konkretes Ding, das nach dem Bauplan einer Klasse gebaut wurde. Von einer Klasse kann es viele Objekte geben, jedes mit eigenen Werten. In BlackJ liegen Objekte auf der Objektbank.'],
    en: ['Object', 'An object is a concrete thing built from a class\'s blueprint. A class can have many objects, each with its own values. In BlackJ, objects sit on the object bench.'],
    code: 'Hund bello = new Hund("Bello");\nHund rex = new Hund("Rex");',
  },
  {
    id: 'attribut', group: 'oop',
    de: ['Attribut', 'Ein Attribut ist eine Variable, die zu einem Objekt gehört. Jedes Objekt hat seine eigenen Werte. Attribute stehen oben in der Klasse, außerhalb der Methoden, und sind meist private.'],
    en: ['Field', 'A field (attribute) is a variable that belongs to an object. Each object has its own values. Fields sit at the top of the class, outside the methods, and are usually private.'],
    code: 'public class Konto {\n    private double kontostand;\n    private String inhaber;\n}',
  },
  {
    id: 'methode', group: 'oop',
    de: ['Methode', 'Eine Methode ist etwas, das ein Objekt tun kann. Sie hat einen Namen, Parameter in Klammern und einen Rückgabetyp. Rechtsklick auf ein Objekt zeigt seine Methoden.'],
    en: ['Method', 'A method is something an object can do. It has a name, parameters in brackets and a return type. Right-click an object to see its methods.'],
    code: 'public void einzahlen(double betrag) {\n    kontostand = kontostand + betrag;\n}',
  },
  {
    id: 'konstruktor', group: 'oop',
    de: ['Konstruktor', 'Der Konstruktor läuft genau einmal, wenn ein Objekt mit new erzeugt wird. Er heißt wie die Klasse, hat keinen Rückgabetyp und setzt die Startwerte der Attribute.'],
    en: ['Constructor', 'The constructor runs exactly once when an object is created with new. It has the class\'s name, no return type, and sets the fields\' starting values.'],
    code: 'public Konto(String inhaber) {\n    this.inhaber = inhaber;\n    kontostand = 0;\n}',
  },
  {
    id: 'parameter', group: 'oop',
    de: ['Parameter', 'Parameter sind die Werte, die eine Methode beim Aufruf bekommt. Sie stehen in den Klammern, jeweils mit Typ und Namen.'],
    en: ['Parameter', 'Parameters are the values a method receives when it is called. They sit in the brackets, each with a type and a name.'],
    code: 'public int addiere(int a, int b) {\n    return a + b;\n}\n\n// Aufruf: addiere(3, 4) ergibt 7',
  },
  {
    id: 'rueckgabe', group: 'oop',
    de: ['Rückgabewert', 'Mit return gibt eine Methode ein Ergebnis an den Aufrufer zurück. Der Typ vor dem Methodennamen sagt, was zurückkommt. void heißt: nichts.'],
    en: ['Return value', 'With return, a method hands a result back to the caller. The type before the method name says what comes back. void means nothing.'],
    code: 'public double getKontostand() {\n    return kontostand;\n}',
  },
  {
    id: 'kapselung', group: 'oop',
    de: ['Datenkapselung', 'Attribute sind private, damit niemand sie von außen falsch ändert. Lesen und Ändern geht nur über Methoden, die prüfen können, ob der Wert passt (Getter und Setter).'],
    en: ['Encapsulation', 'Fields are private so nobody changes them wrongly from outside. Reading and changing go through methods that can check the value (getters and setters).'],
    code: 'private int alter;\n\npublic void setAlter(int alter) {\n    if (alter >= 0) {\n        this.alter = alter;\n    }\n}',
  },
  {
    id: 'vererbung', group: 'oop',
    de: ['Vererbung', 'Mit extends übernimmt eine Unterklasse alles von ihrer Oberklasse und kann Neues ergänzen. Im Diagramm zeigt ein Pfeil mit leerer Spitze von der Unterklasse zur Oberklasse.'],
    en: ['Inheritance', 'With extends, a subclass takes over everything from its superclass and can add more. In the diagram, an arrow with a hollow head points from the subclass to the superclass.'],
    code: 'public class Hund extends Tier {\n    public Hund(String name) {\n        super(name);\n    }\n}',
  },
  {
    id: 'ueberschreiben', group: 'oop',
    de: ['Überschreiben', 'Eine Unterklasse kann eine geerbte Methode neu schreiben. @Override zeigt, dass das gewollt ist; der Compiler prüft dann, ob es die Methode oben wirklich gibt.'],
    en: ['Overriding', 'A subclass can rewrite an inherited method. @Override shows this is intended; the compiler then checks that the method really exists above.'],
    code: '@Override\npublic String gibLaut() {\n    return "Miau!";\n}',
  },
  {
    id: 'abstrakt', group: 'oop',
    de: ['Abstrakte Klasse', 'Eine abstrakte Klasse ist ein Bauplan für Unterklassen, von dem es selbst keine Objekte gibt. Abstrakte Methoden haben keinen Rumpf; jede Unterklasse muss sie schreiben.'],
    en: ['Abstract class', 'An abstract class is a blueprint for subclasses that has no objects of its own. Abstract methods have no body; every subclass must write them.'],
    code: 'public abstract class Tier {\n    public abstract String gibLaut();\n}',
  },
  {
    id: 'interface', group: 'oop',
    de: ['Interface', 'Ein Interface ist eine Liste von Methoden. Eine Klasse, die es mit implements einbindet, verspricht, alle diese Methoden zu haben. Eine Klasse kann mehrere Interfaces implementieren.'],
    en: ['Interface', 'An interface is a list of methods. A class that uses it with implements promises to have all of them. A class can implement several interfaces.'],
    code: 'public interface Form {\n    double flaeche();\n}\n\npublic class Kreis implements Form {\n    private double r;\n    public double flaeche() { return Math.PI * r * r; }\n}',
  },
  {
    id: 'polymorphie', group: 'oop',
    de: ['Polymorphie', 'Eine Variable vom Typ der Oberklasse kann Objekte jeder Unterklasse halten. Beim Aufruf läuft die Methode der echten Klasse des Objekts.'],
    en: ['Polymorphism', 'A variable of the superclass\'s type can hold objects of any subclass. A call runs the method of the object\'s real class.'],
    code: 'Tier t = new Katze("Minka");\nt.gibLaut(); // "Miau!", nicht die Methode von Tier',
  },
  {
    id: 'static', group: 'oop',
    de: ['static', 'Was static ist, gehört zur Klasse statt zu einem Objekt. Eine static-Methode wie main ruft man ohne Objekt auf. Darin gibt es kein this.'],
    en: ['static', 'What is static belongs to the class instead of an object. A static method such as main is called without an object. There is no this inside it.'],
    code: 'public class Rechner {\n    public static int quadrat(int x) {\n        return x * x;\n    }\n}\n// Aufruf: Rechner.quadrat(5)',
  },
  {
    id: 'datentypen', group: 'basics',
    de: ['Datentypen', 'Jede Variable hat einen Typ: int für ganze Zahlen, double für Kommazahlen, boolean für true/false, char für ein Zeichen, String für Text. Klassen sind ebenfalls Typen.'],
    en: ['Data types', 'Every variable has a type: int for whole numbers, double for decimals, boolean for true/false, char for one character, String for text. Classes are types too.'],
    code: 'int anzahl = 3;\ndouble preis = 2.49;\nboolean fertig = false;\nchar note = \'A\';\nString name = "Mia";',
  },
  {
    id: 'variablen', group: 'basics',
    de: ['Variable', 'Eine Variable ist ein benannter Speicherplatz. Sie wird mit Typ und Namen deklariert und bekommt mit = einen Wert. Lokale Variablen gibt es nur in ihrer Methode.'],
    en: ['Variable', 'A variable is a named storage place. It is declared with a type and a name and gets a value with =. Local variables only exist inside their method.'],
    code: 'int summe = 0;\nsumme = summe + 5;',
  },
  {
    id: 'strings', group: 'basics',
    de: ['Texte vergleichen', 'Texte (String) vergleicht man mit equals(). == prüft nur, ob es dasselbe Objekt ist, und liefert oft false, obwohl der Text gleich ist.'],
    en: ['Comparing texts', 'Compare texts (String) with equals(). == only checks whether it is the same object and often gives false although the text is the same.'],
    code: 'if (eingabe.equals("ja")) {\n    System.out.println("Okay!");\n}',
  },
  {
    id: 'array', group: 'basics',
    de: ['Array', 'Ein Array speichert eine feste Anzahl von Werten desselben Typs. Die Plätze sind ab 0 nummeriert; length sagt, wie viele es sind.'],
    en: ['Array', 'An array stores a fixed number of values of the same type. The places are numbered from 0; length says how many there are.'],
    code: 'int[] noten = {2, 1, 3};\nnoten[0] = 1;\nSystem.out.println(noten.length); // 3',
  },
  {
    id: 'arraylist', group: 'basics',
    de: ['ArrayList', 'Eine ArrayList ist eine Liste, die wachsen und schrumpfen kann. In spitzen Klammern steht, was hineinkommt.'],
    en: ['ArrayList', 'An ArrayList is a list that can grow and shrink. The angle brackets say what goes in.'],
    code: 'import java.util.ArrayList;\n\nArrayList<String> namen = new ArrayList<String>();\nnamen.add("Mia");\nnamen.get(0);   // "Mia"\nnamen.size();   // 1',
  },
  {
    id: 'if', group: 'flow',
    de: ['Verzweigung (if)', 'Mit if läuft ein Block nur, wenn die Bedingung true ist. else läuft sonst. Bedingungen verknüpft man mit && (und) und || (oder).'],
    en: ['Branching (if)', 'With if, a block only runs if the condition is true. else runs otherwise. Combine conditions with && (and) and || (or).'],
    code: 'if (alter >= 18) {\n    System.out.println("volljährig");\n} else {\n    System.out.println("minderjährig");\n}',
  },
  {
    id: 'schleifen', group: 'flow',
    de: ['Schleifen', 'for zählt, while wiederholt, solange eine Bedingung gilt, und for-each geht jedes Element einer Liste durch.'],
    en: ['Loops', 'for counts, while repeats as long as a condition holds, and for-each goes through every element of a list.'],
    code: 'for (int i = 0; i < 3; i++) {\n    System.out.println(i);\n}\n\nfor (Tier t : tiere) {\n    System.out.println(t.gibLaut());\n}',
  },
  {
    id: 'main', group: 'flow',
    de: ['main-Methode', 'Mit main startet ein Programm. In BlackJ startest du sie mit „main starten“ oder per Rechtsklick auf die Klasse. Ein- und Ausgaben siehst du in der Konsole.'],
    en: ['main method', 'A program starts with main. In BlackJ, start it with “Run main” or by right-clicking the class. Input and output appear in the console.'],
    code: 'public static void main(String[] args) {\n    System.out.println("Hallo!");\n}',
  },
  {
    id: 'scanner', group: 'flow',
    de: ['Eingabe mit Scanner', 'Ein Scanner liest, was in der Konsole eingegeben wird. Das Programm wartet dann, bis du etwas eingibst und Enter drückst.'],
    en: ['Input with Scanner', 'A Scanner reads what is typed into the console. The program then waits until you type something and press Enter.'],
    code: 'import java.util.Scanner;\n\nScanner sc = new Scanner(System.in);\nString name = sc.nextLine();\nint zahl = sc.nextInt();',
  },
  {
    id: 'exceptions', group: 'more',
    de: ['Exceptions', 'Eine Exception ist ein Fehler beim Ausführen, etwa wenn ein Objekt fehlt (null) oder durch 0 geteilt wird. BlackJ zeigt sie unter Probleme mit Erklärung und Zeile.'],
    en: ['Exceptions', 'An exception is an error while running, for example when an object is missing (null) or something is divided by 0. BlackJ shows them under Problems with an explanation and the line.'],
    code: 'try {\n    int x = Integer.parseInt(text);\n} catch (NumberFormatException e) {\n    System.out.println("Keine Zahl!");\n}',
  },
  {
    id: 'tostring', group: 'more',
    de: ['toString()', 'toString() gibt ein Objekt als Text zurück. Wenn du es überschreibst, zeigt BlackJ diesen Text auch auf der Objektbank.'],
    en: ['toString()', 'toString() returns an object as text. If you override it, BlackJ also shows that text on the object bench.'],
    code: '@Override\npublic String toString() {\n    return name + " (" + alter + " Jahre)";\n}',
  },
];
