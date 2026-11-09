// Starts and talks to the Java object bench (resources/bench/BlackJBench.class).
// One JSON message per line in both directions; see java/BlackJBench.java. The bench starts each
// of its lines with MARK, so anything else on stdout (the JDWP banner, a program writing straight
// to FileDescriptor.out, a JVM warning) is shown as output and can never break a message.
const { spawn, execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const { StringDecoder } = require('string_decoder');
const fs = require('fs');
const path = require('path');
const { parseJdwpPort } = require('./debugger.cjs');

const MARK = '\u001e';
/** A JVM that has not said "ready" by then hangs (a virus scanner, a full disk): it is started again. */
const READY_TIMEOUT = 30000;
const JDWP = '-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=127.0.0.1:0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The java launcher reads its arguments in the ANSI code page, so a folder name with other
 * characters (a user name in Cyrillic, say) would not arrive. Such a path is passed in its short
 * 8.3 form; everything else stays as it is.
 */
const shortPaths = new Map();
function launcherPath(p) {
  if (process.platform !== 'win32' || /^[\x20-\x7e]*$/.test(p)) return p;
  if (shortPaths.has(p)) return shortPaths.get(p);
  let out = p;
  try {
    // Verbatim: Node would escape the inner quotes for a C program, which cmd.exe does not understand.
    const s = execFileSync('cmd.exe', ['/d', '/s', '/c', `"for %A in ("${p}") do @echo %~sA"`], { windowsHide: true, windowsVerbatimArguments: true, encoding: 'utf8', timeout: 5000 }).trim();
    if (s && /^[\x20-\x7e]*$/.test(s) && fs.existsSync(s)) out = s;
  } catch { /* no short names on this drive: try the long one */ }
  shortPaths.set(p, out);
  return out;
}

/** Why a JVM did not come up: one readable line from what it printed, plus a code the window explains. */
function startReason(stderr, spawnError) {
  if (spawnError) return { code: spawnError.code === 'ENOENT' ? 'javaMissing' : 'spawn', detail: String(spawnError.message || spawnError) };
  const text = String(stderr || '');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const detail = lines.filter((l) => !/^\s*at /.test(l)).slice(0, 3).join(' · ').slice(0, 300);
  let code = 'unknown';
  if (/Could not find or load main class BlackJBench|ClassNotFoundException: BlackJBench/.test(text)) code = 'benchMissing';
  else if (/UnsupportedClassVersionError/.test(text)) code = 'oldJava';
  else if (/Could not reserve enough space|Initial heap size|Insufficient memory|OutOfMemoryError/i.test(text)) code = 'memory';
  else if (/jdwp|JDWP|transport|agent library/.test(text)) code = 'debugAgent';
  else if (/Error occurred during initialization of (VM|boot layer)/.test(text)) code = 'vmInit';
  return { code, detail };
}

class Bench extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.pending = new Map();
    this.seq = 0;
    this.buffer = '';
    this.decoder = null;
    this.jdwpPort = null;
    this.ready = false;
    // The start in progress; a newer start() or a stop() replaces it.
    this.token = null;
    // The bench said "shutdown": the program called System.exit (not a crash).
    this.systemExit = false;
    this.errTail = '';
  }

  get alive() {
    return !!this.proc;
  }

  get starting() {
    return !!this.token;
  }

  /**
   * Starts a fresh JVM for the classes in classDir (plus library jars) and resolves with the
   * bench's "ready" message. With debug, the JVM gets the JDWP agent. A JVM that does not come up
   * is started again, the last time without the agent (a JDK without it, a port that cannot
   * open). The error after the last try carries `reason` ({ code, detail }). A later start() or
   * stop() supersedes this one; it then rejects with `superseded`.
   */
  async start(opts) {
    this.stop();
    const token = {};
    this.token = token;
    const plans = opts.debug ? [true, true, false] : [false, false];
    let last = null;
    for (let i = 0; i < plans.length; i++) {
      if (this.token !== token) throw superseded();
      if (i > 0) {
        this.emit('retry', { attempt: i + 1, reason: last && last.reason });
        await sleep(250 * i);
        if (this.token !== token) throw superseded();
      }
      try {
        const ready = await this.launch(opts, plans[i], token);
        if (this.token === token) this.token = null;
        return ready;
      } catch (err) {
        if (err.superseded || this.token !== token) throw superseded();
        last = err;
        if (err.reason && (err.reason.code === 'javaMissing' || err.reason.code === 'oldJava')) break;
        // Most likely the debug agent: one more try without it.
        if (plans[i] && err.reason && err.reason.code === 'debugAgent') plans.splice(i + 1, plans.length, false);
      }
    }
    if (this.token === token) this.token = null;
    throw last;
  }

  launch({ jdk, benchDir, classDir, cwd, classpath = [], jvmArgs = [] }, debug, token) {
    return new Promise((resolve, reject) => {
      const args = [
        '-XX:+IgnoreUnrecognizedVMOptions',
        '-XX:+ShowCodeDetailsInExceptionMessages',
        '-Dfile.encoding=UTF-8',
        '-Dstdout.encoding=UTF-8',
        '-Dstderr.encoding=UTF-8',
        // System.console() reads the real stdin from JDK 22 on: that is the bench's protocol.
        '-Djdk.console=java.base',
        // Keep the student's own windows (Swing, AWT, JavaFX) off the graphics card.
        '-Dsun.java2d.d3d=false',
        '-Dsun.java2d.noddraw=true',
        '-Dprism.order=sw',
        ...(debug ? [JDWP] : []),
        ...jvmArgs,
        '-cp', launcherPath(benchDir),
        'BlackJBench',
      ];
      // The classpath goes through the environment: Java reads it with every character intact.
      const env = { ...process.env, BLACKJ_CP: [classDir, ...classpath].join(path.delimiter) };
      // Options a school set for its own Java programs can stop this JVM from starting.
      delete env.JAVA_TOOL_OPTIONS;
      delete env._JAVA_OPTIONS;
      delete env.JDK_JAVA_OPTIONS;
      let proc;
      try {
        proc = spawn(jdk.java, args, { cwd: cwd && fs.existsSync(cwd) ? cwd : undefined, windowsHide: true, env });
      } catch (err) {
        reject(Object.assign(new Error('bench could not start'), { reason: startReason('', err) }));
        return;
      }
      this.proc = proc;
      this.buffer = '';
      this.decoder = new StringDecoder('utf8');
      this.jdwpPort = null;
      this.ready = false;
      this.systemExit = false;
      this.errTail = '';
      let settled = false;
      let stderr = '';
      const timer = setTimeout(() => {
        settle(reject, Object.assign(new Error('bench did not start in time'), { reason: { code: 'timeout', detail: stderr.trim().slice(0, 300) } }));
        if (this.proc === proc) this.proc = null;
        try { proc.kill(); } catch { /* gone */ }
      }, READY_TIMEOUT);
      const settle = (fn, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.waitReady === onReady) this.waitReady = null;
        fn(v);
      };
      const onReady = (msg) => {
        this.ready = true;
        settle(resolve, msg);
      };
      this.waitReady = onReady;
      proc.stdin.on('error', () => { /* the JVM is gone; 'exit' tells */ });
      proc.stdout.on('data', (chunk) => this.onData(proc, chunk));
      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        // Before "ready" it is start-up noise (or why the start failed): not the program's output.
        if (!settled) {
          stderr = (stderr + text).slice(-6000);
          return;
        }
        if (proc !== this.proc) return;
        this.errTail = (this.errTail + text).slice(-4000);
        this.emit('out', { stream: 'err', text });
      });
      const gone = (code, signal, spawnError) => {
        if (!settled) {
          const replaced = this.token !== token;
          settle(reject, Object.assign(new Error('bench did not start'), { code, superseded: replaced, reason: startReason(stderr, spawnError) }));
        }
        if (this.proc !== proc) return;
        // The JVM ended by itself (System.exit, a crash): everyone waiting gets an answer.
        const wasReady = this.ready;
        this.proc = null;
        this.ready = false;
        this.rejectPending(code);
        if (wasReady) this.emit('exit', { code, signal, systemExit: this.systemExit, reason: this.systemExit ? null : startReason(this.errTail) });
      };
      // A java.exe that cannot start reports 'error' and maybe no 'exit'.
      proc.on('error', (err) => gone(null, null, err));
      proc.on('exit', (code, signal) => gone(code, signal));
    });
  }

  onData(proc, chunk) {
    if (proc !== this.proc) return;
    const text = this.buffer + this.decoder.write(chunk);
    let start = 0;
    let nl;
    while ((nl = text.indexOf('\n', start)) >= 0) {
      const line = text.slice(start, nl);
      start = nl + 1;
      const at = line.lastIndexOf(MARK);
      if (at < 0) {
        const clean = line.replace(/\r$/, '');
        // The debug agent announces its port before the bench starts; that line is not program output.
        const port = !this.jdwpPort && parseJdwpPort(clean);
        if (port) {
          this.jdwpPort = port;
          this.emit('jdwp', { port });
        } else if (this.ready) this.emit('out', { stream: 'out', text: clean + '\n' });
        continue;
      }
      // Text in front of the mark was written straight to stdout, without a line break.
      if (at > 0) this.emit('out', { stream: 'out', text: line.slice(0, at) });
      let msg;
      try {
        msg = JSON.parse(line.slice(at + 1));
      } catch {
        continue;
      }
      this.dispatch(msg);
      if (proc !== this.proc) return;
    }
    this.buffer = text.slice(start);
  }

  dispatch(msg) {
    if (msg.event) {
      if (msg.event === 'ready' && this.waitReady) this.waitReady(msg);
      if (msg.event === 'shutdown') this.systemExit = true;
      this.emit(msg.event, msg);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(Object.assign(new Error(msg.error && (msg.error.code || msg.error.type) || 'error'), { bench: msg.error }));
  }

  request(cmd, payload = {}) {
    if (!this.proc) return Promise.reject(Object.assign(new Error('bench not running'), { notRunning: true }));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        // The payload never overrides the request's own id and command.
        this.proc.stdin.write(JSON.stringify({ ...payload, id, cmd }) + '\n');
      } catch {
        this.pending.delete(id);
        reject(Object.assign(new Error('bench not running'), { notRunning: true }));
      }
    });
  }

  rejectPending(code) {
    for (const { reject } of this.pending.values()) reject(Object.assign(new Error('bench stopped'), { benchExit: true, code }));
    this.pending.clear();
  }

  /** Ends the JVM (and with it every window of the program) and any start in progress. */
  stop() {
    this.token = null;
    const proc = this.proc;
    this.proc = null;
    this.ready = false;
    this.rejectPending(null);
    if (!proc) return;
    try { proc.kill(); } catch { /* already gone */ }
  }
}

function superseded() {
  return Object.assign(new Error('bench start superseded'), { superseded: true });
}

module.exports = { Bench, MARK, startReason, launcherPath };
