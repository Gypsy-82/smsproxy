'use strict';
// Cloudflare quick tunnel: spawns `cloudflared` and resolves the public
// https://<random>.trycloudflare.com URL it prints. No account, no domain;
// a fresh URL every run, and it dies when we kill the child.
const { spawn } = require('child_process');
const vendor = require('./vendor');

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

// Pull the public URL out of a chunk of cloudflared output (exported for tests).
function extractUrl(s) {
  const m = String(s).match(URL_RE);
  return m ? m[0] : null;
}

// originUrl e.g. "http://127.0.0.1:8080" — where the tunnel forwards traffic.
function startTunnel(originUrl) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(vendor.resolve('cloudflared'), ['tunnel', '--no-autoupdate', '--url', originUrl], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) { return reject(e); }

    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };

    const scan = (buf) => {
      const url = extractUrl(buf.toString());
      if (url) finish(resolve, { child, url });
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('error', (e) => finish(reject, e));
    child.on('exit', (code) => finish(reject, new Error(`cloudflared exited (${code}) before a URL appeared`)));

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      finish(reject, new Error('timed out waiting for the tunnel URL (is cloudflared installed?)'));
    }, 30000);
  });
}

module.exports = { startTunnel, extractUrl };
