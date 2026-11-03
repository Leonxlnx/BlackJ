// Short explanations for the library methods students use most, shown in code completion and on hover.
// Key: "Class.method"; value: [German, English].
export const JDK_DOCS = {
  'String.length': ['Anzahl der Zeichen im Text.', 'Number of characters in the text.'],
  'String.charAt': ['Das Zeichen an Position index. Die Zählung beginnt bei 0.', 'The character at position index. Counting starts at 0.'],
  'String.substring': ['Ein Teil des Textes: von beginIndex bis vor endIndex.', 'Part of the text: from beginIndex up to (not including) endIndex.'],
  'String.indexOf': ['Position, an der das Gesuchte zuerst vorkommt, sonst -1.', 'Position of the first occurrence, or -1.'],
  'String.lastIndexOf': ['Position, an der das Gesuchte zuletzt vorkommt, sonst -1.', 'Position of the last occurrence, or -1.'],
  'String.equals': ['true, wenn beide Texte genau gleich sind. Texte immer mit equals vergleichen, nicht mit ==.', 'true if both texts are exactly equal. Always compare texts with equals, not ==.'],
  'String.equalsIgnoreCase': ['Wie equals, aber Groß- und Kleinschreibung zählt nicht.', 'Like equals, but ignores upper and lower case.'],
  'String.compareTo': ['Vergleicht alphabetisch: negativ = davor, 0 = gleich, positiv = danach.', 'Compares alphabetically: negative = before, 0 = equal, positive = after.'],
  'String.toUpperCase': ['Der Text in Großbuchstaben (der Originaltext bleibt gleich).', 'The text in upper case (the original stays the same).'],
  'String.toLowerCase': ['Der Text in Kleinbuchstaben (der Originaltext bleibt gleich).', 'The text in lower case (the original stays the same).'],
  'String.trim': ['Der Text ohne Leerzeichen am Anfang und Ende.', 'The text without spaces at the start and end.'],
  'String.strip': ['Der Text ohne Leerraum am Anfang und Ende.', 'The text without whitespace at the start and end.'],
  'String.isEmpty': ['true, wenn der Text keine Zeichen hat ("").', 'true if the text has no characters ("").'],
  'String.isBlank': ['true, wenn der Text leer ist oder nur Leerzeichen hat.', 'true if the text is empty or only spaces.'],
  'String.contains': ['true, wenn der Text das Gesuchte enthält.', 'true if the text contains the given part.'],
  'String.startsWith': ['true, wenn der Text so anfängt.', 'true if the text starts like this.'],
  'String.endsWith': ['true, wenn der Text so endet.', 'true if the text ends like this.'],
  'String.replace': ['Ein neuer Text, in dem jedes Vorkommen ersetzt ist.', 'A new text with every occurrence replaced.'],
  'String.split': ['Zerlegt den Text an jeder Trennstelle in ein Array.', 'Splits the text at each separator into an array.'],
  'String.toCharArray': ['Alle Zeichen als char-Array.', 'All characters as a char array.'],
  'String.valueOf': ['Macht aus einem Wert (Zahl, Zeichen, Objekt) einen Text.', 'Turns a value (number, character, object) into text.'],
  'String.format': ['Baut einen Text aus einer Vorlage, z. B. String.format("%.2f", x).', 'Builds text from a template, e.g. String.format("%.2f", x).'],
  'String.repeat': ['Der Text count-mal hintereinander.', 'The text repeated count times.'],

  'StringBuilder.append': ['Hängt etwas hinten an und gibt denselben StringBuilder zurück.', 'Appends something and returns the same StringBuilder.'],
  'StringBuilder.insert': ['Fügt an Position offset etwas ein.', 'Inserts something at position offset.'],
  'StringBuilder.reverse': ['Dreht die Zeichenfolge um.', 'Reverses the characters.'],
  'StringBuilder.deleteCharAt': ['Entfernt das Zeichen an Position index.', 'Removes the character at position index.'],
  'StringBuilder.length': ['Anzahl der Zeichen.', 'Number of characters.'],
  'StringBuilder.toString': ['Der fertige Text als String.', 'The finished text as a String.'],

  'Math.max': ['Die größere der beiden Zahlen.', 'The larger of the two numbers.'],
  'Math.min': ['Die kleinere der beiden Zahlen.', 'The smaller of the two numbers.'],
  'Math.abs': ['Der Betrag: die Zahl ohne Minuszeichen.', 'The absolute value: the number without its minus sign.'],
  'Math.sqrt': ['Die Quadratwurzel.', 'The square root.'],
  'Math.pow': ['a hoch b.', 'a to the power of b.'],
  'Math.random': ['Eine Zufallszahl von 0.0 (inklusive) bis 1.0 (exklusive).', 'A random number from 0.0 (inclusive) to 1.0 (exclusive).'],
  'Math.round': ['Kaufmännisch gerundet auf eine ganze Zahl.', 'Rounded to the nearest whole number.'],
  'Math.floor': ['Abgerundet (zur nächstkleineren ganzen Zahl).', 'Rounded down.'],
  'Math.ceil': ['Aufgerundet (zur nächstgrößeren ganzen Zahl).', 'Rounded up.'],
  'Math.PI': ['Die Kreiszahl π ≈ 3.14159.', 'The number π ≈ 3.14159.'],

  'Integer.parseInt': ['Wandelt einen Text wie "42" in eine int-Zahl um.', 'Turns a text like "42" into an int.'],
  'Integer.valueOf': ['Wandelt Text oder int in ein Integer-Objekt um.', 'Turns text or an int into an Integer object.'],
  'Integer.toString': ['Die Zahl als Text.', 'The number as text.'],
  'Integer.MAX_VALUE': ['Die größte int-Zahl: 2147483647.', 'The largest int: 2147483647.'],
  'Integer.MIN_VALUE': ['Die kleinste int-Zahl: -2147483648.', 'The smallest int: -2147483648.'],
  'Double.parseDouble': ['Wandelt einen Text wie "3.5" in eine double-Zahl um.', 'Turns a text like "3.5" into a double.'],
  'Character.isDigit': ['true, wenn das Zeichen eine Ziffer ist.', 'true if the character is a digit.'],
  'Character.isLetter': ['true, wenn das Zeichen ein Buchstabe ist.', 'true if the character is a letter.'],
  'Character.isUpperCase': ['true, wenn das Zeichen ein Großbuchstabe ist.', 'true if the character is upper case.'],
  'Character.toUpperCase': ['Das Zeichen als Großbuchstabe.', 'The character in upper case.'],

  'List.add': ['Hängt ein Element hinten an (oder fügt es an Position index ein).', 'Adds an element at the end (or inserts it at position index).'],
  'List.get': ['Das Element an Position index. Die Zählung beginnt bei 0.', 'The element at position index. Counting starts at 0.'],
  'List.set': ['Ersetzt das Element an Position index.', 'Replaces the element at position index.'],
  'List.remove': ['Entfernt das Element an Position index oder das genannte Objekt.', 'Removes the element at position index, or the given object.'],
  'List.size': ['Anzahl der Elemente in der Liste.', 'Number of elements in the list.'],
  'List.isEmpty': ['true, wenn die Liste keine Elemente hat.', 'true if the list has no elements.'],
  'List.contains': ['true, wenn die Liste das Objekt enthält (Vergleich mit equals).', 'true if the list contains the object (compared with equals).'],
  'List.indexOf': ['Position des Objekts in der Liste, sonst -1.', 'Position of the object in the list, or -1.'],
  'List.clear': ['Entfernt alle Elemente.', 'Removes all elements.'],

  'Map.put': ['Speichert einen Wert unter einem Schlüssel (ersetzt einen alten Wert).', 'Stores a value under a key (replacing an old value).'],
  'Map.get': ['Der Wert zum Schlüssel, oder null, wenn es keinen gibt.', 'The value for the key, or null if there is none.'],
  'Map.getOrDefault': ['Der Wert zum Schlüssel, sonst der Ersatzwert.', 'The value for the key, otherwise the default.'],
  'Map.containsKey': ['true, wenn es den Schlüssel gibt.', 'true if the key exists.'],
  'Map.remove': ['Entfernt den Eintrag mit diesem Schlüssel.', 'Removes the entry with this key.'],
  'Map.size': ['Anzahl der Einträge.', 'Number of entries.'],
  'Map.keySet': ['Alle Schlüssel, z. B. für eine for-each-Schleife.', 'All keys, e.g. for a for-each loop.'],
  'Map.values': ['Alle Werte.', 'All values.'],

  'Set.add': ['Fügt ein Element hinzu; Doppelte gibt es in einem Set nicht.', 'Adds an element; a set has no duplicates.'],
  'Set.contains': ['true, wenn das Element im Set ist.', 'true if the element is in the set.'],
  'Set.size': ['Anzahl der Elemente.', 'Number of elements.'],

  'Scanner.nextInt': ['Liest die nächste ganze Zahl von der Eingabe.', 'Reads the next whole number from the input.'],
  'Scanner.nextDouble': ['Liest die nächste Kommazahl von der Eingabe.', 'Reads the next decimal number from the input.'],
  'Scanner.nextLine': ['Liest den Rest der Zeile als Text.', 'Reads the rest of the line as text.'],
  'Scanner.next': ['Liest das nächste Wort.', 'Reads the next word.'],
  'Scanner.hasNextInt': ['true, wenn als Nächstes eine ganze Zahl kommt.', 'true if the next input is a whole number.'],
  'Scanner.hasNextLine': ['true, wenn noch eine Zeile kommt.', 'true if there is another line.'],
  'Scanner.close': ['Schließt den Scanner.', 'Closes the scanner.'],

  'Random.nextInt': ['Eine zufällige ganze Zahl; nextInt(n) liefert 0 bis n-1.', 'A random whole number; nextInt(n) gives 0 to n-1.'],
  'Random.nextDouble': ['Eine Zufallszahl von 0.0 bis unter 1.0.', 'A random number from 0.0 to below 1.0.'],
  'Random.nextBoolean': ['Zufällig true oder false.', 'Randomly true or false.'],

  'PrintStream.println': ['Gibt den Wert aus und beginnt danach eine neue Zeile.', 'Prints the value, then starts a new line.'],
  'PrintStream.print': ['Gibt den Wert aus, ohne neue Zeile.', 'Prints the value without a new line.'],
  'PrintStream.printf': ['Formatierte Ausgabe, z. B. printf("%d Punkte%n", p).', 'Formatted output, e.g. printf("%d points%n", p).'],

  'System.currentTimeMillis': ['Die aktuelle Zeit in Millisekunden, gut zum Zeitmessen.', 'The current time in milliseconds, handy for timing.'],
  'System.exit': ['Beendet das Programm sofort.', 'Ends the program immediately.'],
  'System.out': ['Die Konsolenausgabe: System.out.println(…).', 'The console output: System.out.println(…).'],
  'System.in': ['Die Tastatureingabe, z. B. für new Scanner(System.in).', 'The keyboard input, e.g. for new Scanner(System.in).'],

  'Arrays.toString': ['Das Array als lesbarer Text, z. B. [1, 2, 3].', 'The array as readable text, e.g. [1, 2, 3].'],
  'Arrays.sort': ['Sortiert das Array aufsteigend.', 'Sorts the array in ascending order.'],
  'Arrays.fill': ['Setzt jedes Element auf denselben Wert.', 'Sets every element to the same value.'],
  'Arrays.copyOf': ['Eine Kopie des Arrays mit neuer Länge.', 'A copy of the array with a new length.'],
  'Arrays.asList': ['Die Werte als Liste.', 'The values as a list.'],
  'Collections.sort': ['Sortiert die Liste aufsteigend.', 'Sorts the list in ascending order.'],
  'Collections.shuffle': ['Mischt die Liste zufällig.', 'Shuffles the list randomly.'],
  'Collections.max': ['Das größte Element.', 'The largest element.'],
  'Collections.min': ['Das kleinste Element.', 'The smallest element.'],

  'Object.equals': ['true, wenn beide Objekte als gleich gelten.', 'true if both objects count as equal.'],
  'Object.toString': ['Das Objekt als Text.', 'The object as text.'],
  'Object.hashCode': ['Eine Zahl, die das Objekt für HashMap und HashSet einordnet.', 'A number that files the object for HashMap and HashSet.'],
};

// Lists and sets share their explanations with the interfaces they implement.
const SHARED = { ArrayList: 'List', LinkedList: 'List', HashMap: 'Map', HashSet: 'Set' };

export function jdkDoc(cls, member, lang) {
  const hit = JDK_DOCS[cls + '.' + member] || (SHARED[cls] && JDK_DOCS[SHARED[cls] + '.' + member]) || JDK_DOCS['Object.' + member];
  return hit ? hit[lang === 'en' ? 1 : 0] : null;
}
