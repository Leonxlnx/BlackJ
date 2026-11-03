import java.util.ArrayList;

/**
 * Ein Gehege hält mehrere Tiere in einer Liste (ArrayList).
 * Hier siehst du Polymorphie: rufeAlle() ruft gibLaut() auf,
 * und jedes Tier antwortet mit seinem eigenen Geräusch.
 */
public class Gehege {
    private String bezeichnung;
    private ArrayList<Tier> tiere;

    /**
     * Erzeugt ein leeres Gehege.
     * @param bezeichnung zum Beispiel "Streichelzoo"
     */
    public Gehege(String bezeichnung) {
        this.bezeichnung = bezeichnung;
        tiere = new ArrayList<Tier>();
    }

    /**
     * Setzt ein Tier ins Gehege.
     * @param tier das Tier, das einzieht
     */
    public void hinzufuegen(Tier tier) {
        tiere.add(tier);
    }

    /** Gibt zurück, wie viele Tiere im Gehege leben. */
    public int anzahl() {
        return tiere.size();
    }

    /** Alle Tiere geben nacheinander Laut. */
    public void rufeAlle() {
        for (Tier t : tiere) {
            System.out.println(t.getName() + " sagt " + t.gibLaut());
        }
    }

    /** Berechnet das Durchschnittsalter aller Tiere im Gehege. */
    public double durchschnittsalter() {
        int summe = 0;
        for (Tier t : tiere) {
            summe = summe + t.getAlter();
        }
        return (double) summe / tiere.size();
    }
}
