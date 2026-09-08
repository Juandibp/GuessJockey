# Deploying Guess Jockey on a Linode (Ubuntu + systemd)

This runs the bot as a locked-down system user, restarts it automatically if it
crashes, and starts it on boot. Assumes **Ubuntu 22.04 / 24.04** and that you SSH
in as `root` or a `sudo` user. For Debian the steps are identical; for
RHEL/Alma/Rocky swap `apt` for `dnf` and `/usr/sbin/nologin` paths as noted.

The bot makes **only outbound** connections (Discord gateway/voice, Deezer). No
inbound ports, no reverse proxy, no domain needed.

> **This bot needs Node >= 22.12** (`@discordjs/voice`). If the box already runs
> other apps on an older Node, **do not upgrade the system Node** — install a
> dedicated Node 22 in `/opt/node22` and point only this service at it (§1).
> Nothing the other apps use changes.

---

## 0. Audit what's already running (do this first)

Paste this and keep the output; you'll compare against it after deploying.

```bash
cat /etc/os-release | head -2
echo "system node: $(node -v 2>/dev/null) at $(command -v node)"

# Listening sockets = every web server / app that serves traffic
sudo ss -tlnp

# Running services (minus the usual OS noise)
systemctl list-units --type=service --state=running --no-pager \
  | grep -Ev 'systemd-|dbus|cron|ssh|getty|rsyslog|polkit|networkd|resolved|timesyncd|unattended'

# Node processes and which binary each uses
ps -eo pid,user,comm,args | grep -i -- node | grep -v grep
for p in $(pgrep -x node); do echo "pid $p -> $(readlink -f /proc/$p/exe)"; done

# Process managers / reverse proxies
command -v pm2 >/dev/null && pm2 list || echo "no pm2 for $(whoami)"
systemctl is-active nginx apache2 caddy 2>/dev/null
ls /etc/nginx/sites-enabled/ /etc/apache2/sites-enabled/ 2>/dev/null

# How the system Node was installed (so an accidental `apt upgrade` can't move it)
ls -l /etc/apt/sources.list.d/ | grep -i node || true
apt-mark showhold | grep -i node || echo "node not held"

# Cron jobs that might invoke node
sudo bash -c 'for u in $(cut -f1 -d: /etc/passwd); do c=$(crontab -l -u $u 2>/dev/null); [ -n "$c" ] && echo "### $u" && echo "$c"; done'
ls -l /etc/cron.d/ 2>/dev/null
```

You're checking: which ports/sites must still work afterwards, and confirming the
other apps run on **the system `node`**, not on something we're about to change.

---

## 1. Install a dedicated Node 22 (leaves system Node alone)

```bash
sudo apt update
sudo apt -y install curl git ca-certificates xz-utils ffmpeg

cd /tmp
VER=v22.20.0   # latest 22.x LTS — check https://nodejs.org/dist/latest-v22.x/
ARCH=linux-x64 # use linux-arm64 on an ARM Linode
curl -fsSLO "https://nodejs.org/dist/$VER/node-$VER-$ARCH.tar.xz"
sudo mkdir -p /opt/node22
sudo tar -xJf "node-$VER-$ARCH.tar.xz" -C /opt/node22 --strip-components=1

/opt/node22/bin/node -v          # v22.20.0
node -v                          # UNCHANGED — still your old system Node
```

Nothing is added to `PATH`, so `node`/`npm` for every other app and user stay
exactly as they were. Only this bot's systemd unit and `deploy/update.sh`
reference `/opt/node22/bin`.

To upgrade within 22.x later: re-extract a newer tarball into `/opt/node22` and
`systemctl restart guessjockey`.

### ffmpeg (required)

Install the system ffmpeg — the bot prefers it over the bundled `ffmpeg-static`,
whose build can't open HTTPS URLs on some hosts:

```bash
sudo apt -y install ffmpeg
ffmpeg -version | head -1     # 4.x or newer is fine
```

