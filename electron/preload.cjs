// The only bridge between the window and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);
const listen = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.off(channel, fn);
};

contextBridge.exposeInMainWorld('blackj', {
  init: invoke('app:init'),
  setSettings: invoke('settings:set'),
  chooseJdk: invoke('jdk:choose'),
  autoJdk: invoke('jdk:auto'),
  installJdk: invoke('jdk:install'),
  onJdkProgress: listen('jdk:progress'),
  saveText: invoke('file:saveText'),
  print: {
    source: invoke('print:source'),
    diagram: invoke('print:diagram'),
  },
  project: {
    openDialog: invoke('project:openDialog'),
    open: invoke('project:open'),
    example: invoke('project:example'),
    exercise: invoke('project:exercise'),
    create: invoke('project:create'),
    write: invoke('project:write'),
    createClass: invoke('project:createClass'),
    deleteClass: invoke('project:deleteClass'),
    positions: invoke('project:positions'),
    reveal: invoke('project:reveal'),
    createPackage: invoke('project:createPackage'),
    rename: invoke('project:rename'),
    exportJar: invoke('project:exportJar'),
    exportZip: invoke('project:exportZip'),
    javadoc: invoke('project:javadoc'),
    saveAs: invoke('project:saveAs'),
    addFiles: invoke('project:addFiles'),
    openZipDialog: invoke('project:openZipDialog'),
  },
  compile: invoke('compile'),
  bench: {
    describe: invoke('bench:describe'),
    create: invoke('bench:new'),
    call: invoke('bench:call'),
    main: invoke('bench:main'),
    inspect: invoke('bench:inspect'),
    store: invoke('bench:store'),
    remove: invoke('bench:remove'),
    list: invoke('bench:list'),
    stdin: invoke('bench:stdin'),
    pad: invoke('bench:pad'),
    padReset: invoke('bench:padReset'),
    inspectClass: invoke('bench:inspectClass'),
    reset: invoke('bench:reset'),
    onOut: listen('bench:out'),
    onState: listen('bench:state'),
  },
  ai: {
    status: invoke('ai:status'),
    setKey: invoke('ai:setKey'),
    forgetKey: invoke('ai:forgetKey'),
    newChat: invoke('ai:newChat'),
    send: invoke('ai:send'),
    continue: invoke('ai:continue'),
    stop: invoke('ai:stop'),
    complete: invoke('ai:complete'),
    edit: invoke('ai:edit'),
    editStop: invoke('ai:editStop'),
    toolResult: invoke('ai:toolResult'),
    onEvent: listen('ai:event'),
    onTool: listen('ai:tool'),
  },
  diagram: {
    savePng: invoke('diagram:savePng'),
  },
  windowTheme: invoke('window:theme'),
  // Pop-out windows: open and close them (main window), and the message relay between windows.
  panel: {
    open: invoke('panel:open'),
    close: invoke('panel:close'),
    show: invoke('panel:show'),
    focusMain: invoke('panel:focusMain'),
    send: (msg) => ipcRenderer.send('panel:send', msg),
    onMessage: listen('panel:message'),
  },
  onOpenPath: listen('app:openPath'),
  onProjectChanged: listen('project:changed'),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  tests: {
    run: invoke('tests:run'),
  },
  debug: {
    setBreakpoints: invoke('debug:setBreakpoints'),
    resume: invoke('debug:resume'),
    stepOver: invoke('debug:stepOver'),
    stepInto: invoke('debug:stepInto'),
    stepOut: invoke('debug:stepOut'),
    pause: invoke('debug:pause'),
    variables: invoke('debug:variables'),
    expand: invoke('debug:expand'),
    detach: invoke('debug:detach'),
    onEvent: listen('debug:event'),
  },
  openExternal: invoke('shell:open'),
  smoke: {
    capture: invoke('smoke:capture'),
    resize: invoke('smoke:resize'),
    writeFile: invoke('smoke:writeFile'),
    panelEval: invoke('smoke:panelEval'),
    log: invoke('smoke:log'),
    done: invoke('smoke:done'),
  },
});
