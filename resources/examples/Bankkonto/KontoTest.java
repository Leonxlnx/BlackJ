import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

/**
 * Testklasse für Konto. Einer der Tests schlägt absichtlich fehl:
 * Findest du heraus, ob der Test oder die Klasse Konto falsch ist?
 */
public class KontoTest {

    @Test
    public void neuesKontoIstLeer() {
        Konto k = new Konto("Mia");
        assertEquals(0.0, k.getKontostand());
    }

    @Test
    public void einzahlenErhoehtKontostand() {
        Konto k = new Konto("Mia");
        k.einzahlen(50);
        assertEquals(50.0, k.getKontostand());
    }

    @Test
    public void abhebenOhneDeckungGehtNicht() {
        Konto k = new Konto("Mia");
        k.einzahlen(20);
        assertTrue(k.abheben(30));
    }
}
