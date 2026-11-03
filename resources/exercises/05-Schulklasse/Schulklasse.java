import java.util.ArrayList;

/**
 * Eine Schulklasse mit ihren Schülern.
 */
public class Schulklasse {
    private String bezeichnung;
    private ArrayList<Schueler> schueler;

    /**
     * @param bezeichnung zum Beispiel "10b"
     */
    public Schulklasse(String bezeichnung) {
        this.bezeichnung = bezeichnung;
        this.schueler = new ArrayList<>();
    }

    /**
     * Nimmt einen Schüler in die Klasse auf.
     * @param s der neue Schüler
     */
    public void aufnehmen(Schueler s) {
        // TODO
    }

    /** @return wie viele Schüler in der Klasse sind */
    public int anzahl() {
        return 0; // TODO
    }

    /** @return die beste (kleinste) Note, für eine leere Klasse 0 */
    public int besteNote() {
        return 0; // TODO
    }

    /**
     * @param name der gesuchte Name
     * @return der Schüler mit diesem Namen, sonst null
     */
    public Schueler suche(String name) {
        return null; // TODO
    }

    /** @return die Bezeichnung der Klasse */
    public String getBezeichnung() {
        return bezeichnung;
    }
}
