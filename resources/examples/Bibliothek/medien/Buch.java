package medien;

/**
 * Ein Buch. Bücher darf man vier Wochen behalten.
 */
public class Buch extends Medium {
    private String autor;
    private int seiten;

    /**
     * @param titel  der Titel
     * @param autor  wer das Buch geschrieben hat
     * @param seiten wie viele Seiten es hat
     */
    public Buch(String titel, String autor, int seiten) {
        super(titel);
        this.autor = autor;
        this.seiten = seiten;
    }

    /** Gibt den Namen des Autors zurück. */
    public String getAutor() {
        return autor;
    }

    /** Gibt die Seitenzahl zurück. */
    public int getSeiten() {
        return seiten;
    }

    @Override
    public int leihdauerTage() {
        return 28;
    }
}
