/**
 * Ein Hund ist ein Tier (Vererbung mit "extends").
 * Er erbt Name, Alter und geburtstag() von Tier und ergänzt eigene Methoden.
 */
public class Hund extends Tier {
    private boolean gassiGegangen;

    /**
     * Erzeugt einen neuen Hund.
     * @param name  der Name des Hundes
     * @param alter das Alter in Jahren
     */
    public Hund(String name, int alter) {
        super(name, alter);
        gassiGegangen = false;
    }

    @Override
    public String gibLaut() {
        return "Wuff!";
    }

    /** Geht mit dem Hund Gassi. */
    public void gassiGehen() {
        gassiGegangen = true;
        System.out.println(getName() + " war Gassi und ist jetzt glücklich.");
    }

    /** Ist der Hund heute schon Gassi gegangen? */
    public boolean warGassi() {
        return gassiGegangen;
    }
}
