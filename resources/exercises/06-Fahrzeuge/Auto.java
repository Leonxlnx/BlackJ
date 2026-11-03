/**
 * Ein Auto ist ein Fahrzeug mit 4 Rädern.
 */
public class Auto extends Fahrzeug {

    /**
     * @param name der Name des Autos
     */
    public Auto(String name) {
        super(name); // ruft den Konstruktor von Fahrzeug auf
    }

    @Override
    public int getRaeder() {
        return 0; // TODO
    }
}
