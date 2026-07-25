#!/usr/bin/env node
'use strict';
// Downloads the helper binaries SMSproxy needs — caddy (TLS/reverse-proxy) and
// cloudflared (optional public tunnel) — for THIS platform into ./vendor/.
// Uses Node's stdlib https so it works even without curl/wget. Run by install.sh.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OS = process.platform === 'darwin' ? 'darwin' : 'linux'; // win not supported
const ARCH = process.arch === 'arm64' ? 'arm64' : 'amd64';     // x64 -> amd64
const VENDOR = path.join(__dirname, '..', 'vendor');
fs.mkdirSync(VENDOR, { recursive: true });

function isExec(p) { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }

function download(url, dest) {
  return new Promise((resolve, reject) => {
    (function get(u, n) {
      if (n > 8) return reject(new Error('too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'smsproxy-installer' } }, (r) => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode)) { r.resume(); return get(r.headers.location, n + 1); }
        if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
        const f = fs.createWriteStream(dest);
        r.pipe(f);
        f.on('finish', () => f.close(() => resolve(fs.statSync(dest).size)));
        f.on('error', reject);
      }).on('error', reject);
    })(url, 0);
  });
}

async function getCaddy() {
  const dest = path.join(VENDOR, 'caddy');
  if (isExec(dest)) return console.log('  caddy        already present');
  process.stdout.write('  caddy        downloading… ');
  const size = await download(`https://caddyserver.com/api/download?os=${OS}&arch=${ARCH}`, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`ok (${(size / 1e6).toFixed(0)} MB)`);
}

async function getCloudflared() {
  const dest = path.join(VENDOR, 'cloudflared');
  if (isExec(dest)) return console.log('  cloudflared  already present');
  process.stdout.write('  cloudflared  downloading… ');
  if (OS === 'darwin') {
    const tgz = path.join(VENDOR, 'cloudflared.tgz');
    await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${ARCH}.tgz`, tgz);
    const r = spawnSync('tar', ['-xzf', tgz, '-C', VENDOR], { stdio: 'ignore' });
    fs.unlinkSync(tgz);
    if (r.status !== 0) throw new Error('could not extract cloudflared tarball (need tar)');
  } else {
    await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}`, dest);
  }
  fs.chmodSync(dest, 0o755);
  console.log('ok');
}

(async () => {
  console.log(`\nFetching helpers for ${OS}/${ARCH} into vendor/`);
  try { await getCaddy(); } catch (e) { console.error('  caddy        FAILED — ' + e.message + '\n               get it at https://caddyserver.com/download'); }
  try { await getCloudflared(); } catch (e) { console.error('  cloudflared  FAILED — ' + e.message + '\n               (only needed for tunnel mode)'); }
  const okC = isExec(path.join(VENDOR, 'caddy'));
  const okT = isExec(path.join(VENDOR, 'cloudflared'));
  console.log(`\n  result: caddy ${okC ? '✓' : '✗'}   cloudflared ${okT ? '✓' : '✗'}`);
  process.exit(0);
})();
