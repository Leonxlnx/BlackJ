// Starts and talks to the Java object bench (resources/bench/BlackJBench.class).
// One JSON message per line in both directions; see java/BlackJBench.java.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { parseJdwpPort } = require('./debugger.cjs');

class Bench extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.pending = new Map();
    this.seq = 0;
    this.buffer = '';
    this.readyPromise = null;
  }

  get alive() {
    return !!this.proc;
  }

  /** Starts a fresh JVM for the classes in classDir (plus library jars). Resolves once the bench is ready. */
  start({ jdk, benchDir, classDir, cwd, classpath = [], jvmArgs = [] }) {
    this.stop();
    const args = [
      '-XX:+IgnoreUnrecognizedVMOptions',
      '-XX:+ShowCodeDetailsInExceptionMessages',
      '-Dfile.encoding=UTF-8',
      '-Dstdout.encoding=UTF-8',
      '-Dstderr.encoding=UTF-8',
      // Keep the student's own windows (Swing, AWT, JavaFX) off the graphics card.
      '-Dsun.java2d.d3d=false',
      '-Dsun.java2d.noddraw=true',
      '-Dprism.order=sw',
      ...jvmArgs,
      '-cp', benchDir,
      'BlackJBench',
      [classDir, ...classpath].join(require('path').delimiter),
    ];
    const proc = spawn(jdk.java, args, { cwd, windowsHide: true });
    this.proc = proc;
    this.buffer = '';
    this.jdwpPort = null;
    this.readyPromise = new Promise((resolve, reject) => {
      const onReady = (msg) => resolve(msg);
      this.once('ready', onReady);
      proc.once('exit', (code) => {
        this.off('ready', onReady);
        reject(new Error('bench exited with code ' + code));
      });
    });
    proc.stdout.on('data', (chunk) => this.onData(chunk));
    proc.stderr.on('data', (chunk) => this.emit('out', { stream: 'err', text: chunk.toString('utf8') }));
    proc.on('error', (err) => this.emit('out', { stream: 'err', text: String(err) + '\n' }));
    proc.on('exit', (code, signal) => {
      if (this.proc !== proc) return;
      this.proc = null;
      for (const { reject } of this.pending.values()) reject(Object.assign(new Error('bench stopped'), { benchExit: true, code }));
      this.pending.clear();
      this.emit('exit', { code, signal });
    });
    return this.readyPromise;
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        // The debug agent announces its port before the bench starts; that line is not program output.
        const port = parseJdwpPort(line);
        if (port) {
          this.jdwpPort = port;
          this.emit('jdwp', { port });
        } else this.emit('out', { stream: 'out', text: line + '\n' });
        continue;
      }
      if (msg.event) {
        this.emit(msg.event, msg);
        continue;
      }
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(Object.assign(new Error(msg.error && (msg.error.code || msg.error.type) || 'error'), { bench: msg.error }));
    }
  }

  request(cmd, payload = {}) {
    if (!this.proc) return Promise.reject(Object.assign(new Error('bench not running'), { notRunning: true }));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...payload }) + '\n');
    });
  }

  stop() {
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = null;
    for (const { reject } of this.pending.values()) reject(Object.assign(new Error('bench stopped'), { benchExit: true }));
    this.pending.clear();
    try { proc.kill(); } catch { /* already gone */ }
  }
}

module.exports = { Bench };