The bot logs which binary it chose at startup: `[ffmpeg] using: ffmpeg`. Set
`FFMPEG_PATH=/usr/bin/ffmpeg` in `.env` to force a specific one.

Build tools generally aren't needed (`opusscript` is pure JS, AES-GCM uses Node's
built-in crypto); add `build-essential python3` only if `npm ci` prints a
node-gyp error for the optional DAVE dep.

---

## 2. Service user and app directory

```bash
sudo useradd --system --create-home --home-dir /opt/guessjockey --shell /bin/bash guessjockey
sudo install -d -o guessjockey -g guessjockey /opt/guessjockey
```

---

## 2. Service user and app directory

```bash
sudo useradd --system --create-home --home-dir /opt/guessjockey --shell /bin/bash guessjockey
sudo install -d -o guessjockey -g guessjockey /opt/guessjockey
```

---

## 3. Get the code onto the server

### Option A — git (recommended)

Push your local repo to GitHub/GitLab first, then on the server:

```bash
sudo -iu guessjockey
git clone https://github.com/<you>/GuessJockey.git /opt/guessjockey
# (private repo: use a deploy key or a PAT in the URL)
exit
```

If `/opt/guessjockey` already exists and is non-empty, clone into a temp dir and
move the contents, or `git init` + `git remote add` + `git pull`.

### Option B — copy from your Windows machine

From the project folder in **Git Bash** or WSL:

```bash
rsync -avz --delete \
  --exclude node_modules --exclude .env --exclude .git \
  ./ guessjockey@<LINODE_IP>:/opt/guessjockey/
```

(no rsync? `scp -r` the folder, minus `node_modules` and `.env`.)

---

## 4. Install dependencies (with the dedicated Node 22)

```bash
sudo -u guessjockey -H bash -lc \
  'cd /opt/guessjockey && PATH=/opt/node22/bin:$PATH /opt/node22/bin/npm ci --omit=dev'
```

The `PATH=` prefix makes any build step (e.g. `ffmpeg-static`) use Node 22 too.

---

## 5. Create the `.env` on the server

```bash
sudo -u guessjockey -H nano /opt/guessjockey/.env
```

```
DISCORD_TOKEN=your-real-bot-token
DISCORD_CLIENT_ID=822236940626821120
DISCORD_GUILD_ID=
DELETE_CHANNEL_AFTER_GAME=true
```

Lock it down:

```bash
sudo chmod 600 /opt/guessjockey/.env
sudo chown guessjockey:guessjockey /opt/guessjockey/.env
```

Leave `DISCORD_GUILD_ID` blank for global commands (what you want in production).
It's already in `.gitignore`, so it is never committed.

---

## 6. Register the slash command (one-time, and after any command change)

```bash
sudo -u guessjockey -H bash -lc \
  'cd /opt/guessjockey && /opt/node22/bin/node src/deploy-commands.js'
```

Expect `🔑 Token OK …` then `✅ Registered 1 global command(s)`. Global commands
can take up to ~1h to appear the very first time.

---

## 7. Install and start the systemd service

```bash
sudo cp /opt/guessjockey/deploy/guessjockey.service /etc/systemd/system/guessjockey.service

# The unit points ExecStart at /opt/node22/bin/node. Confirm it exists:
/opt/node22/bin/node -v

sudo systemctl daemon-reload
sudo systemctl enable --now guessjockey
```

Verify:

```bash
systemctl status guessjockey
journalctl -u guessjockey -f          # live logs; Ctrl-C to stop tailing
```

You want to see `🎧 Logged in as Guess Jockey#8431`.

---

## 7b. Confirm the other apps are untouched

```bash
node -v                    # still your ORIGINAL system version (e.g. v20.20.x)
sudo ss -tlnp              # same ports listening as in §0
```

Then hit each site/service you noted in §0:

```bash
systemctl is-active nginx apache2 <your-other-service>   # active
curl -sI http://127.0.0.1:<port> | head -1               # per local app port
command -v pm2 >/dev/null && pm2 list                     # all "online"
```

