'use strict';
// Operator-side terminal chat. ASCII-only, colour via ANSI. Clean lines where
// the colour identifies the sender, plus a live "(typing...)" hint on the prompt.
const readline = require('readline');
const r = require('./render');

class Tui {
  constructor(relay, { onQuit, link, ttlMin, mode, safety }) {
    this.relay = relay;
    this.onQuit = onQuit;
    this.link = link;
    this.ttlMin = ttlMin;
    this.mode = mode || '';
    this.safety = safety || '';
    this.clientTyping = false;
    this.typingSent = false;
    this.typingTimer = null;
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  start() {
    this.rl.setPrompt(this._prompt());
    this._raw('\n' + r.banner({ ttlMin: this.ttlMin, mode: this.mode, safety: this.safety }) + '\n');
    this._raw(r.system('waiting for the client to open the link') + '\n');

    this.relay.on('client-online', () => this._event(r.system('client connected') + '\n' + r.keyLine(true, this.safety)));
    this.relay.on('client-offline', () => { this.clientTyping = false; this._event(r.system('client disconnected')); });
    this.relay.on('message', (text) => { this.clientTyping = false; this._event(r.bubble({ text, side: 'left' })); });
    this.relay.on('client-typing', (on) => { this.clientTyping = on; this._refreshPrompt(); });
    this.relay.on('tamper', (why) => this._keyAlarm(why));
    this.relay.on('auth-fail', (n) => this._event(r.system(r.C.red(`! wrong-password attempt ${n}/${this.relay.maxFails}`))));

    if (process.stdin.isTTY) {
      this.rl.input.on('keypress', (ch, key) => {
        if (key && (key.name === 'return' || key.name === 'enter' || (key.ctrl && key.name === 'c'))) return;
        this._opTyping();
      });
    }

    this.rl.on('line', (line) => this._onLine(line));
    this.rl.on('SIGINT', () => this._quit());
    this.rl.prompt();
  }

  _prompt() {
    return r.C.green('> ') + (this.clientTyping ? r.C.dim('(typing...) ') : '');
  }
  _refreshPrompt() {
    this.rl.setPrompt(this._prompt());
    this.rl.prompt(true);
  }

  _opTyping() {
    if (!this.relay.hasClient()) return;
    if (!this.typingSent) { this.typingSent = true; this.relay.sendTyping(true); }
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this._opTypingStop(), 1500);
  }
  _opTypingStop() {
    clearTimeout(this.typingTimer);
    if (this.typingSent) { this.typingSent = false; this.relay.sendTyping(false); }
  }

  _onLine(line) {
    const text = line.replace(/\r?\n$/, '');
    const trimmed = text.trim();
    if (!trimmed) { this.rl.prompt(); return; }
    if (trimmed.startsWith('/')) return this._command(trimmed);

    this._opTypingStop();
    readline.moveCursor(process.stdout, 0, -1);
    readline.clearLine(process.stdout, 0);

    if (!this.relay.hasClient()) {
      process.stdout.write(r.system(r.C.gray('no client connected - not sent')) + '\n');
      this.rl.prompt(true);
      return;
    }
    process.stdout.write(r.bubble({ text, side: 'right' }) + '\n');
    this.relay.sendToClient(text);
    this.rl.prompt(true);
  }

  _command(text) {
    const cmd = text.slice(1).split(/\s+/)[0].toLowerCase();
    readline.moveCursor(process.stdout, 0, -1);
    readline.clearLine(process.stdout, 0);
    if (cmd === 'quit' || cmd === 'q' || cmd === 'exit') return this._quit();
    if (cmd === 'status') this._sys(this.relay.hasClient() ? 'client connected' : 'waiting for client');
    else if (cmd === 'link') process.stdout.write('\n     ' + r.C.cyan(this.link) + '\n');
    else if (cmd === 'share') process.stdout.write('\n' + r.shareBlock({ link: this.link, safety: this.safety }) + '\n');
    else if (cmd === 'safety') this._sys(`safety code ${r.C.green(this.safety)} - read it to your contact; it must match their screen`);
    else if (cmd === 'clear') { console.clear(); this._raw(r.banner({ ttlMin: this.ttlMin, mode: this.mode, safety: this.safety }) + '\n'); }
    else if (cmd === 'help') this._legend();
    else this._sys(`unknown command: /${cmd}`);
    this.rl.prompt();
  }

  _sys(msg) { process.stdout.write(r.system(msg) + '\n'); }

  _legend() {
    const L = (s) => process.stdout.write(s + '\n');
    L(r.system('legend'));
    L('  ' + r.you('this colour') + r.C.dim(' = you') + '      ' + r.target('this colour') + r.C.dim(' = the other person'));
    L('  ' + r.C.dim('  (typing...) appears on your prompt when they type'));
    L('  ' + r.C.dim('  commands: ') + '/link  /share  /safety  /status  /clear  /help  /quit');
  }

  _keyAlarm(why) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write('\n' + r.keyLine(false) + '\n' + r.alarm('KEYS CHANGED - ' + why) + '\n');
  }

  _event(block) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(block + '\n');
    this.rl.prompt(true);
  }

  _raw(s) { process.stdout.write(s + '\n'); }

  _quit() {
    this._opTypingStop();
    this._raw('');
    process.stdout.write(r.system('shutting down - destroying link...') + '\n');
    this.rl.close();
    this.onQuit();
  }
}

module.exports = { Tui };
