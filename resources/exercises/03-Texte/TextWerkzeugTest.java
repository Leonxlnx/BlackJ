import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

/**
 * Prüft die Klasse TextWerkzeug. Lass die Tests laufen, bis alle grün sind.
 */
public class TextWerkzeugTest {
    private final TextWerkzeug w = new TextWerkzeug();

    @Test
    public void umdrehen() {
        assertEquals("ollaH", w.umdrehen("Hallo"));
        assertEquals("", w.umdrehen(""));
        assertEquals("a", w.umdrehen("a"));
    }

    @Test
    public void vokaleZaehlen() {
        assertEquals(3, w.zaehleVokale("Banane"), "Banane");
        assertEquals(2, w.zaehleVokale("OTTO"), "Großbuchstaben zählen auch");
        assertEquals(0, w.zaehleVokale("Psst!"), "Psst! hat keine a, e, i, o, u");
    }

    @Test
    public void palindrome() {
        assertTrue(w.istPalindrom("Otto"), "Otto");
        assertTrue(w.istPalindrom("Rentner"), "Rentner");
        assertTrue(w.istPalindrom("a"), "ein einzelnes Zeichen");
    }

    @Test
    public void keinePalindrome() {
        assertFalse(w.istPalindrom("Hallo"), "Hallo");
        assertFalse(w.istPalindrom("ab"), "ab");
    }
}
