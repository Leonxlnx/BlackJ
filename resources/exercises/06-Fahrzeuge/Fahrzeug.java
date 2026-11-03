/**
 * Ein Fahrzeug mit Namen. Von Fahrzeug selbst gibt es keine Objekte,
 * nur von seinen Unterklassen.
 */
public abstract class Fahrzeug {
    private String name;

    /**
     * @param name der Name, zum Beispiel "Golf"
     */
    public Fahrzeug(String name) {
        this.name = name;
    }

    /** @return der Name */
    public String getName() {
        return name;
    }

    /** @return wie viele Räder das Fahrzeug hat */
    public abstract int getRaeder();

    /** @return zum Beispiel "Golf hat 4 Räder" */
    public String beschreibung() {
        return ""; // TODO: Name und getRaeder() verwenden
    }
}
