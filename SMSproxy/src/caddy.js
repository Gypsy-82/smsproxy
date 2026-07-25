'use strict';
// Renders a minimal, hardened Caddyfile and (optionally) runs Caddy as a child
// process so it dies with the tool.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const vendor = require('./vendor');

// tlsMode: 'le'       -> automatic HTTPS via Let's Encrypt (public domain).
//          'internal' -> Caddy's internal CA (self-signed); lease is honoured here.
function renderCaddyfile({ domain, port, tlsMode, lease, email }) {
  const globals = ['\tadmin off'];
  if (tlsMode !== 'internal' && email) globals.push(`\temail ${email}`);

  const tlsBlock =
    tlsMode === 'internal'
      ? `\ttls {\n\t\tissuer internal {\n\t\t\tlifetime ${lease}\n\t\t}\n\t}\n`
      : '';

  return `{
${globals.join('\n')}
}

${domain} {
\tencode zstd gzip
${tlsBlock}\theader {
\t\tStrict-Transport-Security "max-age=31536000; includeSubDomains"
\t\tX-Content-Type-Options "nosniff"
\t\tX-Frame-Options "DENY"
\t\tReferrer-Policy "no-referrer"
\t\tCross-Origin-Opener-Policy "same-origin"
\t\tContent-Security-Policy "default-src 'self'; connect-src 'self' wss: ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
\t\t-Server
\t}
\treverse_proxy 127.0.0.1:${port}
}
`;
}

function writeCaddyfile(contents) {
  const p = path.join(os.tmpdir(), `smsproxy-Caddyfile-${process.pid}`);
  fs.writeFileSync(p, contents, { mode: 0o600 });
  return p;
}

function startCaddy(caddyfilePath) {
  // Send Caddy's chatty logs to a temp file, not the operator's chat window.
  const logFd = fs.openSync(path.join(os.tmpdir(), `smsproxy-caddy-${process.pid}.log`), 'a');
  return spawn(vendor.resolve('caddy'), ['run', '--config', caddyfilePath, '--adapter', 'caddyfile'], {
    stdio: ['ignore', logFd, logFd],
  });
}

module.exports = { renderCaddyfile, writeCaddyfile, startCaddy };
