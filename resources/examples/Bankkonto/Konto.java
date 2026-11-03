/**
 * Ein Bankkonto. Der Kontostand ist private: Niemand kann ihn von außen direkt
 * ändern. Das nennt man Datenkapselung. Geld kommt nur über einzahlen() und
 * abheben() auf das Konto oder herunter.
 */
public class Konto {
    private String inhaber;
    private double kontostand;

    /**
     * Eröffnet ein neues Konto mit 0 Euro.
     * @param inhaber der Name der Person, der das Konto gehört
     */
    public Konto(String inhaber) {
        this.inhaber = inhaber;
        this.kontostand = 0.0;
    }

    /**
     * Zahlt Geld ein.
     * @param betrag wie viel Euro eingezahlt werden, zum Beispiel 50
     */
    public void einzahlen(double betrag) {
        if (betrag <= 0) {
            System.out.println("Einzahlen geht nur mit einem positiven Betrag.");
            return;
        }
        kontostand = kontostand + betrag;
    }

    /**
     * Hebt Geld ab, aber nur, wenn genug auf dem Konto ist.
     * @param betrag wie viel Euro abgehoben werden
     * @return true, wenn es geklappt hat
     */
    public boolean abheben(double betrag) {
        if (betrag > kontostand) {
            return false;
        }
        kontostand = kontostand - betrag;
        return true;
    }

    /** Gibt den aktuellen Kontostand in Euro zurück. */
    public double getKontostand() {
        return kontostand;
    }

    /** Gibt den Namen des Inhabers zurück. */
    public String getInhaber() {
        return inhaber;
    }
}
