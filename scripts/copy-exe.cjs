// After `electron-builder`: copies the portable exe to the project root as BlackJ.exe (for a USB
// stick) and the unpacked app to App\ (starts faster and never unpacks itself into C:\…\Temp).
// Both share D:\BlackJ\BlackJ-Daten for settings and D:\BlackJ\Projekte for projects.
const fs = require('fs');
const path = require('path');
const { version } = require('../package.json');

const root = path.join(__dirname, '..');
fs.copyFileSync(path.join(root, 'release', `BlackJ-${version}-portable.exe`), path.join(root, 'BlackJ.exe'));
fs.mkdirSync(path.join(root, 'BlackJ-Daten'), { recursive: true });
try {
  // Renaming fails while App\BlackJ.exe is running, so a running BlackJ is never touched.
  const app = path.join(root, 'App');
  if (fs.existsSync(app)) fs.renameSync(app, app + '.old');
  fs.cpSync(path.join(root, 'release', 'win-unpacked'), app, { recursive: true });
  fs.rmSync(app + '.old', { recursive: true, force: true });
  console.log('BlackJ.exe and App\\BlackJ.exe are up to date');
} catch (err) {
  console.log('BlackJ.exe is up to date. App\\ was left as it is (BlackJ is running): ' + err.code);
}
