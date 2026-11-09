// End-to-end check of the debugger: java/BlackJDebug.java attaches over JDWP to a small
// program, stops at breakpoints, steps and reads variables; then the same inside the bench.
// Run with: node scripts/test-debugger.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn, execFileSync } = require('child_process');
const { findJdks } = require('../electron/jdk.cjs');
const { Debugger, parseJdwpPort } = require('../electron/debugger.cjs');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blackj-debug-test-'));
const helperDir = path.join(tmp, 'helper');
const srcDir = path.join(tmp, 'src');
const classDir = path.join(tmp, 'classes');
const jdk = findJdks()[0];
const running = [];
let failures = 0;

// The student's program. "// @name" marks a line the checks refer to as L.name.
const sources = {
  'Zoo.java': String.raw`import java.util.ArrayList;

public class Zoo {
    // @blank (no code on this line)
    static int zoos = 0;
    private String name;
    private int besuche = 0;
    private ArrayList<Tier> tiere = new ArrayList<>();

    public Zoo(String name) {
        this.name = name;
        zoos++;
    }

    public void aufnehmen(Tier t) {
        tiere.add(t); // @add
        besuche++;
    }

    public int gesamtAlter() {
        int summe = 0; // @summe
        for (Tier t : tiere) { // @for
            summe = summe + t.getAlter(); // @loop
        }
        return summe;
    }

    public static void main(String[] args) {
        Zoo zoo = new Zoo("Tierpark");
        zoo.aufnehmen(new Tier("Bello", 3)); // @first
        zoo.aufnehmen(new Tier("Minka", 5));
        int[] zahlen = { 4, 8, 15 };
        char zeichen = 'x';
        double anteil = 0.5;
        long gross = 10000000000L;
        String text = "Hallo \"Welt\"";
        int alter = zoo.gesamtAlter(); // @call
        System.out.println(zoo.tiere.get(0)); // @print
        System.out.println("Alter: " + alter); // @after
        zoo.tiere.forEach(t -> {
            int a = t.getAlter(); // @lambda
            System.out.println(t + " ist " + a); // @lambdaPrint
        }); // @lambdaEnd
    }
}
`,
  'Tier.java': String.raw`public class Tier {
    private String name;
    private int alter;

    public Tier(String name, int alter) {
        this.name = name;
        this.alter = alter;
    }

    public int getAlter() {
        return alter; // @getAlter
    }

    @Override
    public String toString() {
        String s = name + " (" + alter + ")"; // @toString
        return s; // @toStringEnd
    }

    public static long warte(int ms) {
        long ende = System.currentTimeMillis() + ms;
        long runden = 0;
        while (System.currentTimeMillis() < ende) {
            runden++;
        }
        return runden;
    }

    public static int zaehle(int n) {
        java.util.function.IntSupplier s = new java.util.function.IntSupplier() {
            public int getAsInt() {
                return n * 2; // @inner
            }
        };
        return s.getAsInt(); // @innerCall
    }

    public static int plappern(int ms) {
        long ende = System.currentTimeMillis() + ms;
        String text = "bla ".repeat(300);
        int zeilen = 0;
        while (System.currentTimeMillis() < ende) {
            System.out.println(text + zeilen);
            zeilen++;
        }
        return zeilen;
    }
}
`,
  'tiere/Katze.java': String.raw`package tiere;

public class Katze {
    public static String miau(int n) {
        String laut = "Miau"; // @miau
        return laut.repeat(n);
    }
}
`,
};
const L = {};
for (const text of Object.values(sources)) {
  text.split('\n').forEach((line, i) => {
    const m = line.match(/\/\/ @(\w+)/);
    if (m) L[m[1]] = i + 1;
  });
}

async function check(name, fn) {
  try {
    await fn();
    console.log('  ok   ' + name);
  } catch (err) {
    failures++;
    console.log('  FAIL ' + name + '\n       ' + (err && err.stack || err));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byName = (vars) => Object.fromEntries(vars.map((v) => [v.name, v]));
const where = (paused) => paused.frames.map((f) => [f.className, f.method, f.line]);

function within(promise, what, ms = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out: ' + what)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Records events so a check can wait for the next one of a kind, even if it came early. */
function recorder(emitter, names) {
  const seen = [];
  const waiters = [];
  const deliver = () => {
    for (let w = 0; w < waiters.length;) {
      const i = seen.findIndex((e) => e.name === waiters[w].name);
      if (i < 0) { w++; continue; }
      const e = seen.splice(i, 1)[0];
      waiters.splice(w, 1)[0].resolve(e.msg);
    }
  };
  for (const name of names) emitter.on(name, (msg) => { seen.push({ name, msg }); deliver(); });
  return {
    next(name, ms = 15000) {
      return new Promise((resolve, reject) => {
        const w = { name, resolve: (msg) => { clearTimeout(timer); resolve(msg); } };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error('timed out waiting for event ' + name));
        }, ms);
        waiters.push(w);
        deliver();
      });
    },
    count: (name) => seen.filter((e) => e.name === name).length,
    clear: (name) => { for (let i = seen.length - 1; i >= 0; i--) if (seen[i].name === name) seen.splice(i, 1); },
  };
}

