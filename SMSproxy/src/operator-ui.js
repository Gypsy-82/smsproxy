'use strict';
// Local operator UI (browser mode). Serves public/operator.html on 127.0.0.1
// and bridges the operator's browser to the relay over a plaintext localhost
// WebSocket. The relay is still the crypto endpoint that talks (encrypted) to
// the target — this is purely a local GUI, so plaintext here never leaves the
// machine. A random token in the local URL keeps other local processes out.
const http = require('http');
const fs = require('fs');
const path = require('path');
const wslite = require('./wslite');
const c = require('./crypto');

const PAGE = path.join(__dirname, '..', 'public', 'operator.html');

class OperatorUI {
  constructor({ relay, safety, host = '127.0.0.1', port = 0 }) {
    this.relay = relay;
    this.safety = safety || '';
    this.host = host;
    this.wantPort = port;
    this.localToken = c.randomB64u(9);
    this.basePath = `/o/${this.localToken}`;
    this.conn = null;
    this.port = 0;
    this.page = fs.readFileSync(PAGE);
    this.server = http.createServer((req, res) => this._http(req, res));
    this.server.on('upgrade', (req, sock, head) => this._upgrade(req, sock, head));
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.wantPort, this.host, () => { this.port = this.server.address().port; resolve(this.port); });
    });
  }

  url() { return `http://127.0.0.1:${this.port}${this.basePath}`; }

  _http(req, res) {
    const u = (req.url || '').split('?')[0];
    if (req.method === 'GET' && (u === this.basePath || u === this.basePath + '/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(this.page);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  }

  _upgrade(req, socket, head) {
    const u = (req.url || '').split('?')[0];
    if (u !== this.basePath + '/ws') { socket.destroy(); return; }
    if (this.conn) { // one operator browser at a time
      const dupe = wslite.accept(req, socket, head);
      if (dupe) dupe.close(1013, 'operator already open');
      return;
    }
    const conn = wslite.accept(req, socket, head);
    if (!conn) return;
    this.conn = conn;
    this._send({ t: 'ready', safety: this.safety, online: this.relay.hasClient() });
    conn.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'msg' && typeof m.text === 'string' && m.text) this.relay.sendToClient(m.text);
      else if (m.t === 'typing') this.relay.sendTyping(!!m.on);
    });
    conn.on('close', () => { if (this.conn === conn) this.conn = null; });
  }

  _send(obj) { if (this.conn) { try { this.conn.send(JSON.stringify(obj)); } catch {} } }

  // relay -> operator browser
  onMessage(text) { this._send({ t: 'msg', text }); }
  onPeer(online) { this._send({ t: 'peer', online }); }
  onTyping(on) { this._send({ t: 'typing', on }); }
  onTamper() { this._send({ t: 'tamper' }); }
  onDestroyed() { this._send({ t: 'destroyed' }); }

  close() {
    try { if (this.conn) this.conn.close(4008, 'closed'); } catch {}
    try { this.server.close(); } catch {}
  }
}

module.exports = { OperatorUI };
