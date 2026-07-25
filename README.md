# SMSproxy 🔐📬

**Private, end-to-end-encrypted chat you host yourself — in one line.** You run a
terminal; the other person opens a private link in any browser. No app to install,
no account, no database, no cloud. Close it and the link dies and every message is
gone.

---

## Install & run — one line

```bash
git clone https://github.com/Gypsy-82/smsproxy.git && cd smsproxy && ./install.sh && ./smsproxy
```

> Replace `YOUR-USERNAME` with your GitHub account (the repo is named **smsproxy**).

That's it. All you need is **Node 18+** — the helper binaries **`caddy` and `cloudflared`
are downloaded for your platform automatically** (into `vendor/`) by `install.sh`, and
also **on first run** if you skip it, so the package always works out of the box.
(There's nothing to `npm install`; the code itself has **zero dependencies** — Node
standard library only.)

> No repo yet? Any folder works: drop the files in, `chmod +x smsproxy install.sh`, run `./smsproxy`.

---

## What it is (plain version)

Think of it as a **disposable, secure chat room you create on demand**. You spin one
up, get a private web link and a password, and hand them to one person. They chat in a
clean bubble interface in their browser; you chat from your terminal. When you're done,
you close it — and the room, the link, and the messages simply vanish.

## How it works (30 seconds)

1. Run `./smsproxy`, pick **Auto-start** (or **Configure** to set your own options), and enter a password (or Enter for a strong random one).
2. It prints a **private `https://…` link** and a **password**.
3. Send the **link** to your friend. Send the **password a different way** (text it, say it out loud).
4. They open the link → **"You've Got Mail"** → type the password → you're chatting.
5. Press **Ctrl+C** — link dead, messages gone, keys wiped.

## Your interface: terminal or browser

At startup you pick how **you** chat:

- **Terminal** — chat right in the terminal (the default).
- **Browser** — it opens a **local** `http://127.0.0.1/…` link with the **same bubble UI** the
  target sees. The target still gets the same public link.

Browser mode keeps everything on your machine: the server is still *your* encryption endpoint,
and your browser is just a local window into it (plaintext never leaves `127.0.0.1`). Use the
`--browser` flag to skip the menu.

## Getting it to your friend

Pick a **reach** mode when it asks:

| Your friend is… | Choose | You need |
|---|---|---|
| On your Wi-Fi, or it's just you testing | **local** | nothing extra |
| Anywhere — on their phone, across the world | **tunnel** | `cloudflared` (free, **no account**) |

`tunnel` gives you a fresh public `https://<random>.trycloudflare.com` link every run.

## The security, in plain terms

- **End-to-end encrypted** (AES-256-GCM). The server only ever sees scrambled text.
- **The password is never in the link** and never sent over the wire in the clear.
- **Green key 🔑** in both the terminal and the browser = the line is verified. Tap the
  browser's **compare** to reveal a short **safety code**; read it to your contact to be
  sure no one's in the middle.
- **Tamper = self-destruct.** If a single message doesn't check out, both sides flash
  **KEYS CHANGED** in red and the link destroys itself.
- **Nothing is stored.** Messages live in memory only. **One person per link**, a **1-hour
  timer**, and **burn-after-chat** when they leave.

**What it's *not*:** it isn't audited and it isn't a Signal replacement. It's the fastest
way to open a throwaway, verifiable, private line between two people — and then vanish.

## Handy commands

```bash
./smsproxy --doctor   # check what's installed + how to get the rest
./smsproxy --demo     # preview the terminal chat UI
./smsproxy --help     # menu & legend
```

In a chat: `/help` shows a legend, `/safety` prints the safety code, `/quit` ends it.

## Runs anywhere Node does

Desktop Linux/macOS, **Termux**, and the **Pixel Linux (Debian) terminal** — no compiler,
no native modules. Just `node`, plus `caddy` (and `cloudflared` for tunnel mode).

## On your phone (Termux & Pixel Debian)

Install once: `pkg install nodejs git` (Termux) or `sudo apt install nodejs git` (Pixel Debian
VM), then the one-line clone above. `caddy`/`cloudflared` auto-download on first run.

**Terminal mode works the same everywhere** — just run `./smsproxy` and chat in the terminal.
It's the simplest option on a phone and needs no networking setup.

**Browser mode depends on the environment**, because of how each one networks:

- **Termux** shares Android's network, so browser mode works directly: pick **browser**, then open
  the printed `http://127.0.0.1:<port>/…` link in Chrome on the same phone.
- **Pixel "Linux Terminal" (Debian VM)** runs in an isolated sandbox — its `127.0.0.1` is *not*
  your phone's, so that link won't open in Chrome. Use **`./smsproxy --vm`**: it binds the UI on a
  fixed port and prints steps — forward that port in **Terminal app → Settings → Port forwarding**,
  then open the `http://localhost:<port>/…` link it gives you. (Add `--op-port <n>` if 8080 is taken.)
  If forwarding gives you trouble, just use **terminal mode** on the VM.

**Sharing the link:** **tapping** a link always works. Copy-paste can break because a long link
**wraps** in a narrow terminal — so the tool auto-copies the link to your clipboard when a clipboard
tool is present (Termux:API `pkg install termux-api`, or `wl-copy`/`pbcopy`/`xclip`/`xsel`). You can
also shorten the link with `--short`.

---

<details>
<summary><b>Under the hood (for the curious)</b></summary>

- **Zero runtime dependencies** — pure Node standard library. `node bin/smsproxy.js` runs
  with no `node_modules`. (`npm install` is only needed to run the test suite.)
- **Crypto:** PBKDF2 (210k, SHA-256) derives an AES-256-GCM message key + an HMAC key from
  the out-of-band password and a per-session salt; auth is an HMAC **challenge/response**,
  so the raw password never transits. The safety code is a truncated HMAC fingerprint of
  the key — identical on both ends, one-way, never sent.
- **Transport:** Caddy reverse-proxies to a `127.0.0.1`-only Node server and handles TLS +
  the WebSocket upgrade; a hand-rolled stdlib WebSocket layer (`src/wslite.js`) keeps it
  dependency-free.
- **Fail-closed:** any frame that won't authenticate under the session key trips a tamper
  event → red banner on both ends → link self-destruct.
- **Containment:** localhost-only bind, no file serving (only the token page + relay),
  `0600` temp Caddyfile deleted on exit. Optional `contrib/` firejail profile + hardened
  systemd unit. **Docker not required.**
- **Layout:** `bin/` launcher · `src/` server, crypto, wslite, tui, render, caddy, tunnel,
  preflight · `public/index.html` client · `test/e2e.test.js` (`npm test`).

</details>

## License

MIT — see [LICENSE](LICENSE).
