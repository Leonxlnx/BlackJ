/**
 * Ein Schüler mit Namen und Note (1 bis 6).
 */
public class Schueler {
    private String name;
    private int note;

    /**
     * @param name der Name
     * @param note die Note von 1 bis 6
     */
    public Schueler(String name, int note) {
        this.name = name;
        this.note = note;
    }

    /** @return der Name */
    public String getName() {
        return name;
    }

    /** @return die Note */
    public int getNote() {
        return note;
    }

    @Override
    public String toString() {
        return name + " (" + note + ")";
    }
}
