// Downloads the JUnit jars into resources/junit from Maven Central and checks each one
// against the .sha1 file published next to it (and against the hash pinned below).
// Jars that are already there with the right hash are skipped, so running it twice is harmless.
// Run with: node scripts/fetch-junit.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = 'https://repo1.maven.org/maven2/';
const JARS = [
  { path: 'org/junit/platform/junit-platform-console-standalone/1.11.4/junit-platform-console-standalone-1.11.4.jar', sha1: '44650aaff63a4dbb63cb0bf0f3725a4eb9406da1' },
  { path: 'junit/junit/4.13.2/junit-4.13.2.jar', sha1: '8ac9e16d933b6fb43bc7f576336b8f4d7eb5ba12' },
  { path: 'org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar', sha1: '42a25dc3219429f0e5d060061f71acb49bf010a0' },
];
const dir = path.join(__dirname, '..', 'resources', 'junit');

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchJar(jar) {
  const name = path.basename(jar.path);
  const file = path.join(dir, name);
  if (fs.existsSync(file) && sha1(fs.readFileSync(file)) === jar.sha1) return console.log('  ok   ' + name + ' (already there)');
  const url = REPO + jar.path;
  // A .sha1 file holds the hex hash, sometimes followed by the file name.
  const published = (await get(url + '.sha1')).toString('ascii').trim().split(/\s+/)[0].toLowerCase();
  if (published !== jar.sha1) throw new Error(name + ': Maven Central publishes ' + published + ', expected ' + jar.sha1);
  const data = await get(url);
  const actual = sha1(data);
  if (actual !== published) throw new Error(name + ': downloaded file has SHA-1 ' + actual + ', expected ' + published);
  fs.writeFileSync(file + '.part', data);
  fs.renameSync(file + '.part', file);
  console.log('  ok   ' + name + ' (downloaded, ' + Math.round(data.length / 1024) + ' KB, SHA-1 checked)');
}

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  let failures = 0;
  for (const jar of JARS) {
    try {
      await fetchJar(jar);
    } catch (err) {
      failures++;
      console.log('  FAIL ' + (err && err.message || err));
    }
  }
  process.exit(failures ? 1 : 0);
})();
