// Reference solutions for resources/exercises, used only by scripts/test-exercises.cjs to prove
// that every exercise can be solved. Each entry replaces whole files of the starter project.
module.exports = {
  '01-Punkt': {
    'Punkt.java': `public class Punkt {
    private int x;
    private int y;

    public Punkt(int x, int y) {
        this.x = x;
        this.y = y;
    }

    public int getX() { return x; }
    public int getY() { return y; }

    public void verschieben(int dx, int dy) {
        x = x + dx;
        y = y + dy;
    }

    public double abstandZumUrsprung() {
        return Math.sqrt(x * x + y * y);
    }

    @Override
    public String toString() {
        return "(" + x + "|" + y + ")";
    }
}
`,
  },
  '02-Rechner': {
    'Rechner.java': `public class Rechner {
    public int summeBis(int n) {
        int summe = 0;
        for (int i = 1; i <= n; i++) summe += i;
        return summe;
    }

    public long fakultaet(int n) {
        long f = 1;
        for (int i = 2; i <= n; i++) f *= i;
        return f;
    }

    public boolean istPrimzahl(int n) {
        if (n < 2) return false;
        for (int t = 2; t * t <= n; t++) if (n % t == 0) return false;
        return true;
    }
}
`,
  },
  '03-Texte': {
    'TextWerkzeug.java': `public class TextWerkzeug {
    public String umdrehen(String text) {
        String ergebnis = "";
        for (int i = text.length() - 1; i >= 0; i--) ergebnis += text.charAt(i);
        return ergebnis;
    }

    public int zaehleVokale(String text) {
        int n = 0;
        for (char c : text.toLowerCase().toCharArray()) if ("aeiou".indexOf(c) >= 0) n++;
        return n;
    }

    public boolean istPalindrom(String text) {
        String t = text.toLowerCase();
        return t.equals(umdrehen(t));
    }
}
`,
  },
  '04-Statistik': {
    'Statistik.java': `public class Statistik {
    public int maximum(int[] werte) {
        int max = werte[0];
        for (int w : werte) if (w > max) max = w;
        return max;
    }

    public double durchschnitt(int[] werte) {
        if (werte.length == 0) return 0;
        double summe = 0;
        for (int w : werte) summe += w;
        return summe / werte.length;
    }

    public int anzahlUeber(int[] werte, int grenze) {
        int n = 0;
        for (int w : werte) if (w > grenze) n++;
        return n;
    }
}
`,
  },
  '05-Schulklasse': {
    'Schulklasse.java': `import java.util.ArrayList;

public class Schulklasse {
    private String bezeichnung;
    private ArrayList<Schueler> schueler = new ArrayList<>();

    public Schulklasse(String bezeichnung) { this.bezeichnung = bezeichnung; }

    public void aufnehmen(Schueler s) { schueler.add(s); }

    public int anzahl() { return schueler.size(); }

    public int besteNote() {
        int beste = 0;
        for (Schueler s : schueler) if (beste == 0 || s.getNote() < beste) beste = s.getNote();
        return beste;
    }

    public Schueler suche(String name) {
        for (Schueler s : schueler) if (s.getName().equals(name)) return s;
        return null;
    }

    public String getBezeichnung() { return bezeichnung; }
}
`,
  },
  '06-Fahrzeuge': {
    'Fahrzeug.java': `public abstract class Fahrzeug {
    private String name;
    public Fahrzeug(String name) { this.name = name; }
    public String getName() { return name; }
    public abstract int getRaeder();
    public String beschreibung() { return name + " hat " + getRaeder() + " Räder"; }
}
`,
    'Auto.java': `public class Auto extends Fahrzeug {
    public Auto(String name) { super(name); }
    @Override public int getRaeder() { return 4; }
}
`,
    'Fahrrad.java': `public class Fahrrad extends Fahrzeug {
    public Fahrrad(String name) { super(name); }
    @Override public int getRaeder() { return 2; }
}
`,
  },
};
