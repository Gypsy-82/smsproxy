# SMSproxy 🔐 — disposable end-to-end-encrypted chat you host in one line

Ever needed to talk to someone *right now*, privately, without making them download an
app or sign up for anything? That's SMSproxy.

Run one command. It stands up a local server behind Caddy and hands you a private HTTPS
link plus a password. Send the link to whoever you want; give them the password
separately. They open it in any browser — desktop or phone — type the password, and
you're in a clean encrypted bubble chat: **you from the terminal, them from the web.**

**Under the hood:** end-to-end **AES-256-GCM** — the server only ever sees ciphertext.
Keys are derived from the password with PBKDF2 + an HMAC challenge, so the password
never touches the wire. A tap-to-compare **safety code** verifies the line, and a
**fail-closed tamper tripwire** means one bad frame flips both ends to a red
**KEYS CHANGED** and self-destructs the link.

**Zero runtime dependencies** — pure Node standard library, so it runs anywhere Node
does, including Termux and the Pixel Linux terminal. Nothing touches disk. **Single
session per link, 1-hour TTL, burn-after-chat.** Close the terminal and the link 404s,
the messages are gone, the keys are wiped. Need it reachable from a phone on cellular?
Flip on the built-in **Cloudflare quick-tunnel** — still no account.

It's not trying to replace Signal. It's the fastest way to open a throwaway, verifiable,
private line between two people — and then make it vanish.

**Spin it up. Say what you need. Burn it down.** 🔥
