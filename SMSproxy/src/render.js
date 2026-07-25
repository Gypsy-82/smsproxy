'use strict';
// Terminal rendering. ASCII-only so it renders correctly on ANY terminal
// regardless of locale/encoding (no box-drawing or Unicode glyphs to mojibake).
// Colour is ANSI-only, which is universally supported.

const colors = require('./colors');

const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

// Message colours (user-configurable): You (local) vs Target (remote).
let YOU = colors.code(colors.load().you);
let TARGET = colors.code(colors.load().target);
function setColors(cfg) { YOU = colors.code(cfg.you); TARGET = colors.code(cfg.target); }
function you(s) { return paint(YOU, s); }
function target(s) { return paint(TARGET, s); }
function swatch(name, s) { return paint(colors.code(name), s == null ? name : s); }

const C = {
  green: (s) => paint('32', s),
  greenB: (s) => paint('1;32', s),
  magenta: (s) => paint('35', s),
  magentaB: (s) => paint('1;35', s),
  cyan: (s) => paint('36', s),
  gray: (s) => paint('90', s),
  dim: (s) => paint('2', s),
  red: (s) => paint('31', s),
};

const cols = () => process.stdout.columns || 80;
const WIDTH = () => Math.min(cols(), 80);
const now = () => new Date().toTimeString().slice(0, 5);

function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  for (let word of words) {
    while (word.length > width) {
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!line) line = word;
    else if ((line + ' ' + word).length <= width) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

// One chat line:  "HH:MM  message". No name label — the colour is the sender:
// you (local) = your colour, the other person = their colour.
function bubble({ text, side }) {
  const time = now();
  const color = side === 'right' ? you : target;
  const headLen = 5 + 2; // HH:MM + two spaces
  const avail = Math.max(20, WIDTH() - headLen);
  const rows = String(text).split('\n').flatMap((l) => wrap(l, avail));
  const indent = ' '.repeat(headLen);
  const head = C.dim(time) + '  ';
  return rows.map((row, i) => (i === 0 ? head : indent) + color(row)).join('\n');
}

// Centred status line:  "-------- text --------"
function system(text) {
  const width = WIDTH();
  const t = ` ${text} `;
  const total = Math.max(0, width - t.length);
  const l = Math.floor(total / 2);
  return C.gray('-'.repeat(l)) + C.dim(t) + C.gray('-'.repeat(total - l));
}

// Key-verification indicator.
function keyLine(verified, safety) {
  if (verified) return '  ' + C.green('* key verified') + C.dim(safety ? '   safety ' + safety : '');
  return '  ' + C.red('! KEYS CHANGED');
}

// Full-width red alarm banner (white-on-red).
function alarm(text) {
  const w = WIDTH();
  const bg = (s) => paint('1;97;41', s);
  const bar = (s) => { const t = ' ' + s; return bg(t + ' '.repeat(Math.max(0, w - t.length))); };
  return [bar(''), bar('! ' + text), bar('')].join('\n');
}

// The three things to hand off, each on its own copyable line.
function shareBlock({ link, password, safety }) {
  const rule = C.dim('-'.repeat(WIDTH()));
  const L = [];
  L.push(rule);
  L.push('  ' + C.greenB('SHARE THESE') + C.dim('  - link and password by SEPARATE channels'));
  L.push('');
  L.push('  ' + C.green('1. Link') + C.dim('  (send to your friend)'));
  L.push('       ' + C.cyan(link));
  L.push('');
  L.push('  ' + C.green('2. Password') + C.dim('  (send a different way - NOT with the link)'));
  L.push('       ' + (password ? C.greenB(password) : C.dim('- the password you chose -')));
  L.push('');
  L.push('  ' + C.green('3. Safety code') + C.dim('  (you should both see the same)   ') + C.greenB(safety));
  L.push(rule);
  return L.join('\n');
}

// Clean title bar for the chat, e.g.
//   ==================================================================
//     SMSproxy   secure line                            key 19A8-0172
//   ==================================================================
//     self-destructs in 60 min   -   /help for commands
function banner({ ttlMin, safety }) {
  const w = WIDTH();
  const bar = C.green('='.repeat(w));
  const left = '  SMSproxy';
  const mid = '   secure line';
  const right = safety ? 'key ' + safety : '';
  const pad = Math.max(2, w - left.length - mid.length - right.length - 2);
  const title = C.greenB(left) + C.dim(mid) + ' '.repeat(pad) + C.dim(right) + '  ';
  const status = C.dim(`  self-destructs in ${ttlMin} min   -   /help for commands`);
  return [bar, title, bar, status].join('\n');
}

module.exports = { C, bubble, system, banner, shareBlock, keyLine, alarm, useColor, WIDTH, setColors, swatch, you, target };
