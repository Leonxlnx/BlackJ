import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

/**
 * Prüft die Klasse Punkt. Lass die Tests laufen, bis alle grün sind.
 */
public class PunktTest {

    @Test
    public void konstruktorSpeichertKoordinaten() {
        Punkt p = new Punkt(3, 4);
        assertEquals(3, p.getX(), "getX() nach new Punkt(3, 4)");
        assertEquals(4, p.getY(), "getY() nach new Punkt(3, 4)");
    }

    @Test
    public void verschiebenAendertBeideKoordinaten() {
        Punkt p = new Punkt(1, 1);
        p.verschieben(2, -3);
        assertEquals(3, p.getX(), "x nach verschieben(2, -3)");
        assertEquals(-2, p.getY(), "y nach verschieben(2, -3)");
    }

    @Test
    public void toStringZeigtBeideKoordinaten() {
        assertEquals("(3|4)", new Punkt(3, 4).toString());
        assertEquals("(-1|0)", new Punkt(-1, 0).toString());
    }

    @Test
    public void abstandZumUrsprung() {
        assertEquals(5.0, new Punkt(3, 4).abstandZumUrsprung(), 0.0001);
        assertEquals(0.0, new Punkt(0, 0).abstandZumUrsprung(), 0.0001);
    }
}
