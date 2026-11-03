import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import medien.Buch;
import medien.Film;

/**
 * Testklasse für Bibliothek. Starte die Tests mit Rechtsklick → "Tests ausführen".
 */
public class BibliothekTest {
    private Bibliothek bib;

    @BeforeEach
    public void setUp() {
        bib = new Bibliothek();
        bib.aufnehmen(new Buch("Momo", "Michael Ende", 304));
        bib.aufnehmen(new Film("Die Welle", 107));
    }

    @Test
    public void anzahlZaehltAlleMedien() {
        assertEquals(2, bib.anzahl());
    }

    @Test
    public void ausleihenVerringertVerfuegbare() {
        bib.suche("Momo").ausleihen();
        assertEquals(1, bib.verfuegbar());
    }

    @Test
    public void suchenFindetNichtsBeiFalschemTitel() {
        assertNull(bib.suche("Harry Potter"));
    }

    @Test
    public void filmeDarfManEineWocheBehalten() {
        assertEquals(7, new Film("Test", 90).leihdauerTage());
    }
}
