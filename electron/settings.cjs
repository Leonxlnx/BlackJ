// Settings live in one JSON file in the user's app data folder.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  lang: 'de',
  theme: 'dark',
  fontSize: 14,
  hoverHelp: true,
  autosave: true,
  diagramDetails: true,
  scopeColors: true,
  aiInline: true,
  aiOff: false,
  exercisesDone: [],
  showUses: true,
  clearConsoleOnCall: false,
  jdkPath: null,
  model: 'claude-opus-5-5',
  tutorMode: 'hints',
  sendContext: true,
  agentWrite: false,
  showCosts: false,
  rememberKey: true,
  recent: [],
  windowBounds: null,
  panelBounds: {},
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch { /* first start */ }
  }

  get() {
    return { ...this.data };
  }

  set(patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (k in DEFAULTS) this.data[k] = v;
    }
    this.save();
    return this.get();
  }

  addRecent(dir, name) {
    const recent = this.data.recent.filter((r) => r.dir.toLowerCase() !== dir.toLowerCase());
    recent.unshift({ dir, name, opened: new Date().toISOString() });
    this.data.recent = recent.slice(0, 8);
    this.save();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch { /* read-only profile: keep settings for this session only */ }
  }
}

module.exports = { Settings, DEFAULTS };
