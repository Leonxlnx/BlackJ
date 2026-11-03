/**
 * Ein Tier im Zoo. Die Klasse ist abstrakt: Es gibt keine "allgemeinen" Tiere,
 * nur Hunde, Katzen und so weiter. Jede Unterklasse muss gibLaut() selbst schreiben.
 */
public abstract class Tier {
    private String name;
    private int alter;

    /**
     * Erzeugt ein neues Tier.
     * @param name  wie das Tier heißt, zum Beispiel "Bello"
     * @param alter das Alter in Jahren
     */
    public Tier(String name, int alter) {
        this.name = name;
        this.alter = alter;
    }

    /** Gibt den Namen des Tiers zurück. */
    public String getName() {
        return name;
    }

    /** Gibt das Alter in Jahren zurück. */
    public int getAlter() {
        return alter;
    }

    /** Das Tier hat Geburtstag: Das Alter steigt um 1. */
    public void geburtstag() {
        alter = alter + 1;
    }

    /** Jede Tierart macht ein anderes Geräusch. */
    public abstract String gibLaut();

    @Override
    public String toString() {
        return name + " (" + alter + " Jahre)";
    }
}
