'use strict';
// End-to-end tests. The client here is the real `ws` library (dev-only), which
// also validates that our stdlib-only src/wslite.js server speaks correct
// RFC 6455 to a mature implementation. Run: npm test
const http = require('http');
const WebSocket = require('ws');
const c = require('../src/crypto');
const { Relay } = require('../src/server');
const { extractUrl } = require('../src/tunnel');

const PASSWORD = 'correct horse battery';
let pass = 0, fail = 0;
const ok = (name, cond) => (cond ? (pass++, console.log('  ok   ' + name)) : (fail++, console.log('  FAIL ' + name)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(port, path) {
  return new Promise((res) => {
    http.get({ host: '127.0.0.1', port, path }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b }));
    }).on('error', () => res({ status: 0, body: '' }));
  });
}

// A browser-shaped client mirroring public/index.html.
function client(url, password) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const api = { ws, authed: false, busy: false, authFail: false, tampered: false, received: [], msgIds: [], typings: [], keys: null };
    ws.on('message', async (buf) => {
      const m = JSON.parse(buf.toString());
      if (m.t === 'hello') {
        api.keys = await c.deriveKeys(password, m.salt);
        const proof = c.toB64u(await c.sign(api.keys.macKey, c.fromB64u(m.challenge)));
        ws.send(JSON.stringify({ t: 'auth', proof }));
      } else if (m.t === 'auth-ok') { api.authed = true; resolve(api); }
      else if (m.t === 'auth-fail') { api.authFail = true; resolve(api); }
      else if (m.t === 'busy') { api.busy = true; resolve(api); }
      else if (m.t === 'msg') { api.msgIds.push(m.id); api.received.push(await c.decrypt(api.keys.encKey, m.data)); }
      else if (m.t === 'typing') { api.typings.push(!!m.on); }
      else if (m.t === 'tamper') { api.tampered = true; }
    });
    ws.on('close', () => { if (!api.authed && !api.authFail && !api.busy) resolve(api); });
    ws.on('error', () => {});
  });
}

async function makeRelay(opts = {}) {
  const token = c.randomB64u(24);
  const salt = c.randomB64u(16);
  const keys = await c.deriveKeys(PASSWORD, salt);
  const relay = new Relay({ token, salt, keys, port: 0, ...opts });
  const port = await relay.listen();
  return {
    relay, token, port,
    base: `/r/${token}`,
    wsUrl: `ws://127.0.0.1:${port}/r/${token}/ws`,
  };
}

