/**
 * Eine Katze ist auch ein Tier. Sie überschreibt gibLaut() auf ihre eigene Art.
 */
public class Katze extends Tier {
    private int leben;

    /**
     * Erzeugt eine neue Katze mit 7 Leben.
     * @param name  der Name der Katze
     * @param alter das Alter in Jahren
     */
    public Katze(String name, int alter) {
        super(name, alter);
        leben = 7;
    }

    @Override
    public String gibLaut() {
        return "Miau!";
    }

    /** Wie viele Leben hat die Katze noch? */
    public int getLeben() {
        return leben;
    }
}
