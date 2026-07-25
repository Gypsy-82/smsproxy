'use strict';
// User-selectable chat colours (You / Target), persisted to a small JSON file
// next to the app. ANSI 16-colour codes so they render on any terminal.
const fs = require('fs');
const path = require('path');

const CONFIG = path.join(__dirname, '..', '.smsproxy.json');

// 256-colour codes (widely supported) for vibrant, accurate colours.
const PALETTE = {
  pink: '38;5;205',    // hot pink
  purple: '38;5;141',  // violet (~#a78bfa)
  green: '38;5;46',    // neon / lime green
  yellow: '38;5;226',  // bright yellow
  red: '38;5;196',     // bright red
  white: '38;5;231',   // pure white
  blue: '38;5;39',     // bright azure blue
};
const NAMES = Object.keys(PALETTE);
const DEFAULTS = { you: 'purple', target: 'green' };

function code(name) { return PALETTE[name] || PALETTE.green; }

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    return {
      you: PALETTE[j.you] ? j.you : DEFAULTS.you,
      target: PALETTE[j.target] ? j.target : DEFAULTS.target,
    };
  } catch { return { ...DEFAULTS }; }
}

function save(cfg) {
  try { fs.writeFileSync(CONFIG, JSON.stringify({ you: cfg.you, target: cfg.target }, null, 2)); } catch {}
}

module.exports = { PALETTE, NAMES, DEFAULTS, code, load, save };
