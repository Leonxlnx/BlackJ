import static org.junit.jupiter.api.Assertions.*;
import java.util.ArrayList;
import org.junit.jupiter.api.Test;

/**
 * Prüft Fahrzeug, Auto und Fahrrad. Lass die Tests laufen, bis alle grün sind.
 */
public class FahrzeugTest {

    @Test
    public void raeder() {
        assertEquals(4, new Auto("Golf").getRaeder(), "ein Auto");
        assertEquals(2, new Fahrrad("BMX").getRaeder(), "ein Fahrrad");
    }

    @Test
    public void beschreibung() {
        assertEquals("Golf hat 4 Räder", new Auto("Golf").beschreibung());
        assertEquals("BMX hat 2 Räder", new Fahrrad("BMX").beschreibung());
    }

    @Test
    public void polymorphie() {
        ArrayList<Fahrzeug> garage = new ArrayList<>();
        garage.add(new Auto("Golf"));
        garage.add(new Fahrrad("BMX"));
        garage.add(new Auto("Polo"));
        int summe = 0;
        for (Fahrzeug f : garage) summe += f.getRaeder();
        assertEquals(10, summe, "4 + 2 + 4 Räder in der Garage");
    }
}
