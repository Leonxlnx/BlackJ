import medien.Buch;
import medien.Film;

/**
 * Das Hauptprogramm der Bibliothek. Starte es mit "main starten".
 */
public class Start {
    public static void main(String[] args) {
        Bibliothek bib = new Bibliothek();
        bib.aufnehmen(new Buch("Momo", "Michael Ende", 304));
        bib.aufnehmen(new Buch("Krabat", "Otfried Preußler", 280));
        bib.aufnehmen(new Film("Die Welle", 107));

        bib.suche("Momo").ausleihen();
        System.out.println(bib.anzahl() + " Medien, davon " + bib.verfuegbar() + " verfügbar.");
    }
}
