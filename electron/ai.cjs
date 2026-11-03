// The AI tutor: talks to the Claude API with the student's own API key.
// The key stays in the main process; with "remember" it is encrypted by the operating
// system (Electron safeStorage) and never handed to the window.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk').default;

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.2, fallbacks: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2, fallbacks: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01, fallbacks: false },
];

const PROMPTS = {
  de: {
    base: `Du bist der KI-Tutor in BlackJ, einer Lernumgebung für Java an Schulen, ähnlich wie BlueJ. Du hilfst Schülerinnen und Schülern (meist 14 bis 18 Jahre alt), Java und objektorientiertes Programmieren zu verstehen.

So funktioniert BlackJ: Das Klassendiagramm zeigt alle Klassen des Projekts. Nach "Kompilieren" kann man mit Rechtsklick auf eine Klasse Objekte erzeugen (new ...). Sie liegen auf der Objektbank, wo man ihre Methoden aufruft und ihre Attribute ansieht. "main starten" führt ein Programm aus; Ausgaben und Eingaben stehen in der Konsole.

Antworte auf Deutsch, kurz und in einfachen Worten. Verwende die Fachbegriffe aus dem Informatikunterricht (Klasse, Objekt, Attribut, Methode, Konstruktor, Parameter, Rückgabewert, Datentyp, Vererbung) und erkläre einen Begriff, wenn er zum ersten Mal vorkommt. Code steht in \`\`\`java-Blöcken und passt zum Projekt der Person.

Mit einer Nachricht kann Kontext aus BlackJ kommen: die geöffnete Datei mit Zeilennummern, markierte Zeilen, Compilerfehler oder eine Exception. Beziehe dich darauf, wenn es hilft, und nenne die Zeile.`,
    hints: `Modus: Tipps. Die Person soll selbst auf die Lösung kommen. Schreib keine fertige Lösung einer Aufgabe und keinen kompletten Code dafür. Zeig, wo das Problem steckt, stell eine Leitfrage oder gib den nächsten kleinen Schritt. Kurze allgemeine Beispiele, die nicht die Aufgabe selbst lösen, sind erlaubt. Wenn jemand nach eigenen Versuchen ausdrücklich nach der Lösung fragt, darfst du sie zeigen und erklären.`,
    explain: `Modus: Erklären. Erkläre vollständig und zeig Code, wenn er hilft. Sag bei Code immer, warum er so funktioniert, nicht nur, was er tut.`,
  },
  en: {
    base: `You are the AI tutor in BlackJ, a Java learning environment for schools, similar to BlueJ. You help students (mostly 14 to 18 years old) understand Java and object-oriented programming.

How BlackJ works: the class diagram shows every class of the project. After "Compile", right-clicking a class creates objects (new ...). They sit on the object bench, where you call their methods and look at their fields. "Run main" runs a program; output and input appear in the console.

Answer in English, briefly and in plain words. Use the terms taught in computer science class (class, object, field, method, constructor, parameter, return value, data type, inheritance) and explain a term the first time it appears. Code goes in \`\`\`java blocks and fits the student's project.

A message may carry context from BlackJ: the open file with line numbers, selected lines, compiler errors or an exception. Refer to it when it helps and name the line.`,
    hints: `Mode: hints. The student should find the solution themselves. Do not write the finished solution to an exercise or the complete code for it. Show where the problem is, ask a guiding question or give the next small step. Short general examples that do not solve the exercise itself are fine. If someone explicitly asks for the solution after trying, you may show and explain it.`,
    explain: `Mode: explain. Explain fully and show code when it helps. With code, always say why it works, not only what it does.`,
  },
};

class Tutor {
  constructor({ dir, safeStorage, emit, clientOptions = {} }) {
    this.clientOptions = clientOptions;
    this.keyFile = path.join(dir, 'ai-key.bin');
    this.safeStorage = safeStorage;
    this.emit = emit;
    this.key = null;
    this.messages = [];
    this.system = null;
    this.stream = null;
    this.sentFiles = new Map();
    this.turnFiles = [];
    this.loadKey();
  }

