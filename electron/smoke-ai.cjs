// A scripted stand-in for the Claude API, used only by the smoke run (--smoke). The SDK still
// targets https://api.anthropic.com; this fetch answers locally, so no request leaves the machine.

const USAGE = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const CONTEXT_HEAD = /^\[(Kontext aus BlackJ|Context from BlackJ)/;

let calls = 0;
let hiccups = 0;
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

/** One streamed message: optional text, then optional tool calls. */
function message(model, { text, tools = [], stop }) {
  const ev = [{ type: 'message_start', message: { id: 'msg_smoke', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...USAGE, output_tokens: 1 } } }];
  let index = 0;
  if (text) {
    ev.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    for (let i = 0; i < text.length; i += 12) ev.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: text.slice(i, i + 12) } });
    ev.push({ type: 'content_block_stop', index });
    index++;
  }
  tools.forEach((t) => {
    ev.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_smoke_${++calls}`, name: t.name, input: {} } });
    ev.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input) } });
    ev.push({ type: 'content_block_stop', index });
    index++;
  });
  ev.push({ type: 'message_delta', delta: { stop_reason: stop || (tools.length ? 'tool_use' : 'end_turn'), stop_sequence: null }, usage: { output_tokens: USAGE.output_tokens } });
  ev.push({ type: 'message_stop' });
  return sse(ev);
}

/** A tool_result's text (its content is a string, or text and image blocks). */
const resultText = (b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.filter((x) => x.type === 'text').map((x) => x.text).join('') : '');
/** The PNG screenshots in a tool_result. */
const resultImages = (b) => (Array.isArray(b.content) ? b.content.filter((x) => x.type === 'image' && x.source && x.source.media_type === 'image/png' && /^iVBORw0KGgo/.test(x.source.data)) : []);

/** The question of the current turn and how many tool rounds followed it. */
function turnOf(messages) {
  let at = -1;
  let question = '';
  messages.forEach((m, i) => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return;
    const q = m.content.find((b) => b.type === 'text' && !CONTEXT_HEAD.test(b.text));
    if (q && !m.content.some((b) => b.type === 'tool_result')) {
      at = i;
      question = q.text;
    }
  });
  const rounds = messages.slice(at + 1).filter((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'));
  const lastResult = rounds.length ? rounds[rounds.length - 1].content.filter((b) => b.type === 'tool_result').pop() : null;
  return { question, step: rounds.length, last: lastResult ? resultText(lastResult) : '', images: lastResult ? resultImages(lastResult).length : 0 };
}

// A small window program for the build that looks and plays: a square that moves with the arrow
// keys, drawn in a logical 320x200 field scaled to the window. It opens out of sight (-4000,-4000).
const FELD = `import javax.swing.*;
import java.awt.*;
import java.awt.event.*;

/** Ein Feld mit einem Quadrat, das sich mit den Pfeiltasten bewegt. */
public class Feld extends JPanel {
    private static final int BREITE = 320;
    private static final int HOEHE = 200;
    private int x = 40;
    private int y = 70;

    public Feld() {
        setPreferredSize(new Dimension(BREITE, HOEHE));
        setBackground(new Color(18, 18, 20));
        setFocusable(true);
        addKeyListener(new KeyAdapter() {
            @Override
            public void keyPressed(KeyEvent e) {
                if (e.getKeyCode() == KeyEvent.VK_RIGHT) x += 20;
                if (e.getKeyCode() == KeyEvent.VK_DOWN) y += 20;
                System.out.println("pos " + x + "," + y);
                repaint();
            }
        });
    }

    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        Graphics2D g2 = (Graphics2D) g;
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        double k = Math.min(getWidth() / (double) BREITE, getHeight() / (double) HOEHE);
        g2.translate((getWidth() - BREITE * k) / 2, (getHeight() - HOEHE * k) / 2);
        g2.scale(k, k);
        g2.setColor(new Color(36, 36, 40));
        g2.fillRoundRect(0, 0, BREITE, HOEHE, 18, 18);
        g2.setColor(new Color(240, 240, 242));
        g2.fillRoundRect(x, y, 48, 48, 12, 12);
        g2.setColor(new Color(150, 150, 158));
        g2.drawString("Pfeiltasten bewegen", 12, HOEHE - 12);
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            JFrame f = new JFrame("Quadrat-Feld");
            f.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
            Feld feld = new Feld();
            f.setContentPane(feld);
            f.pack();
            f.setMinimumSize(new Dimension(240, 160));
            f.setLocation(-4000, -4000);
            f.setVisible(true);
            feld.requestFocusInWindow();
        });
    }
}
`;
const plan = (...states) => ({ name: 'update_plan', input: { items: ['Feld anlegen', 'Kompilieren', 'Ansehen und ausprobieren'].map((text, i) => ({ text, status: states[i] })) } });

function script(body) {
  const { question, step, last, images } = turnOf(body.messages || []);
  if (question.startsWith('Lass den Hund zweimal bellen')) {
    if (step === 0) return { text: 'Ich schau mir `Hund.java` an.', tools: [{ name: 'read_file', input: { path: 'Hund.java' } }] };
    if (step === 1) return { text: 'Ich ändere `gibLaut()`.', tools: [{ name: 'edit_file', input: { path: 'Hund.java', old_text: '"Wuff!"', new_text: '"Wuff! Wuff!"' } }] };
    if (step === 2) return /accepted|applied/.test(last) ? { tools: [{ name: 'compile', input: {} }] } : { text: 'Okay, ich lass es so.' };
    return { text: 'Fertig: `gibLaut()` bellt jetzt zweimal.' };
  }
  if (question.startsWith('Wie erzeuge ich ein Objekt?')) {
    if (step === 0) {
      return {
        tools: [{
          name: 'show_tutorial',
          input: {
            title: 'Ein Objekt erzeugen',
            steps: [
              { target: 'compile', text: 'Kompiliert alle Klassen.', action: 'compile_ok' },
              { target: 'class:Hund', text: 'Öffnet das Menü von **Hund**.', action: 'contextmenu' },
              { target: 'menu:new', text: 'Erzeugt ein neues Objekt.' },
            ],
          },
        }],
      };
    }
    return { text: 'Dein Objekt erscheint dann unten auf der Objektbank.' };
  }
  if (question.startsWith('Baue ein Würfelspiel')) {
    // Build mode: plan, two classes at once, a compile error, the fix, a clean compile, the summary.
    const wuerfel = '/** Ein Würfel mit sechs Seiten. */\npublic class Wuerfel {\n    private int augen;\n\n    /** Würfelt und gibt die Augenzahl zurück. */\n    public int werfen() {\n        augen = (int) (Math.random() * 6) + 1;\n        return augen;\n    }\n}\n';
    const spiel = '/** Drei Würfe, die Summe zählt. */\npublic class Spiel {\n    public static void main(String[] args) {\n        Wuerfel wuerfel = new Wuerfel();\n        int summe = 0;\n        for (int i = 1; i <= 3; i++) {\n            int wurf = wuerfel.werfen2();\n            System.out.println("Wurf " + i + ": " + wurf);\n            summe += wurf;\n        }\n        System.out.println("Summe: " + summe);\n    }\n}\n';
    if (step === 0) return { text: 'Plan:\n- `Wuerfel` würfelt\n- `Spiel` startet drei Würfe', tools: [{ name: 'get_project', input: {} }] };
    if (step === 1) return { tools: [{ name: 'create_class', input: { name: 'Wuerfel', content: wuerfel } }, { name: 'create_class', input: { name: 'Spiel', content: spiel } }] };
    if (step === 2) return { tools: [{ name: 'compile', input: {} }] };
    if (step === 3) return /"ok":false/.test(last) ? { tools: [{ name: 'edit_file', input: { path: 'Spiel.java', old_text: 'wuerfel.werfen2()', new_text: 'wuerfel.werfen()' } }] } : { text: 'Fertig.' };
    if (step === 4) return { tools: [{ name: 'compile', input: {} }] };
    return { text: 'Gebaut: ein Würfelspiel mit drei Würfen.\nStarten: `Spiel`.' };
  }
  if (question.startsWith('Baue ein Fenster mit einem Quadrat')) {
    // Build mode with the checklist, then the tutor looks at the window (and at it resized) and plays.
    if (step === 0) return { text: 'Ich plane kurz.', tools: [plan('in_progress', 'pending', 'pending'), { name: 'get_project', input: {} }] };
    if (step === 1) return { tools: [{ name: 'create_class', input: { name: 'Feld', content: FELD } }, plan('done', 'in_progress', 'pending')] };
    if (step === 2) return { tools: [{ name: 'compile', input: {} }] };
    if (step === 3) {
      if (!/"ok":\s*true/.test(last)) return { text: 'KOMPILIERFEHLER ' + last.slice(0, 200) };
      return { tools: [plan('done', 'done', 'in_progress'), { name: 'look_at_program', input: { class: 'Feld', wait_ms: 200, resize_to: { width: 520, height: 330 } } }] };
    }
    if (step === 4) {
      if (images !== 2 || !/"title":"Quadrat-Feld"/.test(last)) return { text: 'BILD FEHLT ' + images + ' ' + last.slice(0, 300) };
      return { text: 'Sieht gut aus. Jetzt spiele ich.', tools: [{ name: 'use_program', input: { class: 'Feld', steps: [{ do: 'key', key: 'RIGHT' }, { do: 'key', key: 'RIGHT' }, { do: 'shot' }, { do: 'key', key: 'DOWN' }, { do: 'wait', ms: 100 }] } }] };
    }
    if (step === 5) {
      if (images !== 2 || !/pos 80,90/.test(last)) return { text: 'SPIELEN FEHLT ' + images + ' ' + last.slice(0, 300) };
      return { tools: [plan('done', 'done', 'done')] };
    }
    return { text: 'Gebaut: ein Fenster mit einem Quadrat, das sich mit den Pfeiltasten bewegt.\nStarten: `Feld`.' };
  }
  if (question.startsWith('Hol tief Luft')) {
    // Anthropic is overloaded after a tool round (three times, so the SDK's own retries give up):
    // the window resumes the turn by itself.
    if (step === 0) return { tools: [{ name: 'get_project', input: {} }] };
    if (hiccups < 3) {
      hiccups++;
      return { status: 529 };
    }
    return { text: 'Weiter nach der Pause.' };
  }
  if (question.startsWith('Spiel es lange')) {
    // A long play-test that the student stops in the middle.
    if (step === 0) return { tools: [{ name: 'use_program', input: { class: 'Feld', steps: [{ do: 'wait', ms: 5000 }, { do: 'key', key: 'RIGHT' }, { do: 'wait', ms: 5000 }] } }] };
    return { text: 'Fertig gespielt.' };
  }
  return { text: 'Okay.' };
}

async function smokeFetch(_url, init) {
  const body = JSON.parse(init.body);
  if (!body.stream) {
    const msg = { id: 'msg_smoke', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: '' }], stop_reason: 'end_turn', stop_sequence: null, usage: USAGE };
    return new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const next = script(body);
  if (next.status) {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: next.status, headers: { 'content-type': 'application/json' } });
  }
  return new Response(message(body.model, next), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

module.exports = { smokeFetch };
