'use strict';
// HTTP + WebSocket relay. Serves the single client page at /r/<token>, and
// bridges ONE authenticated browser client to the operator's terminal.
//
// Containment / hardening:
//   * Binds 127.0.0.1 only — never directly reachable; Caddy is the sole front.
//   * Only the exact /r/<token> path returns anything; all else is 404. No file
//     serving at all, so the link can't be used to read the filesystem.
//   * Single session: once one client authenticates, others are refused.
//   * Auth is HMAC challenge/response — the raw password never crosses the wire.
//   * Tripwire: too many wrong-password attempts self-destructs the link.
//   * Burn-after-session: when the client leaves, the link dies (optional grace).
//   * Zero third-party code (uses ./wslite, which is stdlib-only).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { timingSafeEqual } = require('crypto');
const wslite = require('./wslite');
const c = require('./crypto');

const INDEX = path.join(__dirname, '..', 'public', 'index.html');
const MAX_PENDING = 4; // unauthenticated sockets held at once

class Relay extends EventEmitter {
  constructor({ token, salt, keys, port = 0, maxFails = 10, burnOnDisconnect = true, graceSec = 30 }) {
    super();
    this.token = token;
    this.salt = salt;
    this.keys = keys;
    this.port = port; // 0 => OS picks a free port
    this.maxFails = maxFails;
    this.burnOnDisconnect = burnOnDisconnect;
    this.graceSec = graceSec;

    this.basePath = `/r/${token}`;
    this.active = null;
    this.pending = new Set();
    this.failCount = 0;
    this.msgId = 0;
    this.tampered = false;
    this.graceTimer = null;
    this.destroyed = false;
    this.index = fs.readFileSync(INDEX);

    this.server = http.createServer((req, res) => this._onHttp(req, res));
    this.server.on('upgrade', (req, sock, head) => this._onUpgrade(req, sock, head));
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  _onHttp(req, res) {
    const url = (req.url || '').split('?')[0];
    if (req.method === 'GET' && (url === this.basePath || url === this.basePath + '/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(this.index);
      return;
    }
    if (req.method === 'GET' && url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
  }

  _onUpgrade(req, socket, head) {
    const url = (req.url || '').split('?')[0];
    if (this.destroyed || url !== this.basePath + '/ws') { socket.destroy(); return; }

    if (this.active || this.pending.size >= MAX_PENDING) {
      const conn = wslite.accept(req, socket, head);
      if (conn) { conn.send(JSON.stringify({ t: 'busy' })); conn.close(1013, 'session in use'); }
      return;
    }
    const conn = wslite.accept(req, socket, head);
    if (conn) this._onClient(conn);
  }

  _onClient(conn) {
    conn.authed = false;
    conn.challenge = c.randomB64u(32);
    this.pending.add(conn);

    const authTimer = setTimeout(() => { if (!conn.authed) conn.close(4001, 'auth timeout'); }, 15000);

    conn.send(JSON.stringify({ t: 'hello', salt: this.salt, challenge: conn.challenge }));

    conn.on('message', async (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }

      if (m.t === 'auth' && !conn.authed) {
        const ok = await this._verify(conn.challenge, m.proof);
        if (!ok) {
          this.failCount += 1;
          this.emit('auth-fail', this.failCount);
          conn.send(JSON.stringify({ t: 'auth-fail' }));
          conn.close(4003, 'bad password');
          if (this.failCount >= this.maxFails) this.emit('selfdestruct', `${this.failCount} failed password attempts`);
          return;
        }
        if (this.active) { conn.send(JSON.stringify({ t: 'busy' })); conn.close(1013, 'session in use'); return; }
        conn.authed = true;
        this.pending.delete(conn);
        this.active = conn;
        clearTimeout(authTimer);
        if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
        conn.send(JSON.stringify({ t: 'auth-ok' }));
        this.emit('client-online');
      } else if (m.t === 'msg' && conn.authed && conn === this.active) {
        // A frame that will not authenticate under the session key is an
        // injection/key-change attempt — fail closed, don't silently drop.
        let text;
        try { text = await c.decrypt(this.keys.encKey, m.data); }
        catch { return this._tamper('a message failed key authentication'); }
        this.emit('message', text);
      } else if (m.t === 'typing' && conn.authed && conn === this.active) {
        this.emit('client-typing', !!m.on);
      } else if (m.t === 'ack' && conn.authed && conn === this.active) {
        this.emit('ack', { id: m.id | 0, state: m.state === 'read' ? 'read' : 'delivered' });
      } else if (m.t === 'tamper' && conn.authed && conn === this.active) {
        this._tamper('the client detected a key change');
      }
    });

    conn.on('close', () => {
      clearTimeout(authTimer);
      this.pending.delete(conn);
      if (conn === this.active) {
        this.active = null;
        this.emit('client-offline');
        if (this.burnOnDisconnect && !this.destroyed) {
          if (this.graceSec <= 0) {
            this.emit('selfdestruct', 'client left');
          } else {
            this.graceTimer = setTimeout(() => this.emit('selfdestruct', 'client left'), this.graceSec * 1000);
          }
        }
      }
    });
  }

  async _verify(challengeB64, proofB64) {
    if (typeof proofB64 !== 'string') return false;
    let expected, got;
    try {
      expected = await c.sign(this.keys.macKey, c.fromB64u(challengeB64));
      got = Buffer.from(c.fromB64u(proofB64));
    } catch { return false; }
    if (expected.length !== got.length) return false;
    return timingSafeEqual(expected, got);
  }

  async sendToClient(text) {
    if (!this.active) return 0;
    const id = ++this.msgId;
    this.active.send(JSON.stringify({ t: 'msg', id, data: await c.encrypt(this.keys.encKey, text) }));
    return id;
  }

  sendTyping(on) {
    if (this.active) this.active.send(JSON.stringify({ t: 'typing', on: !!on }));
  }

  // Key-change / tamper: flip the client to red, tell the operator, then burn.
  _tamper(reason) {
    if (this.tampered || this.destroyed) return;
    this.tampered = true;
    try { if (this.active) this.active.send(JSON.stringify({ t: 'tamper' })); } catch {}
    this.emit('tamper', reason);
    this.emit('selfdestruct', 'KEYS CHANGED — ' + reason);
  }

  hasClient() { return !!this.active; }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
    const bye = (conn) => { try { conn.send(JSON.stringify({ t: 'destroyed' })); conn.close(4008, 'link destroyed'); } catch {} };
    if (this.active) bye(this.active);
    this.pending.forEach(bye);
    this.pending.clear();
    this.active = null;
    try { this.server.close(); } catch {}
  }
}

module.exports = { Relay };
