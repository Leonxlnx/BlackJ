// BlackJ main process: the window, the project on disk, javac, the Java object bench and the AI tutor.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { findJdks, asJdk } = require('./jdk.cjs');
const { compile } = require('./compiler.cjs');
const { Bench } = require('./bench.cjs');
const project = require('./project.cjs');
const { Settings } = require('./settings.cjs');
const { Tutor } = require('./ai.cjs');
const tests = require('./tests.cjs');
const { Debugger } = require('./debugger.cjs');

// The window is drawn without the graphics card: some school PCs (and this one) have GPU
// drivers that crash, and an editor does not need hardware acceleration.
app.disableHardwareAcceleration();

const smokeArg = process.argv.find((a) => a.startsWith('--smoke='));
const smokeDir = smokeArg ? path.resolve(smokeArg.slice('--smoke='.length)) : null;
if (smokeDir) {
  app.setPath('userData', path.join(smokeDir, 'profile'));
  // Keep painting although the test window sits off-screen.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

/**
 * Portable data: settings, compiled classes and the browser cache live in a "BlackJ-Daten"
 * folder next to the app (or one folder up), so nothing lands on C: when BlackJ runs from D:
 * or a USB stick. If that place is not writable (a school network share), AppData is used.
 */
function portableDataDir() {
  if (!app.isPackaged) return null;
  const base = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  for (const dir of [base, path.dirname(base)]) {
    const d = path.join(dir, 'BlackJ-Daten');
    if (fs.existsSync(d)) return d;
  }
  const d = path.join(base, 'BlackJ-Daten');
  try {
    fs.mkdirSync(d, { recursive: true });
    fs.accessSync(d, fs.constants.W_OK);
    return d;
  } catch {
    return null;
  }
}
const dataDir = smokeDir ? null : portableDataDir();
if (dataDir) app.setPath('userData', dataDir);
const projectsHome = () => (smokeDir ? path.join(smokeDir, 'projects') : dataDir ? path.join(path.dirname(dataDir), 'Projekte') : path.join(app.getPath('documents'), 'BlackJ'));

if (!smokeDir && !app.requestSingleInstanceLock()) app.quit();

const resDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources');
const benchDir = path.join(resDir, 'bench');
const examplesDir = path.join(resDir, 'examples');
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : null);

let win = null;
let settings = null;
let tutor = null;
const bench = new Bench();
const state = { dir: null, outDir: null, compiled: false, jdk: null };

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ------------------------------------------------------------------ bench output, batched

const outBuffer = [];
let outTimer = null;
function queueOut(stream, text) {
  const last = outBuffer[outBuffer.length - 1];
  if (last && last.stream === stream) last.text += text;
  else outBuffer.push({ stream, text });
  if (!outTimer) outTimer = setTimeout(flushOut, 30);
}

function flushOut() {
  clearTimeout(outTimer);
  outTimer = null;
  if (outBuffer.length) send('bench:out', outBuffer.splice(0));
}

// Output always reaches the window before the state change it belongs to (a prompt before "waiting").
bench.on('out', (m) => queueOut(m.stream, m.text));
bench.on('running', (m) => {
  flushOut();
  send('bench:state', { state: m.running ? 'running' : 'idle' });
});
bench.on('waitingForInput', () => {
  flushOut();
  send('bench:state', { state: 'waiting' });
});
bench.on('exit', ({ code }) => {
  send('bench:state', { state: 'exit', code });
  // The program ended the JVM (System.exit or a crash): start a fresh one so the bench keeps working.
  if (state.compiled) startBench().catch(() => {});
});

function chooseJdk() {
  const jdks = findJdks({ preferred: settings.get().jdkPath, portableDir });
  state.jdk = jdks[0] || null;
  return jdks;
}

/** Library jars for compiling and running: the project's +libs folder and BlackJ's JUnit jars. */
function projectClasspath() {
  const junitDir = path.join(resDir, 'junit');
  const junit = fs.existsSync(junitDir) ? fs.readdirSync(junitDir).filter((f) => f.endsWith('.jar')).map((f) => path.join(junitDir, f)) : [];
  return [...(state.dir ? project.libsOf(state.dir) : []), ...junit];
}

// ------------------------------------------------------------------ debugger
// The bench always runs with the JDWP agent (cheap); the JDI helper only attaches once the
// student sets a breakpoint or asks to pause, and again after every bench restart.

