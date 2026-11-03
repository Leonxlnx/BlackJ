// Plain-language explanations for exceptions thrown while the student's code runs.
// Each entry: title / why it happens / one short thing to do.
const EX = {
  NullPointerException: {
    de: ['Ein Objekt fehlt (null)', 'Dein Code wollte etwas mit einem Objekt machen, aber die Variable zeigt auf kein Objekt: Sie ist null. Die Meldung sagt meist genau, welche Variable null war.', 'Gib der Variable mit new ein Objekt, bevor du sie benutzt.'],
    en: ['An object is missing (null)', 'Your code tried to use an object, but the variable points to no object: it is null. The message usually names exactly which variable was null.', 'Give the variable an object with new before you use it.'],
  },
  ArrayIndexOutOfBoundsException: {
    de: ['Index außerhalb des Arrays', 'Du hast auf eine Stelle im Array zugegriffen, die es nicht gibt. Ein Array der Länge n hat die Indizes 0 bis n-1.', 'Schreib in der Schleife i < array.length statt i <= array.length.'],
    en: ['Index outside the array', 'You accessed a position in the array that does not exist. An array of length n has indexes 0 to n-1.', 'Use i < array.length instead of i <= array.length in the loop.'],
  },
  IndexOutOfBoundsException: {
    de: ['Index außerhalb der Liste', 'Die Liste hat an dieser Stelle kein Element. Eine Liste mit n Elementen hat die Indizes 0 bis n-1.', 'Prüf mit liste.size(), bevor du get(i) aufrufst.'],
    en: ['Index outside the list', 'The list has no element at this position. A list with n elements has indexes 0 to n-1.', 'Check list.size() before calling get(i).'],
  },
  StringIndexOutOfBoundsException: {
    de: ['Index außerhalb des Textes', 'Du wolltest auf ein Zeichen zugreifen, das es im Text nicht gibt. Ein Text hat die Indizes 0 bis text.length()-1.', 'Prüf die Indizes bei charAt und substring.'],
    en: ['Index outside the text', 'You tried to access a character that does not exist in the text. A text has indexes 0 to text.length()-1.', 'Check the indexes in charAt and substring.'],
  },
  ArithmeticException: {
    de: ['Rechenfehler', 'Meist eine Division durch 0 mit ganzen Zahlen. Das ist in Java nicht erlaubt.', 'Prüf vorher mit if, ob der Teiler 0 ist.'],
    en: ['Arithmetic error', 'Usually a division by 0 with whole numbers. Java does not allow that.', 'Check with if whether the divisor is 0 first.'],
  },
  NumberFormatException: {
    de: ['Text ist keine Zahl', 'Integer.parseInt oder Double.parseDouble hat einen Text bekommen, der keine Zahl ist. Leerzeichen und Buchstaben machen die Umwandlung kaputt.', 'Prüf die Eingabe auf Leerzeichen und Buchstaben.'],
    en: ['Text is not a number', 'Integer.parseInt or Double.parseDouble got a text that is not a number. Spaces and letters break the conversion.', 'Check the input for spaces and letters.'],
  },
  InputMismatchException: {
    de: ['Eingabe passt nicht', 'Der Scanner hat zum Beispiel nextInt() erwartet, aber du hast Text eingegeben.', 'Gib eine Zahl ein, oder lies mit nextLine().'],
    en: ['Input does not fit', 'The Scanner expected for example nextInt(), but you typed text.', 'Enter a number, or read with nextLine().'],
  },
  NoSuchElementException: {
    de: ['Nichts mehr zu lesen', 'Der Scanner oder Iterator wollte das nächste Element lesen, aber es gibt keins mehr.', 'Prüf vorher mit hasNext() oder hasNextLine().'],
    en: ['Nothing left to read', 'The Scanner or iterator wanted the next element, but there is none left.', 'Check with hasNext() or hasNextLine() first.'],
  },
  ClassCastException: {
    de: ['Falsche Umwandlung', 'Ein Objekt wurde in eine Klasse umgewandelt (gecastet), zu der es nicht gehört.', 'Prüf vorher mit instanceof, zu welcher Klasse das Objekt gehört.'],
    en: ['Wrong cast', 'An object was cast to a class it does not belong to.', 'Check with instanceof which class the object belongs to first.'],
  },
  StackOverflowError: {
    de: ['Endlose Rekursion', 'Eine Methode ruft sich immer wieder selbst auf, bis der Speicher für Aufrufe voll ist. Oft ist es ein Getter, der sich aus Versehen selbst aufruft.', 'Gib der Rekursion eine Abbruchbedingung, die erreicht wird.'],
    en: ['Endless recursion', 'A method keeps calling itself until the call memory is full. Often it is a getter that calls itself by accident.', 'Give the recursion a stopping condition that is reached.'],
  },
  ConcurrentModificationException: {
    de: ['Liste beim Durchlaufen verändert', 'Du hast eine Liste verändert, während eine for-each-Schleife sie durchläuft. Mit einem Iterator und remove() geht es auch in der Schleife.', 'Ändere die Liste erst nach der Schleife.'],
    en: ['List changed while looping', 'You changed a list while a for-each loop was going through it. An Iterator with remove() also works inside the loop.', 'Change the list after the loop.'],
  },
  IllegalArgumentException: {
    de: ['Ungültiger Parameter', 'Eine Methode hat einen Wert bekommen, mit dem sie nicht arbeiten kann.', 'Lies in der Meldung, welcher Wert falsch war.'],
    en: ['Invalid argument', 'A method got a value it cannot work with.', 'Read in the message which value was wrong.'],
  },
  IllegalStateException: {
    de: ['Falscher Zeitpunkt', 'Die Methode wurde aufgerufen, als das Objekt nicht im passenden Zustand war.', 'Prüf, was vor diesem Aufruf passiert sein muss.'],
    en: ['Wrong moment', 'The method was called when the object was not in the right state.', 'Check what has to happen before this call.'],
  },
  OutOfMemoryError: {
    de: ['Speicher voll', 'Dein Programm hat zu viele oder zu große Objekte erzeugt, oft in einer Endlosschleife.', 'Prüf Schleifen, die immer neue Objekte anlegen.'],
    en: ['Out of memory', 'Your program created too many or too large objects, often in an endless loop.', 'Check loops that keep creating new objects.'],
  },
};

const FALLBACK = {
  de: ['Fehler beim Ausführen', 'Beim Ausführen ist eine Exception aufgetreten.', 'Spring zur genannten Zeile, oder frag den Tutor.'],
  en: ['Error while running', 'An exception occurred while running.', 'Jump to the line, or ask the tutor.'],
};

export function explainException(simpleType, lang) {
  const e = EX[simpleType];
  const [title, explain, fix] = e ? e[lang] || e.de : FALLBACK[lang] || FALLBACK.de;
  return { title, explain, fix };
}
