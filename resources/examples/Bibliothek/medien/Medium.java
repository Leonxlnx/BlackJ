package medien;

/**
 * Ein Medium, das man ausleihen kann. Abstrakt: Es gibt nur Bücher und Filme.
 */
public abstract class Medium {
    private String titel;
    private boolean ausgeliehen;

    /**
     * @param titel der Titel des Mediums
     */
    public Medium(String titel) {
        this.titel = titel;
        this.ausgeliehen = false;
    }

    /** Gibt den Titel zurück. */
    public String getTitel() {
        return titel;
    }

    /** Ist das Medium gerade ausgeliehen? */
    public boolean istAusgeliehen() {
        return ausgeliehen;
    }

    /**
     * Leiht das Medium aus, wenn es noch da ist.
     * @return true, wenn das Ausleihen geklappt hat
     */
    public boolean ausleihen() {
        if (ausgeliehen) {
            return false;
        }
        ausgeliehen = true;
        return true;
    }

    /** Gibt das Medium zurück. */
    public void zurueckgeben() {
        ausgeliehen = false;
    }

    /** Wie viele Tage man das Medium behalten darf. */
    public abstract int leihdauerTage();

    @Override
    public String toString() {
        return titel + (ausgeliehen ? " (ausgeliehen)" : "");
    }
}
