#!/usr/bin/env node
'use strict';
// SMSproxy launcher. Shows a menu (Configure / Auto-start / Help / Colors).
// Flags bypass the menu for scripting. New random token + keys every launch;
// the link self-destructs on Ctrl+C, /quit, client-leave, tripwire, or TTL.

const fs = require('fs');
const net = require('net');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const c = require('../src/crypto');
const r = require('../src/render');
const colors = require('../src/colors');
const { Relay } = require('../src/server');
const { Tui } = require('../src/tui');
const caddy = require('../src/caddy');
const tunnel = require('../src/tunnel');
const preflight = require('../src/preflight');
const { OperatorUI } = require('../src/operator-ui');
const pkg = require('../package.json');

// ---------- small helpers ----------
function ask(rl, q, def) {
  const label = def !== undefined && def !== '' ? `${q} [${def}]: ` : `${q}: `;
  return new Promise((res) => rl.question(label, (a) => res((a || '').trim() || def || '')));
}
function askHidden(rl, q) {
  return new Promise((res) => {
    const orig = rl._writeToOutput.bind(rl);
    let shown = false;
    rl._writeToOutput = (s) => {
      if (!shown) { orig(`${q}: `); shown = true; return; }
      if (s.includes('\n')) orig('\n');
    };
    rl.question(`${q}: `, (a) => { rl._writeToOutput = orig; res(a); });
  });
}
// Choose the operator's own interface: terminal (TUI) or browser (local page).
async function chooseUI(rl, cfg) {
  const ans = (await ask(rl, '  Your interface - terminal or browser', 'terminal')).toLowerCase();
  cfg.ui = ans.startsWith('b') ? 'browser' : 'terminal';
  return cfg;
}
// Prompt for a password (Enter = auto-generate a strong one). Sets cfg.password/generated.
async function choosePassword(rl, cfg) {
  const pw = await askHidden(rl, '  Password (Enter to auto-generate a strong one)');
  if (pw && pw.length >= 8) { cfg.password = pw; cfg.generated = false; }
  else {
    if (pw) console.log('  ' + r.C.dim('too short (<8) - auto-generating instead'));
    cfg.password = c.randomB64u(12); cfg.generated = true;
  }
  return cfg;
}
function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// Copy text to the OS clipboard so the operator can paste a clean, unwrapped link
// (terminal line-wrapping breaks copy-paste of long links). Best-effort.
function copyToClipboard(text) {
  const tools = [
    ['termux-clipboard-set', []],   // Android / Termux
    ['wl-copy', []],                // Wayland
    ['pbcopy', []],                 // macOS
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ];
  for (const [cmd, args] of tools) {
    try {
      const res = spawnSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      if (!res.error && res.status === 0) return true;
    } catch {}
  }
  return false;
}

// First-run self-install: fetch caddy / cloudflared if they're missing for this launch.
function ensureDeps(cfg) {
  const pf = preflight.check();
  const need = [];
  if (cfg.runCaddy && !pf.caddy.ok) need.push('caddy');
  if (cfg.reach === 'tunnel' && !pf.cloudflared.ok) need.push('cloudflared');
  if (!need.length) return;
  console.log('\n  First run - fetching ' + need.join(' + ') + ' for your platform...');
  spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'fetch-deps.js')], { stdio: 'inherit' });
}
function looksLocal(addr) {
  const a = String(addr).toLowerCase().split(':')[0];
  if (a === 'localhost') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return true;
  if (!a.includes('.')) return true;
  return /\.(local|test|lan|internal|home|localhost)$/.test(a);
}

