package medien;

/**
 * Ein Film auf DVD. Filme darf man nur eine Woche behalten.
 */
public class Film extends Medium {
    private int minuten;

    /**
     * @param titel   der Titel
     * @param minuten die Länge in Minuten
     */
    public Film(String titel, int minuten) {
        super(titel);
        this.minuten = minuten;
    }

    /** Gibt die Länge in Minuten zurück. */
    public int getMinuten() {
        return minuten;
    }

    @Override
    public int leihdauerTage() {
        return 7;
    }
}