let debug = null;
let breakpoints = {};

async function attachDebugger() {
  if (debug && debug.attached) return debug;
  if (!bench.alive || !bench.jdwpPort) return null;
  const d = new Debugger();
  debug = d;
  for (const ev of ['paused', 'resumed', 'vmDeath', 'error']) d.on(ev, (msg) => send('debug:event', { ...msg, event: ev }));
  d.on('exit', () => {
    if (debug === d) debug = null;
    send('debug:event', { event: 'detached' });
  });
  try {
    await d.attach({ jdk: state.jdk, helperDir: benchDir, port: bench.jdwpPort, classDir: state.outDir });
    await d.setBreakpoints(breakpoints);
    send('debug:event', { event: 'attached' });
    return d;
  } catch (err) {
    if (debug === d) debug = null;
    send('debug:event', { event: 'error', message: String(err.message) });
    return null;
  }
}

function hasBreakpoints() {
  return Object.values(breakpoints).some((l) => l.length);
}

async function startBench() {
  if (!state.jdk || !state.outDir) return null;
  if (debug) debug.kill();
  debug = null;
  const ready = await bench.start({
    jdk: state.jdk,
    benchDir,
    classDir: state.outDir,
    cwd: state.dir,
    classpath: projectClasspath(),
    jvmArgs: ['-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=127.0.0.1:0'],
  });
  send('bench:state', { state: 'ready', java: ready.java });
  if (hasBreakpoints()) attachDebugger();
  return ready;
}

function buildDir(dir) {
  const id = crypto.createHash('sha1').update(dir.toLowerCase()).digest('hex').slice(0, 12);
  return path.join(app.getPath('userData'), 'build', id, 'classes');
}

function openProject(dir) {
  const data = project.open(dir);
  bench.stop();
  state.dir = data.dir;
  state.outDir = buildDir(data.dir);
  state.compiled = false;
  if (!smokeDir) settings.addRecent(data.dir, data.name);
  return data;
}

function fail(err) {
  if (err && err.bench) return { ok: false, error: err.bench };
  const code = err && err.benchExit ? 'stopped' : err && err.notRunning ? 'notRunning' : (err && err.code) || 'error';
  return { ok: false, error: { kind: 'app', code, message: err && err.message } };
}