// ---------- branding / info ----------
const BIGFONT = {
  S: ['.####', '#....', '.###.', '....#', '####.'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  P: ['####.', '#...#', '####.', '#....', '#....'],
  R: ['####.', '#...#', '####.', '#.#..', '#..##'],
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
};
function bigWord(word) {
  const blank = ['.....', '.....', '.....', '.....', '.....'];
  // '.' marks empty cells; render blocks as '#', gaps as spaces, so letters read clearly
  return [0, 1, 2, 3, 4].map((row) =>
    word.split('').map((ch) => (BIGFONT[ch] || blank)[row]).join('  ').replace(/\./g, ' '));
}
function splash() {
  const w = r.WIDTH();
  const bar = r.C.green('='.repeat(w));
  const rows = bigWord('SMSPROXY');
  const pad = ' '.repeat(Math.max(0, Math.floor((w - rows[0].length) / 2)));
  const out = ['', bar, ''];
  for (const line of rows) out.push(r.C.greenB(pad + line));
  out.push('', bar);
  return out.join('\n');
}

function printHelp() {
  const g = r.C.green, d = r.C.dim, c2 = r.C.cyan;
  const L = (s) => process.stdout.write(s + '\n');
  L('');
  L('  ' + g('SMSproxy') + d('  ephemeral end-to-end chat  v' + pkg.version));
  L('');
  L('  ' + d('Run it'));
  L('    ' + c2('smsproxy') + '            menu: Configure / Auto-start / Help / Colors');
  L('    ' + c2('smsproxy --doctor') + '   check dependencies + how to install what is missing');
  L('    ' + c2('smsproxy --demo') + '     preview the terminal chat UI');
  L('    ' + c2('smsproxy --help') + '     this menu   ' + c2('--version'));
  L('');
  L('  ' + d('Auto-start defaults'));
  L('    ' + d('cloudflare tunnel - auto port - 1 hour TTL - burn when client leaves'));
  L('    ' + d('3 wrong-password tripwire - Caddy in front - strong auto password'));
  L('');
  L('  ' + d('Skip the menu with flags'));
  L('    ' + c2('--auto') + '   ' + c2('--local') + '   ' + c2('--ttl <min>') + '   ' + c2('--fails <n>') + '   ' + c2('--password <pw>'));
  L('    ' + c2('--port <n>') + '   ' + c2('--short') + '   ' + c2('--browser') + '   ' + c2('--no-caddy') + '   ' + c2('--no-burn'));
  L('');
  L('  ' + d('In chat') + '   /link  /share  /safety  /status  /clear  /help  /quit');
  L('  ' + d('Security') + '  E2E AES-256-GCM - password out-of-band - single session - self-destructs');
  L('');
}

function doctor() {
  const s = preflight.check();
  const mark = (b) => (b ? r.C.green('ok') : r.C.red('XX'));
  const L = (s2) => process.stdout.write(s2 + '\n');
  L('\n  ' + r.C.green('SMSproxy - doctor') + r.C.dim(`   platform: ${s.platform}`) + '\n');
  L(`    ${mark(s.node.ok)} node ${s.node.version}` + (s.node.ok ? '' : r.C.dim(`  (need ${s.node.need})`)));
  L(`    ${mark(s.caddy.ok)} caddy` + (s.caddy.ok ? '' : r.C.dim(`   -> ${s.caddy.hint}`)));
  L(`    ${mark(s.cloudflared.ok)} cloudflared` + (s.cloudflared.ok ? '' : r.C.dim(`   (tunnel mode only) -> ${s.cloudflared.hint}`)));
  L('');
  L(r.C.dim('    caddy serves HTTPS (always needed). cloudflared is only for tunnel reach.'));
  L('');
}

function runDemo() {
  const w = (s) => process.stdout.write(s + '\n');
  w('\n' + r.banner({ ttlMin: 60, safety: '19A8-0172' }) + '\n');
  w(r.system('client connected') + '\n  ' + r.C.green('* key verified') + r.C.dim('   safety 19A8-0172'));
  w(r.bubble({ text: 'hey - got the link, that was fast', label: 'client', side: 'left' }));
  w(r.bubble({ text: 'yep. password worked?', label: 'you', side: 'right' }));
  w(r.bubble({ text: 'first try. honestly this beats texting', label: 'client', side: 'left' }));
  w(r.bubble({ text: 'told you. nothing is stored - all in memory', label: 'you', side: 'right' }));
  w('\n' + r.C.green('> '));
}

// ---------- config builders ----------
function autoConfig() {
  return {
    reach: 'tunnel', port: 0, ttlMin: 60, burnOnDisconnect: true, graceSec: 0,
    maxFails: 3, runCaddy: true, domain: 'localhost', tlsMode: 'internal',
    lease: '168h', email: '', tokenBytes: 24, ui: 'terminal', password: c.randomB64u(12), generated: true,
  };
}

function configFromFlags(argv) {
  const has = (f) => argv.includes(f);
  const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const cfg = autoConfig();
  cfg.reach = has('--local') ? 'local' : 'tunnel';
  const portArg = opt('--port', 'auto');
  cfg.port = /^\d+$/.test(portArg) ? parseInt(portArg, 10) : 0;
  cfg.ttlMin = parseInt(opt('--ttl', '60'), 10);
  cfg.maxFails = parseInt(opt('--fails', '3'), 10);
  cfg.runCaddy = !has('--no-caddy');
  cfg.burnOnDisconnect = !has('--no-burn');
  if (has('--short')) cfg.tokenBytes = 12;
  if (has('--browser')) cfg.ui = 'browser';
  const pw = opt('--password', '');
  if (pw) {
    if (pw.length < 8) { console.error('  --password must be at least 8 characters.'); process.exit(1); }
    cfg.password = pw; cfg.generated = false;
  }
  return cfg;
}

// ---------- interactive: Configure ----------
async function configure(rl) {
  const cfg = autoConfig();
  console.log('\n  ' + r.C.dim('Configure  (press Enter to accept the [default])') + '\n');
  const reachRaw = (await ask(rl, "  Reach - 'tunnel' (public link) or 'local' (you/LAN)", 'tunnel')).toLowerCase();
  cfg.reach = reachRaw.startsWith('l') ? 'local' : 'tunnel';
  if (cfg.reach === 'local') {
    cfg.domain = await ask(rl, '  Address (hostname, e.g. chat.local)', 'localhost');
    cfg.tlsMode = looksLocal(cfg.domain) ? 'internal' : 'le';
  }
  const portRaw = (await ask(rl, '  Port (blank = auto)', 'auto')).toLowerCase();
  cfg.port = /^\d+$/.test(portRaw) ? parseInt(portRaw, 10) : 0;
  cfg.ttlMin = parseInt(await ask(rl, '  Self-destruct timer (minutes)', '60'), 10);
  cfg.burnOnDisconnect = /^y/i.test(await ask(rl, '  Destroy link when the client leaves?', 'y'));
  cfg.graceSec = cfg.burnOnDisconnect ? parseInt(await ask(rl, '  Grace seconds for reconnect (0 = instant)', '0'), 10) : 0;
  cfg.maxFails = parseInt(await ask(rl, '  Self-destruct after N wrong passwords', '3'), 10);
  cfg.runCaddy = /^y/i.test(await ask(rl, '  Caddy in front (security headers)?', 'y'));
  cfg.tokenBytes = (await ask(rl, '  Link token length - 32 or 16 chars', '32')).trim() === '16' ? 12 : 24;
  await chooseUI(rl, cfg);
  await choosePassword(rl, cfg);
  return cfg;
}

// ---------- interactive: Chat colors ----------
async function colorMenu(rl) {
  const cur = colors.load();
  console.log('\n  ' + r.C.dim('Chat colors') + '   ' + r.C.dim('(type a number)'));
  console.log('  ' + colors.NAMES.map((n, i) => r.swatch(n, `${i + 1} ${n}`)).join('   ') + '\n');
  const pick = async (who, curName) => {
    const ans = (await ask(rl, `  ${who}`, '')).trim();
    if (!ans) return curName;
    const n = parseInt(ans, 10);
    return n >= 1 && n <= colors.NAMES.length ? colors.NAMES[n - 1] : curName;
  };
  const you = await pick('You', cur.you);
  const target = await pick('Target', cur.target);
  colors.save({ you, target });
  r.setColors({ you, target });
  console.log('\n  you = ' + r.swatch(you) + '   target = ' + r.swatch(target) + '\n');
}

// ---------- launch (shared by menu + flags) ----------
async function launch(cfg) {
  r.setColors(colors.load());
  ensureDeps(cfg);
  const { reach, port, ttlMin, burnOnDisconnect, graceSec, maxFails, runCaddy, domain, tlsMode, lease, email, password, generated, tokenBytes } = cfg;

  const token = c.randomB64u(tokenBytes || 24);
  const salt = c.randomB64u(16);
  const keys = await c.deriveKeys(password, salt);
  const sas = await c.safetyCode(keys.macKey);

  const pf = preflight.check();
  if (runCaddy && !pf.caddy.ok) console.log('\n  ' + r.C.red('! caddy not found') + r.C.dim('  -> ' + pf.caddy.hint));
  if (reach === 'tunnel' && !pf.cloudflared.ok) console.log('\n  ' + r.C.red('! cloudflared not found') + r.C.dim('  -> ' + pf.cloudflared.hint));

  const relay = new Relay({ token, salt, keys, port, maxFails, burnOnDisconnect, graceSec });
  const boundPort = await relay.listen();

  let caddyChild = null, caddyfilePath = null, tunnelChild = null, operatorUI = null, link, mode;
  const killChildren = () => {
    if (caddyChild) { try { caddyChild.kill('SIGTERM'); } catch {} }
    if (tunnelChild) { try { tunnelChild.kill('SIGTERM'); } catch {} }
  };
  const warnCaddy = (e) => console.error('\n  [caddy] could not start: ' + e.message + '\n');

  if (reach === 'tunnel') {
    let origin = `http://127.0.0.1:${boundPort}`;
    if (runCaddy) {
      const caddyPort = await getFreePort();
      caddyfilePath = caddy.writeCaddyfile(caddy.renderCaddyfile({ domain: `:${caddyPort}`, port: boundPort, tlsMode: 'le', lease, email: '' }));
      caddyChild = caddy.startCaddy(caddyfilePath);
      caddyChild.on('error', warnCaddy);
      origin = `http://127.0.0.1:${caddyPort}`;
    }
    console.log('\n  Starting Cloudflare quick tunnel...');
    try {
      const t = await tunnel.startTunnel(origin);
      tunnelChild = t.child;
      link = `${t.url}/r/${token}`;
      mode = `cloudflare tunnel${runCaddy ? ' - caddy' : ''}`;
    } catch (e) {
      console.error('  [tunnel] ' + e.message);
      console.error('  Get cloudflared with ./install.sh  (or see --doctor)');
      try { relay.destroy(); } catch {}
      killChildren();
      if (caddyfilePath) { try { fs.unlinkSync(caddyfilePath); } catch {} }
      process.exit(1);
    }
  } else {
    caddyfilePath = caddy.writeCaddyfile(caddy.renderCaddyfile({ domain, port: boundPort, tlsMode, lease, email }));
    if (runCaddy) { caddyChild = caddy.startCaddy(caddyfilePath); caddyChild.on('error', warnCaddy); }
    link = `https://${domain}/r/${token}`;
    mode = `${tlsMode === 'internal' ? 'self-signed' : "Let's Encrypt"} - ${domain}`;
  }

  let destroyed = false;
  const destroy = (why) => {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(ttlTimer);
    if (why) console.log('\n  Self-destruct: ' + why);
    if (operatorUI) { try { operatorUI.onDestroyed(); operatorUI.close(); } catch {} }
    try { relay.destroy(); } catch {}
    killChildren();
    if (caddyfilePath) { try { fs.unlinkSync(caddyfilePath); } catch {} }
    console.log('  Link destroyed. Messages lived in memory only and are now gone.\n');
    process.exit(0);
  };
  const ttlTimer = setTimeout(() => destroy(`lifetime reached (${ttlMin} min)`), ttlMin * 60 * 1000);
  relay.on('selfdestruct', (why) => destroy(why));
  process.on('SIGTERM', () => destroy('terminated'));
  process.on('exit', killChildren);

  console.log('\n' + r.shareBlock({ link, password: generated ? password : null, safety: sas }));
  if (copyToClipboard(link)) console.log('  ' + r.C.green('link copied to your clipboard') + r.C.dim(' - just paste it into a message'));
  if (!runCaddy && reach === 'local') console.log('\n  ' + r.C.dim('Caddy not started - run it yourself: caddy run --config ' + caddyfilePath));

  if (cfg.ui === 'browser') {
    // Operator uses a local browser page (same bubble UI as the target).
    operatorUI = new OperatorUI({ relay, safety: sas });
    await operatorUI.listen();
    relay.on('message', (t) => operatorUI.onMessage(t));
    relay.on('client-online', () => operatorUI.onPeer(true));
    relay.on('client-offline', () => operatorUI.onPeer(false));
    relay.on('client-typing', (on) => operatorUI.onTyping(on));
    relay.on('tamper', () => operatorUI.onTamper());
    console.log('\n  ' + r.C.greenB('Open YOUR chat in a browser on this machine:'));
    console.log('       ' + r.C.cyan(operatorUI.url()));
    console.log('\n  ' + r.C.dim('Ctrl+C here to end the session.') + '\n');
    process.on('SIGINT', () => destroy('operator quit'));
  } else {
    const tui = new Tui(relay, { link, ttlMin, mode, safety: sas, onQuit: () => destroy('operator quit') });
    tui.start();
  }
}

// ---------- menu ----------
async function menu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => { process.stdout.write('\n'); process.exit(0); });
  const show = () => {
    const d = r.C.dim, c2 = r.C.cyan;
    process.stdout.write('\n');
    process.stdout.write('  ' + c2('1') + '  Configure     ' + d('set port, timer, password, tripwire...') + '\n');
    process.stdout.write('  ' + c2('2') + '  Auto-start    ' + d('Cloudflare tunnel + Caddy, ready in seconds') + '\n');
    process.stdout.write('  ' + c2('3') + '  Help\n');
    process.stdout.write('  ' + c2('4') + '  Chat colors   ' + d('pick colors for You and Target') + '\n');
    process.stdout.write('  ' + c2('q') + '  Quit\n\n');
  };
  for (;;) {
    show();
    const choice = ((await ask(rl, '  Choose', '')) || '2').toLowerCase();
    if (choice === '1') { const cfg = await configure(rl); rl.close(); return launch(cfg); }
    if (choice === '2') {
      console.log('\n  ' + r.C.dim('Auto-start'));
      const cfg = autoConfig();
      await chooseUI(rl, cfg);
      await choosePassword(rl, cfg);
      rl.close();
      return launch(cfg);
    }
    if (choice === '3') { printHelp(); continue; }
    if (choice === '4') { await colorMenu(rl); continue; }
    if (choice === 'q' || choice === '0' || choice === 'quit') { rl.close(); process.stdout.write('\n'); process.exit(0); }
    console.log('  ' + r.C.dim('pick 1, 2, 3, 4, or q'));
  }
}

// ---------- entry ----------
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { printHelp(); return; }
  if (argv.includes('--version') || argv.includes('-v')) { console.log(pkg.version); return; }
  if (argv.includes('--doctor')) { doctor(); return; }
  if (argv.includes('--demo')) { runDemo(); return; }

  process.stdout.write(splash() + '\n');

  const launchFlags = ['--auto', '--local', '--ttl', '--fails', '--password', '--port', '--short', '--browser', '--no-caddy', '--no-burn'];
  if (argv.some((a) => launchFlags.includes(a))) return launch(configFromFlags(argv));

  return menu();
}

main().catch((e) => { console.error(e); process.exit(1); });