  loadKey() {
    try {
      if (fs.existsSync(this.keyFile) && this.safeStorage.isEncryptionAvailable()) {
        this.key = this.safeStorage.decryptString(fs.readFileSync(this.keyFile));
      }
    } catch {
      this.key = null;
    }
  }

  status() {
    return {
      hasKey: !!this.key,
      stored: fs.existsSync(this.keyFile),
      canStore: this.safeStorage.isEncryptionAvailable(),
      models: MODELS.map(({ id, label, input, output }) => ({ id, label, input, output })),
      busy: !!this.stream,
    };
  }

  setKey(key, remember) {
    const k = String(key || '').trim();
    if (!k) throw new Error('empty key');
    this.key = k;
    this.clearStoredKey();
    if (remember && this.safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(this.keyFile, this.safeStorage.encryptString(k));
    }
    return this.status();
  }

  clearStoredKey() {
    try { fs.rmSync(this.keyFile, { force: true }); } catch { /* nothing stored */ }
  }

  forgetKey() {
    this.key = null;
    this.clearStoredKey();
    return this.status();
  }

  client() {
    // Always the official endpoint with the student's own key: environment variables such as
    // ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN from a developer shell must never redirect it.
    return new Anthropic({ apiKey: this.key, authToken: null, baseURL: 'https://api.anthropic.com', maxRetries: 2, ...this.clientOptions });
  }

  /** Starts a new conversation. The system prompt is fixed for the whole conversation. */
  newChat({ lang, mode }) {
    this.stop();
    const p = PROMPTS[lang] || PROMPTS.de;
    this.system = p.base + '\n\n' + (mode === 'explain' ? p.explain : p.hints);
    this.messages = [];
    this.sentFiles.clear();
  }

  contextText(ctx, lang) {
    if (!ctx) return null;
    const de = lang !== 'en';
    const parts = [];
    if (ctx.file && ctx.content != null) {
      const hash = crypto.createHash('sha1').update(ctx.content).digest('hex');
      if (this.sentFiles.get(ctx.file) !== hash) {
        this.turnFiles.push([ctx.file, this.sentFiles.get(ctx.file)]);
        this.sentFiles.set(ctx.file, hash);
        const numbered = ctx.content.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
        parts.push(`${de ? 'Geöffnete Datei' : 'Open file'}: ${ctx.file}\n\`\`\`java\n${numbered}\n\`\`\``);
      } else {
        parts.push(`${de ? 'Geöffnete Datei' : 'Open file'}: ${ctx.file} (${de ? 'unverändert seit der letzten Nachricht' : 'unchanged since the last message'})`);
      }
    }
    if (ctx.selection) parts.push(`${de ? 'Markiert' : 'Selected'} (${de ? 'Zeilen' : 'lines'} ${ctx.selection.from}-${ctx.selection.to}):\n\`\`\`java\n${ctx.selection.text}\n\`\`\``);
    if (ctx.problems && ctx.problems.length) {
      parts.push((de ? 'Compilerfehler' : 'Compiler errors') + ':\n' + ctx.problems.slice(0, 15).map((p) => `- ${p.file}:${p.line}: ${p.message}${p.details && p.details.length ? ' (' + p.details.join('; ') + ')' : ''}`).join('\n'));
    }
    if (ctx.exception) parts.push((de ? 'Exception beim Ausführen' : 'Exception while running') + ':\n' + ctx.exception);
    if (ctx.classes && ctx.classes.length) parts.push((de ? 'Klassen im Projekt' : 'Classes in the project') + ': ' + ctx.classes.join(', '));
    if (!parts.length) return null;
    return (de ? '[Kontext aus BlackJ, automatisch mitgeschickt]\n' : '[Context from BlackJ, sent automatically]\n') + parts.join('\n\n');
  }