Load the public URLs in a browser. Check for fresh errors:

```bash
journalctl --since "10 min ago" -p warning --no-pager | tail -50
```

Because we never ran `apt install nodejs` or changed `PATH`, the system Node and
every process using it are byte-for-byte what they were. If anything *does* look
off, it's coincidental — `sudo systemctl restart <that-service>` and it's back;
stopping `guessjockey` cannot affect it.

---

## 8. Updates / redeploys

```bash
cd /opt/guessjockey && bash deploy/update.sh
```

It does `git pull` → `npm ci` (with `/opt/node22`) → `systemctl restart` and
prints status. Re-run the §6 command too if you changed `src/commands.js`.

Manual control:

```bash
sudo systemctl restart guessjockey
sudo systemctl stop guessjockey
sudo systemctl start guessjockey
```

---

## 9. Firewall (optional but recommended)

Nothing inbound is needed except SSH:

```bash
sudo ufw allow OpenSSH
sudo ufw --force enable
sudo ufw status
```

Outbound (Discord voice UDP, HTTPS) is unrestricted by default — that's what the
bot needs. If you also use **Linode Cloud Firewall**, set inbound to SSH-only and
leave outbound `Accept all`.

---

## About "no downtime"

A bot has **one** gateway connection per token, so you can't run two copies for a
hot swap — the second just fights the first. Realistically:

| Event | What happens | Downtime |
| --- | --- | --- |
| Node process crashes | `Restart=always` brings it back | ~3 s |
| Discord gateway hiccup / network blip | discord.js resumes the session itself | none, no restart |
| You deploy an update | `systemctl restart` | ~3–5 s |
| Server reboot | `systemctl enable` starts it on boot | boot time |

A restart **kills any game in progress** (the bot leaves voice, the guesses
channel is orphaned). Deploy when nothing is running, or run `/guessjockey stop`
in each active server first. The `SIGTERM` handler in `src/index.js` ends active
games and disconnects cleanly so restarts don't leave ghost voice sessions.

If you later need genuinely seamless restarts, that means sharding + a
zero-downtime handoff layer (e.g. a gateway proxy). Overkill for one bot; revisit
only if you're in hundreds of servers.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `401 Unauthorized` when registering | Token wrong/rotated. `src/deploy-commands.js` prints a precise reason now. |
| `EBADENGINE` / `Unsupported engine` on `npm ci` | You ran system `npm` (Node 20). Use `/opt/node22/bin/npm` as shown in §4. |
| `systemd` fails with `203/EXEC` or `no such file` | `/opt/node22/bin/node` missing — redo §1, or fix `ExecStart` path in the unit. |
| Service keeps restarting | `journalctl -u guessjockey -n 100 --no-pager` — usually a bad `.env` or missing dependency. |
| Joins voice, no audio, `stuck at "connecting"` | UDP egress blocked. Check Linode Cloud Firewall outbound = Accept all; check `ufw` didn't add outbound rules. |
| Joins voice, every round "hit a snag" | ffmpeg problem. `journalctl -u guessjockey \| grep ffmpeg` — usually `[ffmpeg] using:` points at the `ffmpeg-static` bundle. `apt -y install ffmpeg`, restart. |
| `stuck at "signalling"` | Bot missing **Connect** in that voice channel, or `GuildVoiceStates` intent off. |
| Commands don't show in Discord | Global registration lag (~1h first time), or set `DISCORD_GUILD_ID` to test instantly. |
| Wrong clock → gateway auth fails | `timedatectl` — `System clock synchronized: yes`. |

Handy:

```bash
systemctl status guessjockey
journalctl -u guessjockey -f
journalctl -u guessjockey --since "10 min ago" --no-pager
sudo -u guessjockey -H bash -lc 'cd /opt/guessjockey && /opt/node22/bin/node -e "console.log(require(\"@discordjs/voice\").generateDependencyReport())"'
```
