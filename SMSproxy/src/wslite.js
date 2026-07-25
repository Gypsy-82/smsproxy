'use strict';
// Minimal RFC 6455 WebSocket server — just enough for this tool, using only
// Node's stdlib so the whole project has ZERO runtime dependencies
// (git clone && node bin/smsproxy.js — no npm install required).
//
// Server reads masked client frames and writes unmasked text frames. Handles
// text, ping/pong, close, and fragmented messages, with a hard size cap.

const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 128 * 1024; // reject anything larger — abuse guard

class WsConnection extends EventEmitter {
  constructor(socket, head) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.closed = false;   // we've decided to close (no more app sends)
    this._done = false;    // 'close' emitted exactly once

    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._finish(1006));
    socket.on('error', () => this._finish(1006));

    if (head && head.length) this._onData(head);
  }

  _onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    try { this._parse(); } catch { this.close(1002, 'protocol error'); }
  }

  _parse() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;

      if (len === 126) {
        if (this.buf.length < off + 2) return;
        len = this.buf.readUInt16BE(off); off += 2;
      } else if (len === 127) {
        if (this.buf.length < off + 8) return;
        const hi = this.buf.readUInt32BE(off);
        const lo = this.buf.readUInt32BE(off + 4);
        len = hi * 2 ** 32 + lo; off += 8;
      }
      if (!masked) return this.close(1002, 'unmasked frame');
      if (len > MAX_MESSAGE) return this.close(1009, 'message too large');
      if (this.buf.length < off + 4 + len) return; // need more bytes

      const mask = this.buf.subarray(off, off + 4); off += 4;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = this.buf[off + i] ^ mask[i & 3];
      off += len;
      this.buf = this.buf.subarray(off);
      this._frame(fin, opcode, payload);
      if (this.closed) return;
    }
  }

  _frame(fin, opcode, payload) {
    if (opcode === 0x8) return this.close(1000);          // close
    if (opcode === 0x9) return this._writeFrame(0xA, payload); // ping -> pong
    if (opcode === 0xA) return;                            // pong -> ignore
    if (opcode !== 0x0 && opcode !== 0x1 && opcode !== 0x2) return this.close(1002, 'bad opcode');

    if (opcode !== 0x0) { this.fragOp = opcode; this.frags = []; }
    this.frags.push(payload);
    let total = 0;
    for (const f of this.frags) total += f.length;
    if (total > MAX_MESSAGE) return this.close(1009, 'message too large');
    if (!fin) return;

    const full = Buffer.concat(this.frags);
    this.frags = [];
    const op = this.fragOp; this.fragOp = 0;
    if (op === 0x1) this.emit('message', full.toString('utf8')); // text only
  }

  _writeFrame(opcode, payload) {
    if (this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2); header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4); header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10); header[1] = 127;
      header.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
      header.writeUInt32BE(len >>> 0, 6);
    }
    header[0] = 0x80 | opcode; // FIN + opcode
    try { this.socket.write(Buffer.concat([header, payload])); } catch {}
  }

  send(str) { if (!this.closed) this._writeFrame(0x1, Buffer.from(str, 'utf8')); }
  ping() { if (!this.closed) this._writeFrame(0x9, Buffer.alloc(0)); }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    try {
      const r = Buffer.from(String(reason).slice(0, 120), 'utf8');
      const p = Buffer.allocUnsafe(2 + r.length);
      p.writeUInt16BE(code, 0); r.copy(p, 2);
      this._writeFrame(0x8, p);
    } catch {}
    try { this.socket.end(); } catch {}
    this._finish(code);
  }

  _finish(code) {
    if (this._done) return;
    this._done = true;
    this.closed = true;
    this.emit('close', code);
  }
}

// Complete the HTTP->WS handshake on a raw upgrade socket. Returns a
// WsConnection, or null if the request isn't a valid WebSocket upgrade.
function accept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers['upgrade'] || '').toLowerCase();
  if (upgrade !== 'websocket' || !key) { try { socket.destroy(); } catch {} return null; }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n'
  );
  return new WsConnection(socket, head);
}

module.exports = { accept, WsConnection, MAX_MESSAGE };
