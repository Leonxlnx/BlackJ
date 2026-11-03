import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

/**
 * Prüft die Klasse Statistik. Lass die Tests laufen, bis alle grün sind.
 */
public class StatistikTest {
    private final Statistik s = new Statistik();

    @Test
    public void maximum() {
        assertEquals(5, s.maximum(new int[] { 2, 5, 1 }));
        assertEquals(7, s.maximum(new int[] { 7 }));
        assertEquals(-1, s.maximum(new int[] { -3, -1, -2 }), "auch mit negativen Zahlen");
    }

    @Test
    public void durchschnitt() {
        assertEquals(2.0, s.durchschnitt(new int[] { 1, 2, 3 }), 0.0001);
        assertEquals(2.5, s.durchschnitt(new int[] { 2, 3 }), 0.0001, "nicht ganzzahlig teilen");
        assertEquals(0.0, s.durchschnitt(new int[0]), 0.0001, "leeres Array");
    }

    @Test
    public void anzahlUeber() {
        assertEquals(2, s.anzahlUeber(new int[] { 1, 4, 2, 5 }, 3));
        assertEquals(0, s.anzahlUeber(new int[] { 1, 2 }, 2), "gleich groß zählt nicht");
    }
}