async function wrap(fn) {
  try {
    return { ok: true, result: await fn() };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------------ IPC

function registerIpc() {
  ipcMain.handle('app:init', () => {
    const jdks = chooseJdk();
    return {
      version: app.getVersion(),
      settings: settings.get(),
      jdk: state.jdk,
      jdks,
      examples: fs.existsSync(examplesDir) ? fs.readdirSync(examplesDir).filter((n) => fs.statSync(path.join(examplesDir, n)).isDirectory()) : [],
      tutor: tutor.status(),
      smoke: !!smokeDir,
      platform: process.platform,
    };
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    const s = settings.set(patch);
    if (patch && 'jdkPath' in patch) chooseJdk();
    return s;
  });

  ipcMain.handle('jdk:choose', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'JDK-Ordner wählen' });
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: { code: 'canceled' } };
    const jdk = asJdk(r.filePaths[0], 'settings');
    if (!jdk) return { ok: false, error: { code: 'noJdk' } };
    settings.set({ jdkPath: jdk.home });
    chooseJdk();
    return { ok: true, result: { jdk: state.jdk, jdks: findJdks({ preferred: jdk.home, portableDir }) } };
  });

  ipcMain.handle('jdk:auto', () => {
    settings.set({ jdkPath: null });
    const jdks = chooseJdk();
    return { jdk: state.jdk, jdks };
  });

  ipcMain.handle('project:openDialog', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Projektordner öffnen' });
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: { code: 'canceled' } };
    return wrap(() => openProject(r.filePaths[0]));
  });

  ipcMain.handle('project:open', (_e, dir) => wrap(() => {
    if (!fs.existsSync(dir)) throw Object.assign(new Error('missing'), { code: 'missing' });
    return openProject(dir);
  }));

  ipcMain.handle('project:example', (_e, name) => wrap(() => {
    const src = path.join(examplesDir, path.basename(name));
    const target = project.copyExample(src, projectsHome());
    return openProject(target);
  }));

  ipcMain.handle('project:create', async (_e, name) => {
    const defaultPath = projectsHome();
    fs.mkdirSync(defaultPath, { recursive: true });
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Wo soll das Projekt liegen?', defaultPath });
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: { code: 'canceled' } };
    return wrap(() => openProject(project.createProject(r.filePaths[0], name)));
  });

  ipcMain.handle('project:write', (_e, { name, content }) => wrap(() => project.writeFile(state.dir, name, content)));
  ipcMain.handle('project:createClass', (_e, { className, content }) => wrap(() => project.createClass(state.dir, className, content)));
  ipcMain.handle('project:deleteClass', (_e, { name }) => wrap(async () => {
    await shell.trashItem(project.safeFile(state.dir, name));
    state.compiled = false;
    bench.stop();
  }));
  ipcMain.handle('project:positions', (_e, positions) => wrap(() => project.savePositions(state.dir, positions)));
  ipcMain.handle('project:reveal', () => (state.dir ? shell.openPath(state.dir) : null));

  ipcMain.handle('compile', async () => {
    if (!state.dir) return fail({ code: 'noProject' });
    if (!state.jdk) return fail({ code: 'noJdk' });
    if (debug) debug.kill();
    bench.stop();
    state.compiled = false;
    const files = project.listJavaFiles(state.dir).map((rel) => path.join(state.dir, ...rel.split('/')));
    const r = await compile({ jdk: state.jdk, projectDir: state.dir, outDir: state.outDir, files, classpath: projectClasspath() });
    if (r.ok) {
      state.compiled = true;
      try {
        await startBench();
      } catch (err) {
        return { ok: true, result: { ...r, benchError: String(err.message) } };
      }
    } else {
      send('bench:state', { state: 'stopped' });
    }
    return { ok: true, result: r };
  });

  ipcMain.handle('project:createPackage', (_e, { name }) => wrap(() => project.createPackage(state.dir, name)));

  ipcMain.handle('tests:run', async (_e, { select }) => {
    if (!state.compiled) return fail({ code: 'notCompiled' });
    const r = await tests.runTests({ jdk: state.jdk, resDir, classDir: state.outDir, cwd: state.dir, classpath: project.libsOf(state.dir), select });
    if (r.error && !r.tests.length) return fail({ code: 'tests', message: r.error.message });
    return { ok: true, result: r };
  });

  ipcMain.handle('project:exportJar', async (_e, { mainClass, includeSource }) => {
    if (!state.compiled) return fail({ code: 'notCompiled' });
    const r = await dialog.showSaveDialog(win, {
      title: 'Als JAR-Datei exportieren',
      defaultPath: path.join(path.dirname(state.dir), path.basename(state.dir) + '.jar'),
      filters: [{ name: 'Java-Archiv', extensions: ['jar'] }],
    });
    if (r.canceled || !r.filePath) return fail({ code: 'canceled' });
    const jarExe = path.join(state.jdk.home, 'bin', process.platform === 'win32' ? 'jar.exe' : 'jar');
    const args = ['--create', '--file', r.filePath];
    if (mainClass) args.push('--main-class', mainClass);
    args.push('-C', state.outDir, '.');
    if (includeSource) for (const rel of project.listJavaFiles(state.dir)) args.push('-C', state.dir, rel.split('/').join(path.sep));
    return new Promise((resolve) => {
      let out = '';
      const p = require('child_process').spawn(jarExe, args, { windowsHide: true });
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('error', (err) => resolve(fail(err)));
      p.on('close', (code) => resolve(code === 0 ? { ok: true, result: { file: r.filePath } } : fail({ code: 'jarFailed', message: out })));
    });
  });

  const benchCall = (cmd) => (_e, payload) => wrap(() => bench.request(cmd, payload));
  for (const cmd of ['describe', 'new', 'call', 'main', 'inspect', 'store', 'remove', 'list', 'stdin', 'pad', 'padReset', 'inspectClass']) {
    ipcMain.handle('bench:' + cmd, benchCall(cmd));
  }
  ipcMain.handle('bench:reset', () => wrap(async () => {
    if (debug) debug.kill();
    bench.stop();
    if (state.compiled) await startBench();
  }));

  ipcMain.handle('debug:setBreakpoints', (_e, { breakpoints: map }) => wrap(async () => {
    breakpoints = map || {};
    if (debug && debug.attached) return debug.setBreakpoints(breakpoints);
    if (hasBreakpoints()) await attachDebugger();
    return null;
  }));
  for (const cmd of ['resume', 'stepOver', 'stepInto', 'stepOut']) {
    ipcMain.handle('debug:' + cmd, () => wrap(() => (debug ? debug[cmd]() : null)));
  }
  ipcMain.handle('debug:pause', () => wrap(async () => {
    const d = await attachDebugger();
    return d ? d.pause() : null;
  }));
  ipcMain.handle('debug:variables', (_e, { frame }) => wrap(() => debug.variables(frame)));
  ipcMain.handle('debug:expand', (_e, { objectId }) => wrap(() => debug.expand(objectId)));
  ipcMain.handle('debug:detach', () => wrap(() => (debug ? debug.detach() : null)));

  ipcMain.handle('ai:status', () => tutor.status());
  ipcMain.handle('ai:setKey', (_e, { key, remember }) => wrap(() => tutor.setKey(key, remember)));
  ipcMain.handle('ai:forgetKey', () => tutor.forgetKey());
  ipcMain.handle('ai:newChat', (_e, opts) => tutor.newChat(opts));
  ipcMain.handle('ai:send', (_e, req) => {
    tutor.send(req).catch((err) => send('ai:event', { turnId: req.turnId, type: 'error', code: err.code || 'unknown', message: String(err.message) }));
    return true;
  });
  ipcMain.handle('ai:stop', () => tutor.stop());
  ipcMain.handle('ai:complete', (_e, req) => tutor.complete(req));
  ipcMain.handle('ai:edit', (_e, req) => wrap(() => tutor.edit(req)));

  // The window draws its own title bar; the native buttons follow the app's theme.
  ipcMain.handle('window:theme', (_e, theme) => {
    if (!win || process.platform !== 'win32') return;
    const dark = theme !== 'light';
    try {
      win.setTitleBarOverlay({ color: dark ? '#171719' : '#f9fafb', symbolColor: dark ? '#bdbdc0' : '#3d3f43', height: 40 });
      win.setBackgroundColor(dark ? '#171719' : '#f9fafb');
    } catch { /* overlay not available */ }
  });

  const allowed = ['https://console.anthropic.com', 'https://platform.claude.com', 'https://adoptium.net', 'https://www.bluej.org', 'https://docs.oracle.com', 'https://dev.java'];
  ipcMain.handle('shell:open', (_e, url) => {
    if (typeof url === 'string' && allowed.some((a) => url === a || url.startsWith(a + '/'))) shell.openExternal(url);
  });

  // Smoke test: the renderer drives a scripted session and asks for screenshots.
  ipcMain.handle('smoke:capture', async (_e, name) => {
    if (!smokeDir) return null;
    // The off-screen window paints lazily: the first capture returns the previous frame.
    win.webContents.invalidate();
    await win.webContents.capturePage();
    await new Promise((r) => setTimeout(r, 250));
    const img = await win.webContents.capturePage();
    const file = path.join(smokeDir, name + '.png');
    fs.writeFileSync(file, img.toPNG());
    return file;
  });
  ipcMain.handle('smoke:log', (_e, line) => {
    if (smokeDir) fs.appendFileSync(path.join(smokeDir, 'smoke.log'), line + '\n');
  });
  ipcMain.handle('smoke:done', (_e, code) => {
    if (smokeDir) setTimeout(() => app.exit(code || 0), 200);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: settings.get().theme === 'light' ? '#f9fafb' : '#171719',
    title: 'BlackJ',
    icon: path.join(resDir, 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: settings.get().theme === 'light'
      ? { color: '#f9fafb', symbolColor: '#3d3f43', height: 40 }
      : { color: '#171719', symbolColor: '#bdbdc0', height: 40 },
    skipTaskbar: !!smokeDir,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !smokeDir,
    },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost:5291') && !url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  win.once('ready-to-show', () => {
    if (!smokeDir) return win.show();
    // Smoke test: a real, painted window, but placed off-screen and without focus.
    win.setPosition(-3200, 40);
    win.showInactive();
  });
  if (process.env.BLACKJ_DEV) win.loadURL('http://localhost:5291');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  tutor = new Tutor({ dir: app.getPath('userData'), safeStorage, emit: (ev) => send('ai:event', ev) });
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (debug) debug.kill();
  bench.stop();
  app.quit();
});

app.on('before-quit', () => {
  if (debug) debug.kill();
  bench.stop();
});