  async send({ text, context, model, lang, mode, turnId }) {
    if (!this.key) throw Object.assign(new Error('no key'), { code: 'noKey' });
    if (this.stream) throw Object.assign(new Error('busy'), { code: 'busy' });
    if (!this.system) this.newChat({ lang, mode });
    const info = MODELS.find((m) => m.id === model) || MODELS[0];
    const content = [];
    this.turnFiles = [];
    const ctx = this.contextText(context, lang);
    if (ctx) content.push({ type: 'text', text: ctx });
    content.push({ type: 'text', text });
    this.messages.push({ role: 'user', content });

    const params = {
      model: info.id,
      max_tokens: 32000,
      system: this.system,
      messages: this.messages,
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
    };
    if (info.fallbacks) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    const emit = (type, data) => this.emit({ turnId, type, ...data });
    let stream;
    try {
      stream = this.client().beta.messages.stream(params);
      this.stream = stream;
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'thinking') emit('thinking', {});
        else if (event.type === 'content_block_start' && event.content_block.type === 'text') emit('writing', {});
        else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') emit('delta', { text: event.delta.text });
      }
      const final = await stream.finalMessage();
      this.messages.push({ role: 'assistant', content: final.content });
      const u = final.usage || {};
      const cost =
        ((u.input_tokens || 0) * info.input +
          (u.cache_creation_input_tokens || 0) * info.input * 1.25 +
          (u.cache_read_input_tokens || 0) * info.cacheRead +
          (u.output_tokens || 0) * info.output) / 1e6;
      emit('done', {
        stopReason: final.stop_reason,
        model: final.model,
        usage: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0 },
        cost,
      });
    } catch (err) {
      // The turn did not complete: take the question back off the end of the history
      // (nothing follows it, so the earlier turns stay exactly as they were sent).
      if (this.messages.length && this.messages[this.messages.length - 1].role === 'user') {
        this.messages.pop();
        for (const [file, previous] of this.turnFiles) {
          if (previous === undefined) this.sentFiles.delete(file);
          else this.sentFiles.set(file, previous);
        }
      }
      if (err instanceof Anthropic.APIUserAbortError || (stream && stream.aborted)) {
        emit('aborted', {});
      } else {
        emit('error', { code: errorCode(err), message: err && err.message ? String(err.message).slice(0, 400) : String(err) });
      }
    } finally {
      this.stream = null;
    }
  }

  stop() {
    if (this.stream) {
      try { this.stream.abort(); } catch { /* already finished */ }
    }
  }

  /**
   * Inline completion (ghost text in the editor). Small and fast: Claude Haiku 5.5, thinking off,
   * low effort. A newer request cancels the older one.
   */
  async complete({ prefix, suffix, file }) {
    if (!this.key) return { text: '' };
    if (this.completeAbort) this.completeAbort.abort();
    const ac = new AbortController();
    this.completeAbort = ac;
    const system =
      'You complete Java code in the BlackJ editor, used by school students. Reply with only the text that belongs at the cursor: ' +
      'no explanation, no markdown fences, and never repeat code that is already before or after the cursor. Finish the current line or ' +
      'statement; at most a few lines. Match the indentation and the language of identifiers and comments around the cursor. ' +
      'If nothing useful fits, reply with nothing.';
    const user = `File: ${file}\n<before_cursor>\n${String(prefix).slice(-6000)}</before_cursor>\n<after_cursor>\n${String(suffix).slice(0, 2000)}\n</after_cursor>`;
    try {
      const msg = await this.client().messages.create(
        { model: 'claude-haiku-5-5', max_tokens: 256, thinking: { type: 'disabled' }, output_config: { effort: 'low' }, system, messages: [{ role: 'user', content: user }] },
        { signal: ac.signal, maxRetries: 0 },
      );
      if (msg.stop_reason === 'refusal') return { text: '' };
      let text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const fence = text.match(/^```\w*\n([\s\S]*?)\n?```\s*$/);
      if (fence) text = fence[1];
      return { text: text.replace(/\s+$/, (m) => (m.includes('\n') ? '\n' : '')) };
    } catch (err) {
      if (ac.signal.aborted) return { text: '', aborted: true };
      return { text: '', error: errorCode(err) };
    }
  }

  /**
   * One-off code change: "write with AI" (Ctrl+I) and "fix with AI". Returns the new code for the
   * selection (or the whole file) plus a one-line explanation; the window shows it as a diff first.
   */
  async edit({ instruction, file, content, selection, model, lang, scope }) {
    if (!this.key) throw Object.assign(new Error('no key'), { code: 'noKey' });
    const info = MODELS.find((m) => m.id === model) || MODELS[0];
    const de = lang !== 'en';
    const numbered = String(content).split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
    const target = scope === 'file'
      ? (de ? 'Gib die komplette neue Datei zurück.' : 'Return the complete new file.')
      : selection && selection.text
        ? (de ? `Ersetze die Zeilen ${selection.from}-${selection.to}. Gib nur den neuen Code für genau diese Zeilen zurück.` : `Replace lines ${selection.from}-${selection.to}. Return only the new code for exactly these lines.`)
        : (de ? `Füge an Zeile ${selection ? selection.from : 1} neuen Code ein. Gib nur den einzufügenden Code zurück.` : `Insert new code at line ${selection ? selection.from : 1}. Return only the code to insert.`);
    const system =
      (de
        ? 'Du bist der Programmier-Assistent in BlackJ, einer Java-Lernumgebung für Schulen. Du änderst Code genau so, wie die Person es verlangt, und sonst nichts. Halte dich an den Stil und die Sprache der Bezeichner im vorhandenen Code. Antworte mit genau einem ```java-Block mit dem Code und danach mit einem kurzen Satz auf Deutsch, was du geändert hast.'
        : 'You are the coding assistant in BlackJ, a Java learning environment for schools. Change the code exactly as asked and nothing else. Follow the style and the naming language of the existing code. Reply with exactly one ```java block with the code, then one short sentence saying what you changed.');
    const user = `${de ? 'Datei' : 'File'}: ${file}\n\`\`\`java\n${numbered}\n\`\`\`\n\n${target}\n\n${de ? 'Auftrag' : 'Request'}: ${instruction}`;
    const params = { model: info.id, max_tokens: 32000, system, messages: [{ role: 'user', content: user }], output_config: { effort: 'medium' } };
    if (info.fallbacks) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    try {
      const final = await this.client().beta.messages.stream(params).finalMessage();
      if (final.stop_reason === 'refusal') throw Object.assign(new Error('refusal'), { code: 'refusal' });
      const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const m = text.match(/```(?:java)?\n([\s\S]*?)```/);
      if (!m) throw Object.assign(new Error('no code in answer'), { code: 'noCode' });
      const explanation = text.slice(text.indexOf(m[0]) + m[0].length).trim().split('\n')[0] || '';
      return { code: m[1].replace(/\n$/, ''), explanation };
    } catch (err) {
      if (err.code) throw err;
      throw Object.assign(new Error(err.message), { code: errorCode(err) });
    }
  }
}

function errorCode(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'auth';
  if (err instanceof Anthropic.PermissionDeniedError) return 'permission';
  if (err instanceof Anthropic.RateLimitError) return 'rateLimit';
  if (err instanceof Anthropic.NotFoundError) return 'notFound';
  if (err instanceof Anthropic.BadRequestError) return 'badRequest';
  if (err instanceof Anthropic.InternalServerError) return 'server';
  if (err instanceof Anthropic.APIConnectionError) return 'offline';
  if (err instanceof Anthropic.APIError) return err.status === 529 ? 'overloaded' : 'api';
  return 'unknown';
}

module.exports = { Tutor, MODELS };
