// Debugger for the student's code running in the bench JVM. The bench is started with a JDWP
// agent; this starts the helper JVM (java/BlackJDebug.java) that attaches to it. One JSON
// message per line in both directions, like bench.cjs; see java/BlackJDebug.java.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

/** The port from JDWP's "Listening for transport dt_socket at address: 55555" line, or null. */
function parseJdwpPort(text) {
  const m = /Listening for transport dt_socket at address:\s*(?:[^\s:]*:)?(\d+)/.exec(String(text || ''));
  return m ? Number(m[1]) : null;
}

class Debugger extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.pending = new Map();
    this.seq = 0;
    this.buffer = '';
    this.lastError = '';
  }

  get attached() {
    return !!this.proc;
  }

  /**
   * Starts the helper and attaches it to the JVM listening on port. Resolves with the init
   * reply { vm, version, suspended } (suspended: started with suspend=y, waits for resume()).
   */
  attach({ jdk, helperDir, port, classDir }) {
    this.kill();
    const args = ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-cp', helperDir, 'BlackJDebug', String(port)];
    const proc = spawn(jdk.java, args, { windowsHide: true });
    this.proc = proc;
    this.buffer = '';
    this.lastError = '';
    proc.stdout.on('data', (chunk) => this.onData(chunk));
    proc.stderr.on('data', (chunk) => { this.lastError = (this.lastError + chunk.toString('utf8')).slice(-2000); });
    const gone = (code, signal) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.rejectAll(code);
      this.emit('exit', { code, signal });
    };
    // A java.exe that cannot start reports 'error' and maybe no 'exit'.
    proc.on('error', (err) => { this.lastError = String(err); gone(null, null); });
    proc.on('exit', gone);
    return this.request('init', { classDir });
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
        continue;
      }
      if (msg.event) {
        if (msg.event === 'error') this.lastError = msg.message || '';
        // An 'error' without listeners would throw in EventEmitter.
        if (msg.event !== 'error' || this.listenerCount('error') > 0) this.emit(msg.event, msg);
        continue;
      }
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(Object.assign(new Error(msg.error && msg.error.message || 'error'), { debug: msg.error }));
    }
  }

  request(cmd, payload = {}) {
    if (!this.proc) return Promise.reject(Object.assign(new Error('debugger not attached'), { notAttached: true }));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...payload }) + '\n');
    });
  }

  rejectAll(code) {
    const why = this.lastError.trim();
    for (const { reject } of this.pending.values()) {
      reject(Object.assign(new Error('debugger stopped' + (why ? ': ' + why : '')), { debuggerExit: true, code }));
    }
    this.pending.clear();
  }

  /** Replaces all breakpoints: { "Hund": [12, 15], "tiere.Katze": [8] }. Resolves per class with [{ line, verified }]. */
  setBreakpoints(map) {
    return this.request('setBreakpoints', { breakpoints: map || {} });
  }

  resume() {
    return this.request('resume');
  }

  stepOver() {
    return this.request('stepOver');
  }

  stepInto() {
    return this.request('stepInto');
  }

  stepOut() {
    return this.request('stepOut');
  }

  /** Stops the student's thread that is running. Resolves with { paused } ('paused' event follows). */
  pause() {
    return this.request('pause');
  }

  /** Re-reads a frame of the paused thread (index into the paused event's frames): { frame, variables, statics }. */
  variables(frame = 0) {
    return this.request('variables', { frame });
  }

  /** Fields of an object, or elements of an array or list: { objectId, type, kind, size?, more?, children }. */
  expand(objectId) {
    return this.request('expand', { objectId });
  }

  /** Removes all breakpoints, lets the program run on and stops the helper. */
  detach() {
    const proc = this.proc;
    if (!proc) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.kill(); resolve(); }, 3000);
      proc.once('exit', () => { clearTimeout(timer); resolve(); });
      this.request('detach').catch(() => {});
    });
  }

  kill() {
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = null;
    this.rejectAll(null);
    try { proc.kill(); } catch { /* already gone */ }
  }
}

module.exports = { Debugger, parseJdwpPort };