/** Starts a JVM with a JDWP agent; run.port resolves once JDWP printed its port. */
function launch(args, { suspend }) {
  const agent = `-agentlib:jdwp=transport=dt_socket,server=y,suspend=${suspend ? 'y' : 'n'},address=127.0.0.1:0`;
  const proc = spawn(jdk.java, [agent, ...args], { windowsHide: true });
  const run = { proc, stdout: '', stderr: '' };
  running.push(proc);
  run.exited = new Promise((resolve) => proc.on('exit', resolve));
  run.port = new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => {
      run.stdout += d.toString('utf8');
      const port = parseJdwpPort(run.stdout);
      if (port) resolve(port);
    });
    proc.on('exit', (code) => reject(new Error('JVM exited with ' + code + '\n' + run.stderr)));
  });
  proc.stderr.on('data', (d) => { run.stderr += d.toString('utf8'); });
  return run;
}

/** Speaks the bench protocol (JSON lines after the JDWP banner, each behind the bench's mark). */
function benchClient(run) {
  let buffer = '';
  let seq = 0;
  const pending = new Map();
  const events = [];
  run.proc.stdout.on('data', (d) => {
    buffer += d.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      const at = line.lastIndexOf('\u001e');
      if (at < 0) continue;
      const msg = JSON.parse(line.slice(at + 1));
      if (msg.event) {
        if (msg.event !== 'out') events.push(msg);
        continue;
      }
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error('bench: ' + JSON.stringify(msg.error)));
    }
  });
  return {
    events,
    request(cmd, payload = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        run.proc.stdin.write(JSON.stringify({ id, cmd, ...payload }) + '\n');
      });
    },
  };
}

