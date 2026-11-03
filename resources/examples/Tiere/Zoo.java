import java.util.Scanner;

/**
 * Das Hauptprogramm. Starte es mit "main starten".
 * Es fragt nach einem Namen und baut dann ein kleines Gehege.
 */
public class Zoo {
    public static void main(String[] args) {
        Scanner eingabe = new Scanner(System.in);
        System.out.print("Wie soll dein Hund heißen? ");
        String name = eingabe.nextLine();

        Gehege gehege = new Gehege("Streichelzoo");
        gehege.hinzufuegen(new Hund(name, 3));
        gehege.hinzufuegen(new Katze("Minka", 5));

        System.out.println("Im Streichelzoo leben " + gehege.anzahl() + " Tiere:");
        gehege.rufeAlle();
        System.out.println("Durchschnittsalter: " + gehege.durchschnittsalter() + " Jahre");
    }
}
