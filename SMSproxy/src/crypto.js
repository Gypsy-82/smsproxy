'use strict';
// Shared crypto for the operator (Node) side. The browser client mirrors this
// exactly in public/index.html so both endpoints derive identical keys.
//
// One secret — the password — is shared OUT OF BAND (never in the link).
// PBKDF2(password, salt) -> 64 bytes -> [0:32]=AES-GCM key, [32:64]=HMAC key.
//   * AES-GCM key encrypts every message (true e2e; only the two endpoints hold it).
//   * HMAC key answers a random challenge so the raw password never crosses the wire.

const { webcrypto } = require('crypto');
const { subtle } = webcrypto;

const te = new TextEncoder();
const td = new TextDecoder();

const PBKDF2_ITERATIONS = 210000; // keep in sync with public/index.html

function randomBytes(n) {
  const b = new Uint8Array(n);
  webcrypto.getRandomValues(b);
  return b;
}
function toB64u(bytes) {
  return Buffer.from(bytes).toString('base64url');
}
function fromB64u(s) {
  return new Uint8Array(Buffer.from(String(s), 'base64url'));
}
function randomB64u(n) {
  return toB64u(randomBytes(n));
}

async function deriveKeys(password, saltB64u) {
  const salt = fromB64u(saltB64u);
  const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, base, 512)
  );
  const encKey = await subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const macKey = await subtle.importKey('raw', bits.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return { encKey, macKey };
}

async function sign(macKey, bytes) {
  return Buffer.from(new Uint8Array(await subtle.sign('HMAC', macKey, bytes)));
}

// Short human-comparable fingerprint of the shared key (a "safety code").
// Both endpoints derive the same value; comparing it out-of-band confirms the
// channel is genuinely end-to-end with no one in the middle. Mirrored in the browser.
async function safetyCode(macKey) {
  const mac = await sign(macKey, te.encode('smsproxy-safety-v1'));
  const hex = mac.slice(0, 4).toString('hex').toUpperCase();
  return hex.slice(0, 4) + '-' + hex.slice(4, 8);
}

async function encrypt(encKey, text) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, encKey, te.encode(text)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toB64u(out);
}

async function decrypt(encKey, dataB64u) {
  const raw = fromB64u(dataB64u);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, encKey, ct);
  return td.decode(pt);
}

module.exports = { randomBytes, toB64u, fromB64u, randomB64u, deriveKeys, sign, safetyCode, encrypt, decrypt, PBKDF2_ITERATIONS };
