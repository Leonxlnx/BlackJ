// Renders the BlackJ app icon (near-black squircle, white geometric J): resources/icon.png (512)
// and resources/icon.ico. At 16 and 20px the J is drawn heavier (stroke 14) and the hairline
// brighter (0.2) so the letter does not thin out and the tile stays visible on dark taskbars.
// Run with: node_modules/electron/dist/electron.exe scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();

const svg = (N) => {
  const small = N <= 20;
  return `<svg viewBox="0 0 100 100" width="${N}" height="${N}" style="display:block">
    <rect width="100" height="100" rx="23" fill="#0a0a0b"/>
    ${small ? '<rect x="2.5" y="2.5" width="95" height="95" rx="20.5" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="5"/>' : '<rect x="0.75" y="0.75" width="98.5" height="98.5" rx="22.25" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.5"/>'}
    <path d="M64 23V57a14 14 0 0 1-28 0" fill="none" stroke="#f4f4f5" stroke-width="${small ? 14 : 12}" stroke-linecap="butt"/></svg>`;
};
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}
async function render(win, size) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><body style="margin:0;background:transparent">${svg(size)}</body>`));
  await new Promise((r) => setTimeout(r, 150));
  return (await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })).toPNG();
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  const res = path.join(__dirname, '..', 'resources');
  fs.writeFileSync(path.join(res, 'icon.png'), await render(win, 512));
  const pngs = [];
  for (const size of ICO_SIZES) pngs.push({ size, data: await render(win, size) });
  fs.writeFileSync(path.join(res, 'icon.ico'), ico(pngs));
  console.log('wrote icon.png and icon.ico (' + ICO_SIZES.join(', ') + ')');
  app.quit();
});
