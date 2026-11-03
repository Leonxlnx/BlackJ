/**
 * Ein Fahrrad ist ein Fahrzeug mit 2 Rädern.
 */
public class Fahrrad extends Fahrzeug {

    /**
     * @param name der Name des Fahrrads
     */
    public Fahrrad(String name) {
        super(name);
    }

    @Override
    public int getRaeder() {
        return 0; // TODO
    }
}
