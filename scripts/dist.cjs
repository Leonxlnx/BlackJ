// Packages BlackJ with every download cache inside the project (D:\BlackJ\.cache), not on C:.
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const env = {
  ...process.env,
  ELECTRON_CACHE: path.join(root, '.cache', 'electron'),
  ELECTRON_BUILDER_CACHE: path.join(root, '.cache', 'electron-builder'),
};
execSync('npx electron-builder --win portable', { cwd: root, env, stdio: 'inherit' });
require('./copy-exe.cjs');
