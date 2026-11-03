// Renders resources/icon.png (512×512) from the BlackJ mark: a blackjack, the Ace of spades and
// the black Jack, on the orange tile. Same picture as Mark in src/components/Icon.jsx.
// Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const SIZE = 512;
const font = 'file:///' + path.join(__dirname, '..', 'node_modules', '@fontsource', 'public-sans', 'files', 'public-sans-latin-900-normal.woff2').split(path.sep).join('/');
const SPADE = 'M10 0C7.4 3.4 0 7.6 0 13.2c0 3.6 2.9 5.8 6 5.1 1.3-.3 2.4-1 3.1-2-.2 2.6-1.3 4.7-3.2 6.7h8.2c-1.9-2-3-4.1-3.2-6.7.7 1 1.8 1.7 3.1 2 3.1.7 6-1.5 6-5.1C20 7.6 12.6 3.4 10 0z';
const html = `<!doctype html><html><head><style>@font-face{font-family:'Public Sans';font-weight:900;src:url(${font})}
body{margin:0;background:transparent}</style></head><body>
<svg viewBox="0 0 100 100" width="${SIZE}" height="${SIZE}" style="display:block">
  <rect width="100" height="100" rx="22.5" fill="#e8913a"/>
  <g transform="rotate(-15 36 56)">
    <rect x="12" y="16" width="46" height="66" rx="6.5" fill="#f6f4ef"/>
    <text x="25" y="37" font-family="Public Sans" font-weight="900" font-size="20" fill="#141416" text-anchor="middle">A</text>
    <path d="${SPADE}" fill="#141416" transform="translate(20.25 41) scale(0.475)"/>
  </g>
  <g transform="rotate(11 64 52)">
    <rect x="40" y="17" width="46" height="66" rx="6.5" fill="#141416" stroke="#e8913a" stroke-width="3.5"/>
    <text x="63" y="64" font-family="Public Sans" font-weight="900" font-size="52" fill="#f6f4ef" text-anchor="middle">J</text>
  </g>
</svg></body></html>`;

app.whenReady().then(async () => {
  const file = path.join(__dirname, '..', '.cache', 'icon.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadFile(file);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = path.join(__dirname, '..', 'resources', 'icon.png');
  fs.writeFileSync(out, img.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG());
  console.log('wrote', out, img.getSize());
  app.quit();
});
