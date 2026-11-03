// Starting code for "New class", with comments that explain each part (German or English).
const T = {
  de: {
    class: (n) => `/**
 * Beschreibe hier, wofür die Klasse ${n} da ist.
 */
public class ${n} {
    // Attribute: Was sich ein ${n}-Objekt merkt
    private int wert;

    /**
     * Konstruktor: Läuft bei "new ${n}()" und setzt die Startwerte.
     */
    public ${n}() {
        wert = 0;
    }

    /**
     * Eine Beispielmethode. Ersetze sie durch deine eigene.
     * @param zahl eine Zahl, die addiert wird
     * @return der neue Wert
     */
    public int addiere(int zahl) {
        wert = wert + zahl;
        return wert;
    }
}
`,
    empty: (n) => `public class ${n} {

}
`,
    abstract: (n) => `/**
 * ${n} ist abstrakt: Es gibt keine Objekte davon, nur von Unterklassen.
 */
public abstract class ${n} {
    protected String name;

    public ${n}(String name) {
        this.name = name;
    }

    /** Jede Unterklasse muss diese Methode selbst schreiben. */
    public abstract String beschreibung();
}
`,
    interface: (n) => `/**
 * Ein Interface listet Methoden, die eine Klasse haben muss,
 * wenn sie "implements ${n}" schreibt.
 */
public interface ${n} {
    /** Beispiel: Jede Klasse, die ${n} implementiert, braucht diese Methode. */
    String beschreibung();
}
`,
    enum: (n) => `/**
 * Ein Aufzählungstyp mit festen Werten.
 */
public enum ${n} {
    ERSTER_WERT,
    ZWEITER_WERT,
    DRITTER_WERT
}
`,
    main: (n) => `import java.util.Scanner;

/**
 * Ein Programm. Starte es mit "main starten".
 */
public class ${n} {
    public static void main(String[] args) {
        Scanner eingabe = new Scanner(System.in);
        System.out.print("Wie heißt du? ");
        String name = eingabe.nextLine();
        System.out.println("Hallo, " + name + "!");
    }
}
`,
  },
  en: {
    class: (n) => `/**
 * Describe here what the class ${n} is for.
 */
public class ${n} {
    // Fields: what a ${n} object remembers
    private int value;

    /**
     * Constructor: runs on "new ${n}()" and sets the starting values.
     */
    public ${n}() {
        value = 0;
    }

    /**
     * An example method. Replace it with your own.
     * @param number a number that is added
     * @return the new value
     */
    public int add(int number) {
        value = value + number;
        return value;
    }
}
`,
    empty: (n) => `public class ${n} {

}
`,
    abstract: (n) => `/**
 * ${n} is abstract: there are no objects of it, only of subclasses.
 */
public abstract class ${n} {
    protected String name;

    public ${n}(String name) {
        this.name = name;
    }

    /** Every subclass has to write this method itself. */
    public abstract String describe();
}
`,
    interface: (n) => `/**
 * An interface lists methods a class must have
 * when it says "implements ${n}".
 */
public interface ${n} {
    /** Example: every class implementing ${n} needs this method. */
    String describe();
}
`,
    enum: (n) => `/**
 * An enumeration type with fixed values.
 */
public enum ${n} {
    FIRST_VALUE,
    SECOND_VALUE,
    THIRD_VALUE
}
`,
    main: (n) => `import java.util.Scanner;

/**
 * A program. Start it with "Run main".
 */
public class ${n} {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        System.out.print("What is your name? ");
        String name = input.nextLine();
        System.out.println("Hello, " + name + "!");
    }
}
`,
  },
};

export function template(lang, kind, name) {
  const set = T[lang] || T.de;
  return (set[kind] || set.class)(name);
}
