// A scripted stand-in for the Claude API, used only by the smoke run (--smoke). The SDK still
// targets https://api.anthropic.com; this fetch answers locally, so no request leaves the machine.

const USAGE = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const CONTEXT_HEAD = /^\[(Kontext aus BlackJ|Context from BlackJ)/;

let calls = 0;
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
  return { question, step: rounds.length, last: lastResult ? String(lastResult.content) : '' };
}

function script(body) {
  const { question, step, last } = turnOf(body.messages || []);
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
  return { text: 'Okay.' };
}

async function smokeFetch(_url, init) {
  const body = JSON.parse(init.body);
  if (!body.stream) {
    const msg = { id: 'msg_smoke', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: '' }], stop_reason: 'end_turn', stop_sequence: null, usage: USAGE };
    return new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(message(body.model, script(body)), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

module.exports = { smokeFetch };
