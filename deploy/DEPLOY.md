# Deploying Guess Jockey on a Linode (Ubuntu + systemd)

This runs the bot as a locked-down system user, restarts it automatically if it
crashes, and starts it on boot. Assumes **Ubuntu 22.04 / 24.04** and that you SSH
in as `root` or a `sudo` user. For Debian the steps are identical; for
RHEL/Alma/Rocky swap `apt` for `dnf` and `/usr/sbin/nologin` paths as noted.

The bot makes **only outbound** connections (Discord gateway/voice, Deezer). No
inbound ports, no reverse proxy, no domain needed.

---

## 1. System packages

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install curl git ca-certificates

# Node.js 22 LTS from NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs

# Build tools — only needed if an optional native dep (DAVE E2EE) has no prebuilt
# binary for your arch. Cheap insurance; skip if you want and add later only if
# `npm ci` complains.
sudo apt -y install build-essential python3

node -v   # expect v22.x
```

`ffmpeg` is **not** required system-wide — `ffmpeg-static` pulls a Linux binary
during `npm ci`.

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

## 4. Install dependencies

```bash
sudo -u guessjockey -H bash -lc 'cd /opt/guessjockey && npm ci --omit=dev'
```

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
sudo -u guessjockey -H bash -lc 'cd /opt/guessjockey && npm run deploy'
```

Expect `🔑 Token OK …` then `✅ Registered 1 global command(s)`. Global commands
can take up to ~1h to appear the very first time.

---

## 7. Install and start the systemd service

```bash
sudo cp /opt/guessjockey/deploy/guessjockey.service /etc/systemd/system/guessjockey.service
# Confirm the node path matches your box:
which node   # if not /usr/bin/node, edit ExecStart in the unit file

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

## 8. Updates / redeploys

```bash
cd /opt/guessjockey && bash deploy/update.sh
```

It does `git pull` → `npm ci` → `systemctl restart` (as the right users) and
prints status. Run `npm run deploy` too if you changed `src/commands.js`.

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
| `401 Unauthorized` on `npm run deploy` | Token wrong/rotated. `npm run deploy` prints a precise reason now. |
| Service keeps restarting | `journalctl -u guessjockey -n 100 --no-pager` — usually a bad `.env` or missing dependency. |
| Joins voice, no audio, `stuck at "connecting"` | UDP egress blocked. Check Linode Cloud Firewall outbound = Accept all; check `ufw` didn't add outbound rules. |
| `stuck at "signalling"` | Bot missing **Connect** in that voice channel, or `GuildVoiceStates` intent off. |
| Commands don't show in Discord | Global registration lag (~1h first time), or set `DISCORD_GUILD_ID` to test instantly. |
| Wrong clock → gateway auth fails | `timedatectl` — `System clock synchronized: yes`. |

Handy:

```bash
systemctl status guessjockey
journalctl -u guessjockey -f
journalctl -u guessjockey --since "10 min ago" --no-pager
sudo -u guessjockey -H bash -lc 'cd /opt/guessjockey && node -e "console.log(require(\"@discordjs/voice\").generateDependencyReport())"'
```
