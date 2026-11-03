// Plain-language explanations for exceptions thrown while the student's code runs.
const EX = {
  NullPointerException: {
    de: ['Ein Objekt fehlt (null)', 'Dein Code wollte etwas mit einem Objekt machen, aber die Variable zeigt auf kein Objekt: Sie ist null.', 'Prüf, ob die Variable mit new … ein Objekt bekommen hat, bevor du sie benutzt. Die Meldung sagt meist genau, welche Variable null war.'],
    en: ['An object is missing (null)', 'Your code tried to use an object, but the variable points to no object: it is null.', 'Check that the variable got an object with new … before you use it. The message usually names exactly which variable was null.'],
  },
  ArrayIndexOutOfBoundsException: {
    de: ['Index außerhalb des Arrays', 'Du hast auf eine Stelle im Array zugegriffen, die es nicht gibt. Ein Array der Länge n hat die Indizes 0 bis n-1.', 'Prüf die Schleifengrenze: i < array.length statt i <= array.length.'],
    en: ['Index outside the array', 'You accessed a position in the array that does not exist. An array of length n has indexes 0 to n-1.', 'Check the loop bound: i < array.length instead of i <= array.length.'],
  },
  IndexOutOfBoundsException: {
    de: ['Index außerhalb der Liste', 'Die Liste hat an dieser Stelle kein Element. Eine Liste mit n Elementen hat die Indizes 0 bis n-1.', 'Prüf mit liste.size(), wie viele Elemente es gibt, bevor du get(i) aufrufst.'],
    en: ['Index outside the list', 'The list has no element at this position. A list with n elements has indexes 0 to n-1.', 'Check with list.size() how many elements there are before calling get(i).'],
  },
  StringIndexOutOfBoundsException: {
    de: ['Index außerhalb des Textes', 'Du wolltest auf ein Zeichen zugreifen, das es im Text nicht gibt.', 'Ein Text hat die Indizes 0 bis text.length()-1. Prüf charAt und substring.'],
    en: ['Index outside the text', 'You tried to access a character that does not exist in the text.', 'A text has indexes 0 to text.length()-1. Check charAt and substring.'],
  },
  ArithmeticException: {
    de: ['Rechenfehler', 'Meist eine Division durch 0 mit ganzen Zahlen. Das ist in Java nicht erlaubt.', 'Prüf vorher mit if, ob der Teiler 0 ist.'],
    en: ['Arithmetic error', 'Usually a division by 0 with whole numbers. Java does not allow that.', 'Check with if whether the divisor is 0 first.'],
  },
  NumberFormatException: {
    de: ['Text ist keine Zahl', 'Integer.parseInt oder Double.parseDouble hat einen Text bekommen, der keine Zahl ist.', 'Prüf die Eingabe. Leerzeichen und Buchstaben machen die Umwandlung kaputt.'],
    en: ['Text is not a number', 'Integer.parseInt or Double.parseDouble got a text that is not a number.', 'Check the input. Spaces and letters break the conversion.'],
  },
  InputMismatchException: {
    de: ['Eingabe passt nicht', 'Der Scanner hat zum Beispiel nextInt() erwartet, aber du hast Text eingegeben.', 'Gib eine Zahl ein, oder lies mit nextLine() und wandle selbst um.'],
    en: ['Input does not fit', 'The Scanner expected for example nextInt(), but you typed text.', 'Enter a number, or read with nextLine() and convert it yourself.'],
  },
  NoSuchElementException: {
    de: ['Nichts mehr zu lesen', 'Der Scanner oder Iterator wollte das nächste Element lesen, aber es gibt keins mehr.', 'Prüf vorher mit hasNext() oder hasNextLine().'],
    en: ['Nothing left to read', 'The Scanner or iterator wanted the next element, but there is none left.', 'Check with hasNext() or hasNextLine() first.'],
  },
  ClassCastException: {
    de: ['Falsche Umwandlung', 'Ein Objekt wurde in eine Klasse umgewandelt (gecastet), zu der es nicht gehört.', 'Prüf vorher mit instanceof, welcher Klasse das Objekt angehört.'],
    en: ['Wrong cast', 'An object was cast to a class it does not belong to.', 'Check with instanceof which class the object belongs to first.'],
  },
  StackOverflowError: {
    de: ['Endlose Rekursion', 'Eine Methode ruft sich immer wieder selbst auf, ohne aufzuhören, bis der Speicher für Aufrufe voll ist.', 'Jede Rekursion braucht eine Abbruchbedingung, die irgendwann erreicht wird. Prüf auch Getter, die sich aus Versehen selbst aufrufen.'],
    en: ['Endless recursion', 'A method keeps calling itself without stopping until the call memory is full.', 'Every recursion needs a stopping condition that is eventually reached. Also check getters that call themselves by accident.'],
  },
  ConcurrentModificationException: {
    de: ['Liste beim Durchlaufen verändert', 'Du hast eine Liste verändert, während eine for-each-Schleife sie durchläuft.', 'Benutze einen Iterator mit remove() oder sammle die Änderungen und mach sie nach der Schleife.'],
    en: ['List changed while looping', 'You changed a list while a for-each loop was going through it.', 'Use an Iterator with remove(), or collect the changes and apply them after the loop.'],
  },
  IllegalArgumentException: {
    de: ['Ungültiger Parameter', 'Eine Methode hat einen Wert bekommen, mit dem sie nicht arbeiten kann.', 'Lies die Meldung: Sie sagt meist, welcher Wert falsch war.'],
    en: ['Invalid argument', 'A method got a value it cannot work with.', 'Read the message: it usually says which value was wrong.'],
  },
  IllegalStateException: {
    de: ['Falscher Zeitpunkt', 'Die Methode wurde aufgerufen, als das Objekt nicht im passenden Zustand war.', 'Lies die Meldung und prüf, was vorher passiert sein muss.'],
    en: ['Wrong moment', 'The method was called when the object was not in the right state.', 'Read the message and check what has to happen first.'],
  },
  OutOfMemoryError: {
    de: ['Speicher voll', 'Dein Programm hat zu viele oder zu große Objekte erzeugt, oft in einer Endlosschleife.', 'Prüf Schleifen, die immer neue Objekte in eine Liste legen.'],
    en: ['Out of memory', 'Your program created too many or too large objects, often in an endless loop.', 'Check loops that keep adding new objects to a list.'],
  },
};

const FALLBACK = {
  de: ['Fehler beim Ausführen', 'Beim Ausführen ist eine Exception aufgetreten.', 'Lies die Meldung und spring zur genannten Zeile, oder frag den Tutor.'],
  en: ['Error while running', 'An exception occurred while running.', 'Read the message and jump to the line, or ask the tutor.'],
};

export function explainException(simpleType, lang) {
  const e = EX[simpleType];
  const [title, explain, fix] = e ? e[lang] || e.de : FALLBACK[lang] || FALLBACK.de;
  return { title, explain, fix };
}