(async () => {
  console.log('JDK ' + jdk.version + ' at ' + jdk.home);

  await check('helper compiles with --release 11', () => {
    execFileSync(jdk.javac, ['--release', '11', '-encoding', 'UTF-8', '-Xlint:-options', '-d', helperDir, path.join(root, 'java', 'BlackJDebug.java')], { stdio: 'pipe' });
    assert.ok(fs.existsSync(path.join(helperDir, 'BlackJDebug.class')));
  });

  await check('student program compiles with -g', () => {
    for (const [file, text] of Object.entries(sources)) {
      fs.mkdirSync(path.dirname(path.join(srcDir, file)), { recursive: true });
      fs.writeFileSync(path.join(srcDir, file), text);
    }
    execFileSync(jdk.javac, ['-g', '-encoding', 'UTF-8', '-d', classDir, ...Object.keys(sources).map((f) => path.join(srcDir, f))], { stdio: 'pipe' });
    assert.ok(fs.existsSync(path.join(classDir, 'Zoo.class')));
  });

  await check('parseJdwpPort reads the JDWP banner', () => {
    assert.strictEqual(parseJdwpPort('Listening for transport dt_socket at address: 55555\n'), 55555);
    assert.strictEqual(parseJdwpPort('noise\nListening for transport dt_socket at address: 127.0.0.1:4711\r\n'), 4711);
    assert.strictEqual(parseJdwpPort('{"event":"ready"}'), null);
  });

  // ---------------------------------------------------------------- a plain program, suspend=y

  const prog = launch(['-cp', classDir, 'Zoo'], { suspend: true });
  const dbg = new Debugger();
  const ev = recorder(dbg, ['paused', 'resumed', 'vmDeath', 'breakpoints', 'exit']);
  dbg.on('error', (e) => console.log('       debugger error: ' + e.message));
  let paused;

  await check('attaches to a VM started with suspend=y', async () => {
    const port = await within(prog.port, 'JDWP port');
    const r = await dbg.attach({ jdk, helperDir, port, classDir });
    assert.strictEqual(r.suspended, true);
  });

  await check('breakpoints in a class that is not loaded yet are pending', async () => {
    const r = await dbg.setBreakpoints({ Zoo: [L.add, L.call, L.blank] });
    assert.deepStrictEqual(r.Zoo, [L.blank, L.add, L.call].map((line) => ({ line, verified: null })));
  });

  await check('resume runs to the breakpoint; lines are verified when the class loads', async () => {
    await dbg.resume();
    const bp = await ev.next('breakpoints');
    assert.strictEqual(bp.className, 'Zoo');
    assert.deepStrictEqual(bp.lines, [{ line: L.blank, verified: false }, { line: L.add, verified: true }, { line: L.call, verified: true }]);
    paused = await ev.next('paused');
    assert.strictEqual(paused.reason, 'breakpoint');
    assert.strictEqual(paused.thread, 'main');
    assert.deepStrictEqual(where(paused), [['Zoo', 'aufnehmen', L.add], ['Zoo', 'main', L.first]]);
    assert.strictEqual(paused.frames[0].file, 'Zoo.java');
    assert.strictEqual(paused.frames[0].index, 0);
  });

  await check('locals, this and its fields at the breakpoint', async () => {
    assert.deepStrictEqual(paused.variables.map((v) => v.name), ['this', 't']);
    const v = byName(paused.variables);
    assert.strictEqual(v.this.value.kind, 'object');
    assert.match(v.this.value.text, /^Zoo \(id=\d+\)$/);
    assert.strictEqual(v.t.type, 'Tier');
    assert.strictEqual(byName(paused.statics).zoos.value.text, '1');
    const fields = byName((await dbg.expand(v.this.value.objectId)).children);
    assert.deepStrictEqual(Object.keys(fields), ['name', 'besuche', 'tiere']);
    assert.deepStrictEqual(fields.name.value, { kind: 'string', text: '"Tierpark"' });
    assert.deepStrictEqual(fields.besuche.value, { kind: 'prim', text: '0' });
    assert.strictEqual(fields.tiere.type, 'ArrayList<Tier>');
    assert.strictEqual(fields.tiere.value.size, 0);
  });

  await check('replaced breakpoints: continue stops at the next one', async () => {
    await dbg.setBreakpoints({ Zoo: [L.call] });
    ev.clear('resumed');
    await dbg.resume();
    await ev.next('resumed');
    paused = await ev.next('paused');
    assert.strictEqual(paused.reason, 'breakpoint');
    assert.deepStrictEqual(where(paused), [['Zoo', 'main', L.call]]);
    const v = byName(paused.variables);
    assert.deepStrictEqual(Object.keys(v), ['args', 'zoo', 'zahlen', 'zeichen', 'anteil', 'gross', 'text']);
    assert.strictEqual(v.args.value.text, 'String[0]');
    assert.strictEqual(v.zahlen.value.kind, 'array');
    assert.strictEqual(v.zahlen.value.text, 'int[3]');
    assert.strictEqual(v.zahlen.value.size, 3);
    assert.strictEqual(v.zeichen.value.text, "'x'");
    assert.strictEqual(v.anteil.value.text, '0.5');
    assert.strictEqual(v.gross.value.text, '10000000000');
    assert.strictEqual(v.text.value.text, '"Hallo \\"Welt\\""');
  });

  await check('expand shows array and list elements', async () => {
    const v = byName(paused.variables);
    const arr = await dbg.expand(v.zahlen.value.objectId);
    assert.strictEqual(arr.kind, 'array');
    assert.deepStrictEqual(arr.children.map((c) => [c.name, c.type, c.value.text]), [['[0]', 'int', '4'], ['[1]', 'int', '8'], ['[2]', 'int', '15']]);
    const zoo = byName((await dbg.expand(v.zoo.value.objectId)).children);
    assert.strictEqual(zoo.tiere.value.size, 2);
    const list = await dbg.expand(zoo.tiere.value.objectId);
    assert.strictEqual(list.kind, 'list');
    assert.strictEqual(list.size, 2);
    assert.deepStrictEqual(list.children.map((c) => c.name), ['[0]', '[1]']);
    assert.match(list.children[0].value.text, /^Tier \(id=\d+\)$/);
    const bello = byName((await dbg.expand(list.children[0].value.objectId)).children);
    assert.strictEqual(bello.name.value.text, '"Bello"');
    assert.strictEqual(bello.alter.value.text, '3');
  });

  await check('stepInto enters the called method', async () => {
    await dbg.stepInto();
    paused = await ev.next('paused');
    assert.strictEqual(paused.reason, 'step');
    assert.deepStrictEqual(where(paused), [['Zoo', 'gesamtAlter', L.summe], ['Zoo', 'main', L.call]]);
  });

  await check('stepOver moves to the next line', async () => {
    await dbg.stepOver();
    paused = await ev.next('paused');
    assert.strictEqual(paused.frames[0].line, L.for);
    await dbg.stepOver();
    paused = await ev.next('paused');
    assert.strictEqual(paused.frames[0].line, L.loop);
    const v = byName(paused.variables);
    assert.strictEqual(v.summe.value.text, '0');
    assert.strictEqual(v.t.type, 'Tier');
  });

  await check('stepInto enters the other class', async () => {
    await dbg.stepInto();
    paused = await ev.next('paused');
    assert.deepStrictEqual(where(paused), [['Tier', 'getAlter', L.getAlter], ['Zoo', 'gesamtAlter', L.loop], ['Zoo', 'main', L.call]]);
    assert.strictEqual(byName(paused.variables).this.type, 'Tier');
  });

  await check('stepOut returns to the caller', async () => {
    await dbg.stepOut();
    paused = await ev.next('paused');
    assert.strictEqual(paused.reason, 'step');
    assert.deepStrictEqual(where(paused), [['Zoo', 'gesamtAlter', L.loop], ['Zoo', 'main', L.call]]);
  });

  await check('variables of a caller frame', async () => {
    const r = await dbg.variables(1);
    assert.strictEqual(r.frame, 1);
    assert.ok(byName(r.variables).zahlen);
    await assert.rejects(dbg.variables(7), /no frame 7/);
  });

  await check('step into a callback from library code and back out (println -> toString)', async () => {
    await dbg.setBreakpoints({ Zoo: [L.print] });
    await dbg.resume();
    paused = await ev.next('paused');
    assert.deepStrictEqual(where(paused), [['Zoo', 'main', L.print]]);
    await dbg.stepInto();
    paused = await ev.next('paused');
    assert.deepStrictEqual(where(paused), [['Tier', 'toString', L.toString], ['Zoo', 'main', L.print]]);
    await dbg.stepOver();
    paused = await ev.next('paused');
    assert.strictEqual(paused.frames[0].line, L.toStringEnd);
    assert.strictEqual(byName(paused.variables).s.value.text, '"Bello (3)"');
    // Off the end of toString, back out through String.valueOf and PrintStream.println. The
    // println call ends line L.print, so the next student location is the following line.
    await dbg.stepOver();
    paused = await ev.next('paused');
    assert.strictEqual(paused.reason, 'step');
    assert.deepStrictEqual(where(paused), [['Zoo', 'main', L.after]]);
  });

  await check('stepping off the end of a lambda stops in its next call (forEach)', async () => {
    await dbg.setBreakpoints({ Zoo: [L.lambda] });
    await dbg.resume();
    paused = await ev.next('paused');
    assert.strictEqual(paused.reason, 'breakpoint');
    assert.deepStrictEqual(where(paused).map((f) => f[2]), [L.lambda, L.after + 1]);
    const first = byName(paused.variables).t.value.objectId;
    await dbg.setBreakpoints({});
    for (const line of [L.lambdaPrint, L.lambdaEnd]) {
      await dbg.stepOver();
      paused = await ev.next('paused');
      assert.strictEqual(paused.frames[0].line, line);
    }
    await dbg.stepOver(); // out of the lambda into ArrayList.forEach, which calls it again
    paused = await ev.next('paused');
    assert.strictEqual(paused.reason, 'step');
    assert.deepStrictEqual(where(paused).map((f) => f[2]), [L.lambda, L.after + 1]);
    const second = byName(paused.variables).t.value;
    assert.notStrictEqual(second.objectId, first);
    assert.strictEqual(byName((await dbg.expand(second.objectId)).children).name.value.text, '"Minka"');
  });

  await check('resume runs to the end and vmDeath arrives', async () => {
    await dbg.setBreakpoints({});
    await dbg.resume();
    await ev.next('vmDeath');
    await within(prog.exited, 'program exit');
    assert.ok(prog.stdout.includes('Bello (3)'), prog.stdout);
    assert.ok(prog.stdout.includes('Alter: 8'), prog.stdout);
    await ev.next('exit');
    assert.strictEqual(dbg.attached, false);
  });

  // ---------------------------------------------------------------- inside the object bench, suspend=n

  let benchDir = path.join(tmp, 'bench');
  await check('bench compiles', () => {
    try {
      execFileSync(jdk.javac, ['--release', '11', '-encoding', 'UTF-8', '-Xlint:-options', '-d', benchDir, path.join(root, 'java', 'BlackJBench.java')], { stdio: 'pipe' });
    } catch (err) {
      benchDir = path.join(root, 'resources', 'bench'); // someone is editing the source: use the built one
      console.log('       (java/BlackJBench.java did not compile, using resources/bench)');
    }
    assert.ok(fs.existsSync(path.join(benchDir, 'BlackJBench.class')));
  });

  const benchRun = launch(['-XX:+IgnoreUnrecognizedVMOptions', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', benchDir, 'BlackJBench', classDir], { suspend: false });
  const bench = benchClient(benchRun);
  const dbg2 = new Debugger();
  const ev2 = recorder(dbg2, ['paused', 'resumed', 'vmDeath', 'breakpoints', 'exit']);
  dbg2.on('error', (e) => console.log('       debugger error: ' + e.message));
  const getAlter = () => bench.request('call', { target: 'tier1', key: 'getAlter()', args: [] });

  await check('attaches to the running bench', async () => {
    const port = await within(benchRun.port, 'JDWP port');
    const r = await dbg2.attach({ jdk, helperDir, port, classDir });
    assert.strictEqual(r.suspended, false);
    for (let i = 0; i < 100 && !bench.events.some((e) => e.event === 'ready'); i++) await sleep(50);
    assert.ok(bench.events.some((e) => e.event === 'ready'), 'bench ready');
  });

  await check('pause with no student code running', async () => {
    assert.deepStrictEqual(await dbg2.pause(), { paused: false });
  });

  await check("toString on the bench's helper thread does not stop", async () => {
    const r = await dbg2.setBreakpoints({ Tier: [L.getAlter, L.toString] });
    assert.deepStrictEqual(r.Tier.map((b) => b.verified), [null, null]);
    const made = await within(bench.request('new', { className: 'Tier', key: '<init>(java.lang.String,int)', args: [{ kind: 'text', text: '"Rex"' }, { kind: 'text', text: '7' }] }), 'new Tier');
    assert.strictEqual(made.name, 'tier1');
    assert.strictEqual(made.value.text, 'Rex (7)');
    const bp = await ev2.next('breakpoints');
    assert.deepStrictEqual(bp.lines.map((b) => b.verified), [true, true]);
    assert.strictEqual(ev2.count('paused'), 0);
  });

  await check('a breakpoint in a bench call stops only the student thread', async () => {
    const call = getAlter();
    const p = await ev2.next('paused');
    assert.strictEqual(p.thread, 'main');
    assert.strictEqual(p.reason, 'breakpoint');
    assert.deepStrictEqual(where(p), [['Tier', 'getAlter', L.getAlter]]);
    assert.strictEqual(await within(bench.request('ping'), 'ping while paused'), 'pong');
    await dbg2.stepOver(); // off the end of the called method: the call finishes
    assert.strictEqual((await within(call, 'getAlter reply')).value.text, '7');
    await sleep(300);
    assert.strictEqual(ev2.count('paused'), 0);
  });

  await check('the next call stops at the breakpoint again, not at a leftover step', async () => {
    const call = getAlter();
    const p = await ev2.next('paused');
    assert.strictEqual(p.reason, 'breakpoint');
    await dbg2.setBreakpoints({});
    await dbg2.resume();
    assert.strictEqual((await within(call, 'getAlter reply')).value.text, '7');
  });

  await check('pause stops a running student method, step and resume continue it', async () => {
    const call = bench.request('call', { className: 'Tier', key: 'warte(int)', args: [{ kind: 'text', text: '1500' }] });
    await sleep(400);
    assert.deepStrictEqual(await dbg2.pause(), { paused: true, thread: 'main' });
    let p = await ev2.next('paused');
    assert.strictEqual(p.reason, 'pause');
    assert.deepStrictEqual(p.frames.map((f) => f.method), ['warte']);
    assert.ok(byName(p.variables).runden, JSON.stringify(p.variables));
    await dbg2.stepOver();
    p = await ev2.next('paused');
    assert.strictEqual(p.reason, 'step');
    assert.deepStrictEqual(p.frames.map((f) => f.method), ['warte']);
    await dbg2.resume();
    assert.ok(Number((await within(call, 'warte reply')).value.text) > 0);
  });

  await check('an armed pause stops where the student code runs next (a window program waiting for a click)', async () => {
    ev2.clear('paused');
    ev2.clear('resumed');
    assert.deepStrictEqual(await dbg2.pause({ arm: true }), { paused: false, armed: true });
    await sleep(200);
    assert.strictEqual(ev2.count('paused'), 0, 'nothing ran yet');
    // The bench's own helper thread calls toString: that never stops.
    const call = getAlter();
    const p = await ev2.next('paused');
    assert.strictEqual(p.reason, 'pause');
    assert.strictEqual(p.thread, 'main');
    assert.deepStrictEqual(where(p), [['Tier', 'getAlter', L.getAlter]]);
    await dbg2.resume();
    assert.strictEqual((await within(call, 'getAlter reply')).value.text, '7');
  });

  await check('continue cancels a pause that waits for student code', async () => {
    ev2.clear('paused');
    ev2.clear('resumed');
    assert.deepStrictEqual(await dbg2.pause({ arm: true }), { paused: false, armed: true });
    assert.deepStrictEqual(await dbg2.resume(), { resumed: true });
    const r = await ev2.next('resumed');
    assert.strictEqual(r.reason, 'disarm');
    assert.strictEqual((await within(getAlter(), 'getAlter reply')).value.text, '7');
    await sleep(300);
    assert.strictEqual(ev2.count('paused'), 0);
  });

  await check('breakpoints in an anonymous class that loads later and in a package', async () => {
    const r = await dbg2.setBreakpoints({ Tier: [L.inner], 'tiere.Katze': [L.miau] });
    assert.deepStrictEqual(r, { Tier: [{ line: L.inner, verified: null }], 'tiere.Katze': [{ line: L.miau, verified: null }] });
    ev2.clear('breakpoints');
    let call = bench.request('call', { className: 'Tier', key: 'zaehle(int)', args: [{ kind: 'text', text: '21' }] });
    let p = await ev2.next('paused');
    assert.deepStrictEqual(where(p), [['Tier$1', 'getAsInt', L.inner], ['Tier', 'zaehle', L.innerCall]]);
    assert.deepStrictEqual(await ev2.next('breakpoints'), { event: 'breakpoints', className: 'Tier', lines: [{ line: L.inner, verified: true }] });
    await dbg2.resume();
    assert.strictEqual((await within(call, 'zaehle reply')).value.text, '42');
    call = bench.request('call', { className: 'tiere.Katze', key: 'miau(int)', args: [{ kind: 'text', text: '2' }] });
    p = await ev2.next('paused');
    assert.deepStrictEqual(where(p), [['tiere.Katze', 'miau', L.miau]]);
    assert.strictEqual(p.frames[0].path, 'tiere/Katze.java');
    await dbg2.setBreakpoints({});
    await dbg2.resume();
    assert.strictEqual((await within(call, 'miau reply')).value.text, 'MiauMiau');
  });

  await check('pause during heavy output never blocks the bench', async () => {
    const call = bench.request('call', { className: 'Tier', key: 'plappern(int)', args: [{ kind: 'text', text: '2500' }] });
    // On a busy machine the loop may finish before all rounds; a pause then finds nothing running.
    let rounds = 0;
    for (let i = 0; i < 6; i++) {
      await sleep(i === 0 ? 60 : 120);
      const r = await dbg2.pause();
      if (!r.paused) break;
      assert.deepStrictEqual(r, { paused: true, thread: 'main' });
      const p = await ev2.next('paused');
      assert.strictEqual(p.reason, 'pause');
      assert.deepStrictEqual(p.frames.map((f) => f.method), ['plappern']);
      assert.strictEqual(await within(bench.request('ping'), 'ping while paused in output (round ' + i + ')', 6000), 'pong');
      await dbg2.resume();
      rounds++;
    }
    assert.ok(rounds >= 1, 'paused at least once while it printed');
    assert.ok(Number((await within(call, 'plappern reply')).value.text) > 0);
  });

  await check('detach leaves the bench running', async () => {
    await dbg2.detach();
    assert.strictEqual(dbg2.attached, false);
    assert.strictEqual(await within(bench.request('ping'), 'ping after detach'), 'pong');
    benchRun.proc.stdin.end();
    await within(benchRun.exited, 'bench exit');
  });

  dbg.kill();
  dbg2.kill();
  for (const p of running) { try { p.kill(); } catch { /* gone */ } }
  await sleep(200);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
