'use strict';
// Resolve a helper binary: prefer the locally-vendored copy (fetched by
// scripts/fetch-deps.js into ./vendor/), else fall back to the bare name so a
// system-installed one on PATH still works.
const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', 'vendor');

function resolve(name) {
  const p = path.join(VENDOR, name);
  try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { return name; }
}

module.exports = { resolve, VENDOR };