async function main() {
  // ---- core happy path + gate ----
  {
    const r = await makeRelay();
    ok('auto-port bound to a real port', r.port > 0);
    ok('correct token serves page', (await httpGet(r.port, r.base)).status === 200);
    ok('wrong token 404s', (await httpGet(r.port, `/r/${c.randomB64u(24)}`)).status === 404);
    ok('arbitrary path 404s (no file serving)', (await httpGet(r.port, '/etc/passwd')).status === 404);

    const fromClient = [];
    r.relay.on('message', (t) => fromClient.push(t));

    const bad = await client(r.wsUrl, 'nope');
    ok('wrong password rejected', bad.authFail && !bad.authed);
    await wait(30);

    const a = await client(r.wsUrl, PASSWORD);
    ok('correct password authenticates (wslite<->ws interop)', a.authed === true);

    a.ws.send(JSON.stringify({ t: 'msg', data: await c.encrypt(a.keys.encKey, 'hi from browser') }));
    await wait(60);
    ok('operator decrypts client message', fromClient.includes('hi from browser'));

    await r.relay.sendToClient('hi from terminal');
    await wait(60);
    ok('client decrypts operator message', a.received.includes('hi from terminal'));

    const xss = '<img src=x onerror=alert(1)>';
    await r.relay.sendToClient(xss);
    await wait(60);
    ok('payload integrity (html-ish text intact)', a.received.includes(xss));
    ok('operator messages carry incrementing ids', a.msgIds.length >= 2 && a.msgIds.every((n) => n > 0));

    // receipts + typing
    let ack = null;
    r.relay.once('ack', (x) => (ack = x));
    a.ws.send(JSON.stringify({ t: 'ack', id: a.msgIds[0], state: 'read' }));
    await wait(50);
    ok('client read-receipt relays to operator', ack && ack.id === a.msgIds[0] && ack.state === 'read');

    let clientTyping = null;
    r.relay.once('client-typing', (on) => (clientTyping = on));
    a.ws.send(JSON.stringify({ t: 'typing', on: true }));
    await wait(50);
    ok('client typing relays to operator', clientTyping === true);

    r.relay.sendTyping(true);
    await wait(50);
    ok('operator typing reaches client', a.typings.includes(true));

    const b = await client(r.wsUrl, PASSWORD);
    ok('second client refused (single session)', b.busy && !b.authed);

    r.relay.destroy();
    await wait(30);
    ok('server down after destroy', (await httpGet(r.port, r.base)).status === 0);
  }

  // ---- tripwire: too many wrong passwords self-destructs ----
  {
    const r = await makeRelay({ maxFails: 3 });
    let reason = null;
    r.relay.once('selfdestruct', (why) => (reason = why));
    for (let i = 0; i < 3; i++) { await client(r.wsUrl, 'wrong-' + i); await wait(20); }
    await wait(30);
    ok('tripwire fires after N wrong passwords', typeof reason === 'string' && /failed password/.test(reason));
    r.relay.destroy();
  }

  // ---- burn-after-session: client leaving destroys the link ----
  {
    const r = await makeRelay({ burnOnDisconnect: true, graceSec: 0 });
    let reason = null;
    r.relay.once('selfdestruct', (why) => (reason = why));
    const a = await client(r.wsUrl, PASSWORD);
    ok('client authenticated before burn test', a.authed === true);
    a.ws.close();
    await wait(60);
    ok('burn-on-disconnect fires when client leaves', reason === 'client left');
    r.relay.destroy();
  }

  // ---- grace window tolerates a reconnect ----
  {
    const r = await makeRelay({ burnOnDisconnect: true, graceSec: 2 });
    let destroyed = false;
    r.relay.once('selfdestruct', () => (destroyed = true));
    const a = await client(r.wsUrl, PASSWORD);
    a.ws.close();
    await wait(200);                       // within grace
    const again = await client(r.wsUrl, PASSWORD);
    ok('reconnect within grace succeeds', again.authed === true);
    await wait(2200);                      // past original grace
    ok('grace cancelled by reconnect (not destroyed)', destroyed === false);
    r.relay.destroy();
  }

  // ---- tunnel URL parsing (no network / no cloudflared needed) ----
  {
    const line = '2026-... INF |  https://calm-frost-1234.trycloudflare.com  |';
    ok('tunnel parses the public URL', extractUrl(line) === 'https://calm-frost-1234.trycloudflare.com');
    ok('tunnel ignores unrelated output', extractUrl('Starting tunnel…') === null);
  }

  // ---- safety code: deterministic per key, differs by password ----
  {
    const salt = c.randomB64u(16);
    const k1 = await c.deriveKeys('hunter2 hunter2 hunter2', salt);
    const k2 = await c.deriveKeys('hunter2 hunter2 hunter2', salt);
    const k3 = await c.deriveKeys('a different password!!', salt);
    const s1 = await c.safetyCode(k1.macKey);
    const s2 = await c.safetyCode(k2.macKey);
    const s3 = await c.safetyCode(k3.macKey);
    ok('safety code is stable for the same key', s1 === s2 && /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(s1));
    ok('safety code changes with the password', s1 !== s3);
  }

  // ---- key-change / tamper: a forged frame trips red + self-destruct ----
  {
    const r = await makeRelay();
    let tamper = null, boom = null;
    r.relay.once('tamper', (why) => (tamper = why));
    r.relay.once('selfdestruct', (why) => (boom = why));
    const a = await client(r.wsUrl, PASSWORD);
    a.ws.send(JSON.stringify({ t: 'msg', data: 'this-will-not-authenticate' }));
    await wait(80);
    ok('forged frame trips tamper on the operator', typeof tamper === 'string');
    ok('tamper triggers self-destruct', /KEYS CHANGED/.test(boom || ''));
    ok('client is told keys changed', a.tampered === true);
    r.relay.destroy();
  }

  // ---- client-reported tamper reaches the operator ----
  {
    const r = await makeRelay();
    let tamper = null;
    r.relay.once('tamper', (why) => (tamper = why));
    const a = await client(r.wsUrl, PASSWORD);
    a.ws.send(JSON.stringify({ t: 'tamper' }));
    await wait(60);
    ok('client-reported tamper reaches operator', /client detected/.test(tamper || ''));
    r.relay.destroy();
  }

  // ---- preflight reports this environment ----
  ok('preflight sees a supported node', require('../src/preflight').check().node.ok === true);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
