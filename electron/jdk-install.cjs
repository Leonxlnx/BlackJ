// No Java on this PC: BlueJ ships its own JDK, BlackJ fetches one on request. Eclipse Temurin 21
// (the same JDK BlueJ bundles) comes from the Adoptium API, is checked against its SHA-256 and
// unpacked into BlackJ's own data folder, where jdk.cjs finds it.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const API = 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse';
// The API itself and the downloads it links to (GitHub releases, which redirect to GitHub's file host).
const HOSTS = ['api.adoptium.net', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

function fail(code, message) {
  return Object.assign(new Error(message || code), { code });
}

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !HOSTS.includes(u.hostname)) return reject(fail('jdkDownload', 'unexpected host ' + u.hostname));
    const req = https.get(u, { headers: { 'User-Agent': 'BlackJ' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, u).toString(), redirects - 1));
      } else if (res.statusCode !== 200) {
        res.resume();
        reject(fail('jdkDownload', 'HTTP ' + res.statusCode));
      } else resolve(res);
    });
    req.on('timeout', () => req.destroy(fail('jdkDownload', 'timeout')));
    req.on('error', (err) => reject(fail('jdkDownload', err.message)));
  });
}

async function getJson(url) {
  const res = await get(url);
  let body = '';
  res.setEncoding('utf8');
  for await (const chunk of res) body += chunk;
  return JSON.parse(body);
}

async function download(url, file, total, onProgress) {
  const res = await get(url);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let received = 0;
  let last = 0;
  for await (const chunk of res) {
    hash.update(chunk);
    received += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (Date.now() - last > 250) {
      last = Date.now();
      onProgress({ phase: 'download', received, total });
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  return hash.digest('hex');
}

function untar(zip, dir) {
  // Windows 10 and 11 ship bsdtar, which unpacks zip files.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return new Promise((resolve, reject) => {
    const p = spawn(tar, ['-xf', zip, '-C', dir], { windowsHide: true });
    let log = '';
    p.stderr.on('data', (d) => { log += d; });
    p.on('error', (err) => reject(fail('jdkUnpack', err.message)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(fail('jdkUnpack', log.slice(0, 300)))));
  });
}

/** Downloads, checks and unpacks the JDK into `dir`; resolves with the JDK's home folder. */
async function installJdk({ dir, onProgress = () => {} }) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw fail('jdkUnsupported');
  onProgress({ phase: 'lookup' });
  const list = await getJson(API);
  const pkg = Array.isArray(list) && list[0] && list[0].binary && list[0].binary.package;
  if (!pkg || !/\.zip$/i.test(pkg.name) || !/^[a-f0-9]{64}$/i.test(pkg.checksum || '')) throw fail('jdkDownload', 'no package');
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, path.basename(pkg.name));
  const unpack = path.join(dir, 'unpack');
  try {
    const sha = await download(pkg.link, zip, pkg.size, onProgress);
    if (sha.toLowerCase() !== pkg.checksum.toLowerCase()) throw fail('jdkChecksum');
    onProgress({ phase: 'unpack' });
    fs.rmSync(unpack, { recursive: true, force: true });
    fs.mkdirSync(unpack);
    await untar(zip, unpack);
    const top = fs.readdirSync(unpack).find((d) => fs.existsSync(path.join(unpack, d, 'bin', 'javac.exe')));
    if (!top) throw fail('jdkUnpack', 'no javac');
    const home = path.join(dir, top);
    fs.rmSync(home, { recursive: true, force: true });
    fs.renameSync(path.join(unpack, top), home);
    return home;
  } finally {
    fs.rmSync(zip, { force: true });
    fs.rmSync(unpack, { recursive: true, force: true });
  }
}

module.exports = { installJdk, API };
