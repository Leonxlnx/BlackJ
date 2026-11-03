import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

/**
 * Prüft die Klasse Rechner. Lass die Tests laufen, bis alle grün sind.
 */
public class RechnerTest {
    private final Rechner r = new Rechner();

    @Test
    public void summeBis() {
        assertEquals(10, r.summeBis(4), "summeBis(4) = 1+2+3+4");
        assertEquals(1, r.summeBis(1), "summeBis(1)");
        assertEquals(5050, r.summeBis(100), "summeBis(100)");
    }

    @Test
    public void fakultaet() {
        assertEquals(1, r.fakultaet(0), "fakultaet(0) ist 1");
        assertEquals(120, r.fakultaet(5), "fakultaet(5) = 1*2*3*4*5");
        assertEquals(3628800, r.fakultaet(10), "fakultaet(10)");
    }

    @Test
    public void primzahlen() {
        assertTrue(r.istPrimzahl(2), "2 ist eine Primzahl");
        assertTrue(r.istPrimzahl(13), "13 ist eine Primzahl");
        assertTrue(r.istPrimzahl(97), "97 ist eine Primzahl");
    }

    @Test
    public void keinePrimzahlen() {
        assertFalse(r.istPrimzahl(1), "1 ist keine Primzahl");
        assertFalse(r.istPrimzahl(9), "9 = 3 * 3");
        assertFalse(r.istPrimzahl(100), "100 ist gerade");
    }
}
