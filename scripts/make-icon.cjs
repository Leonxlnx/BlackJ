// Renders resources/icon.png (512×512) from the BlackJ mark: a J being typed, the text cursor
// right after it. Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const SIZE = 512;
const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${SIZE}px;height:${SIZE}px;border-radius:${SIZE * 0.225}px;background:#18181b;box-shadow:inset 0 0 0 ${SIZE / 128}px #2c2c31;display:grid;place-items:center">
<svg viewBox="0 0 32 32" width="${SIZE * 0.72}" height="${SIZE * 0.72}">
  <path d="M19.6 5.5V18.2a6.1 6.1 0 0 1-12.2 0" fill="none" stroke="#f4f4f5" stroke-width="4.4"/>
  <rect x="24.2" y="5.5" width="2.8" height="20.8" fill="#e8913a"/>
</svg></div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = path.join(__dirname, '..', 'resources', 'icon.png');
  fs.writeFileSync(out, img.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG());
  console.log('wrote', out, img.getSize());
  app.quit();
});
