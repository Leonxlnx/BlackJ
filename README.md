<p align="center"><img src="resources/icon.png" width="96" alt="BlackJ"></p>

<h1 align="center">BlackJ</h1>

<p align="center">Java lernen wie mit BlueJ, nur moderner: Klassendiagramm, Objekte live ausprobieren,<br>verständliche Fehlermeldungen und ein KI-Tutor mit deinem eigenen Claude-API-Schlüssel.</p>

<p align="center"><a href="../../releases/latest"><b>⬇ BlackJ.exe herunterladen</b></a> · Windows · keine Installation nötig · läuft auch vom USB-Stick</p>

---

## Was BlackJ kann

**Wie BlueJ**
- Klassendiagramm mit Vererbung (`extends`, `implements`) und Benutzt-Pfeilen, Pakete als Ordner zum Hineinklicken, README-Notiz
- Objekte erzeugen (Rechtsklick → `new …`), Methoden aufrufen, Rückgabewerte ansehen, Objekte als Parameter übergeben
- Objekte inspizieren, auch private und geerbte Attribute, Klassenvariablen (static)
- Code Pad: Java eintippen, Wert sehen, Variablen bleiben erhalten
- Konsole mit Eingabe (`Scanner`), `main` starten, Programm stoppen
- Debugger: Haltepunkte, Schritt / Hinein / Heraus, Aufrufstapel und Variablen
- JUnit 4 und 5: Tests ausführen, Ergebnis je Test, **Testmethode aufzeichnen** wie in BlueJ
- Quelltext / Dokumentation umschalten (aus den Javadoc-Kommentaren), farbige Blöcke (Scope-Highlighting)
- Als JAR exportieren
- **BlueJ-Projekte öffnen sich direkt** – inklusive Paketen, `+libs`-Bibliotheken und Positionen aus `package.bluej`. BlackJ verändert die `package.bluej`-Dateien nicht.

**Und mehr**
- Moderner Editor (Monaco, der Editor aus VS Code) mit Autovervollständigung für eigene Klassen, Snippets (`sout`, `fori`, `get`, `set`, `test`) und Erklärungen beim Überfahren von Schlüsselwörtern
- Jeder Compilerfehler und jede Exception wird auf Deutsch erklärt, mit Tipp zur Lösung
- Live-Inspektor neben dem Code, Objektkarten zeigen ihre Attributwerte
- Befehlspalette (`Strg+P`) für Klassen, Methoden, Befehle und Lernbegriffe
- Lernen-Seite mit den wichtigsten OOP-Begriffen und Beispielen
- Dunkles und helles Design, Deutsch und Englisch

**KI (optional, mit eigenem API-Schlüssel)**
- KI-Tutor im Modus *Tipps* (hilft dir, selbst auf die Lösung zu kommen) oder *Erklären*
- KI-Vorschläge beim Tippen (grauer Text, `Tab` übernimmt)
- `Strg+I`: „Mit KI schreiben“ – Änderung erscheint als Vergleich, du entscheidest
- „Mit KI beheben“ bei Compilerfehlern
- Der Schlüssel bleibt auf deinem PC (verschlüsselt oder nur für die Sitzung). Fragen und Code gehen an Anthropic.

## Benutzen

1. [`BlackJ.exe` herunterladen](../../releases/latest) und starten. Windows fragt beim ersten Start evtl. nach („Unbekannter Herausgeber“ → *Weitere Informationen* → *Trotzdem ausführen*), weil die Datei nicht signiert ist.
2. Java: BlackJ findet ein installiertes JDK ab Version 11 automatisch, auch das von BlueJ. Für den USB-Stick einen Ordner `jdk` neben `BlackJ.exe` legen (zum Beispiel den `jdk`-Ordner aus einer BlueJ-Installation).
3. Einstellungen und Projekte liegen neben der App (`BlackJ-Daten`, `Projekte`), nicht auf C:.

| Taste | Aktion |
| --- | --- |
| `Strg+K` | Kompilieren |
| `F5` | `main` starten |
| `Strg+P` | Suchen / Befehle |
| `Strg+N` | Neue Klasse |
| `Strg+I` | Mit KI schreiben |
| `F9` | Haltepunkt |
| `F8` / `F10` / `F11` | Weiter / Schritt / Hinein |
| `Strg+S` | Speichern |

## Selbst bauen

Voraussetzungen: Node.js 22, ein JDK ab 11.

```
npm install
npm run fetch:junit   # lädt die JUnit-Jars von Maven Central
npm start             # baut alles und startet BlackJ
npm test              # Compiler, Objektbank, Code Pad, KI, JUnit, Debugger
npm run dist          # baut BlackJ.exe (portable)
```

`electron . --smoke=<ordner>` fährt einen kompletten Testlauf durch die echte App und speichert Screenshots.

**Aufbau:** `electron/` (Fenster, Projekte, javac, Objektbank, Debugger, JUnit, KI) · `java/` (läuft in einer eigenen JVM: Objektbank und Code Pad per Reflection, Debugger per JDI) · `src/` (Oberfläche, React + Monaco) · `resources/examples` (Beispielprojekte).

BlackJ zeichnet ohne Grafikkarte, und Programme der Schüler laufen mit abgeschaltetem Direct3D – das schützt vor abstürzenden Grafiktreibern.

---

### English

BlackJ is a BlueJ-style Java IDE for school: class diagram, interactive object bench, code pad, debugger, JUnit with test recording, plain-language error explanations, and an optional AI tutor that uses your own Claude API key. It opens BlueJ projects as they are. Download `BlackJ.exe` from the [latest release](../../releases/latest); the interface is available in German and English.

BlackJ is an independent project and not affiliated with the BlueJ team. [MIT License](LICENSE). JUnit jars are redistributed under their own licences (see `resources/junit/LICENSES.txt`).
