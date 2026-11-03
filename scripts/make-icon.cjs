// Renders resources/icon.png (256×256) from the BlackJ mark. Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:256px;height:256px;border-radius:58px;background:#171719;display:grid;place-items:center">
<svg viewBox="0 0 32 32" width="176" height="176">
  <ellipse cx="16" cy="16" rx="9.5" ry="13" transform="rotate(32 16 16)" fill="#e8913a"/>
  <path d="M10.2 25.4c3.6-2.6 2.1-6.9 5.5-9.6 3.4-2.7 4.4-6.8 6.1-9.2" fill="none" stroke="#171719" stroke-width="2.2" stroke-linecap="round"/>
</svg></div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const out = path.join(__dirname, '..', 'resources', 'icon.png');
  fs.writeFileSync(out, img.resize({ width: 256, height: 256 }).toPNG());
  console.log('wrote', out, img.getSize());
  app.quit();
});
