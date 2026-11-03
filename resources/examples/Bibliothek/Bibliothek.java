import java.util.ArrayList;
import medien.Medium;

/**
 * Eine kleine Bibliothek. Die Medien liegen im Paket "medien",
 * deshalb steht oben "import medien.Medium;".
 */
public class Bibliothek {
    private ArrayList<Medium> bestand;

    /** Erzeugt eine leere Bibliothek. */
    public Bibliothek() {
        bestand = new ArrayList<Medium>();
    }

    /**
     * Nimmt ein Medium in den Bestand auf.
     * @param m das neue Medium
     */
    public void aufnehmen(Medium m) {
        bestand.add(m);
    }

    /** Wie viele Medien gibt es insgesamt? */
    public int anzahl() {
        return bestand.size();
    }

    /** Wie viele Medien sind gerade nicht ausgeliehen? */
    public int verfuegbar() {
        int zahl = 0;
        for (Medium m : bestand) {
            if (!m.istAusgeliehen()) {
                zahl++;
            }
        }
        return zahl;
    }

    /**
     * Sucht ein Medium mit genau diesem Titel.
     * @param titel der gesuchte Titel
     * @return das Medium oder null, wenn es keins gibt
     */
    public Medium suche(String titel) {
        for (Medium m : bestand) {
            if (m.getTitel().equals(titel)) {
                return m;
            }
        }
        return null;
    }
}
