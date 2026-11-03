import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Prüft die Klasse Schulklasse. Lass die Tests laufen, bis alle grün sind.
 */
public class SchulklasseTest {
    private Schulklasse klasse;
    private Schueler mia;
    private Schueler ben;

    @BeforeEach
    public void setUp() {
        klasse = new Schulklasse("10b");
        mia = new Schueler("Mia", 2);
        ben = new Schueler("Ben", 1);
    }

    @Test
    public void neueKlasseIstLeer() {
        assertEquals(0, klasse.anzahl());
        assertEquals(0, klasse.besteNote(), "besteNote() einer leeren Klasse");
    }

    @Test
    public void aufnehmenZaehlt() {
        klasse.aufnehmen(mia);
        klasse.aufnehmen(ben);
        assertEquals(2, klasse.anzahl());
    }

    @Test
    public void besteNoteIstDieKleinste() {
        klasse.aufnehmen(mia);
        klasse.aufnehmen(ben);
        assertEquals(1, klasse.besteNote());
    }

    @Test
    public void sucheFindetPerName() {
        klasse.aufnehmen(mia);
        klasse.aufnehmen(ben);
        assertSame(ben, klasse.suche(new String("Ben")), "Namen mit equals vergleichen");
        assertNull(klasse.suche("Zoe"), "unbekannter Name liefert null");
    }
}
