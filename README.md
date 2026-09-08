# 🎧 Guess Jockey — Discord bot

A "name that tune" party game for Discord.

1. Someone runs `/guessjockey start`.
2. The bot posts a **lobby** — players click **Join**, the host clicks **Start**.
3. The bot creates a dedicated **`#guess-jockey-xxxx`** channel and joins your voice channel.
4. Each round it plays a ~20s clip of a song. Players type the **artist** and the **song title** in the channel.
5. Points are awarded **separately** for artist and title. First correct gets the most; each person after gets less. The first solver of each also gets a small speed bonus.
6. After the last round the bot posts the final leaderboard and (by default) deletes the game channel.

Song clips are the **30‑second previews from Deezer's free public API** — no account or key needed.

---

## Requirements

- **Node.js 18.17+** (uses the built‑in `fetch`).
- No separate FFmpeg install — `ffmpeg-static` is bundled.
- The **Message Content Intent** must be enabled for your bot (see below) so it can read guesses.

## 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Add Bot**. Copy the **token**.
3. Still on the **Bot** tab, enable **Message Content Intent** (under "Privileged Gateway Intents"). Save.
4. **General Information** tab → copy the **Application ID** (this is your client ID).

## 2. Invite the bot

**OAuth2 → URL Generator**:

- Scopes: `bot`, `applications.commands`
- Bot permissions: **View Channels**, **Send Messages**, **Embed Links**, **Add Reactions**,
  **Read Message History**, **Manage Channels**, **Connect**, **Speak**,
  **Create Public Threads**, **Send Messages in Threads**

(That permissions integer is `309240876112` if you want to build the URL by hand.)

`Manage Channels` lets the bot create the per‑game channel; without it, it falls back to a thread.

Open the generated URL and add the bot to your server.

## 3. Configure

```bash
cd guess-jockey-bot
npm install
cp .env.example .env
```

Edit `.env`:

```
DISCORD_TOKEN=...        # from step 1.2
DISCORD_CLIENT_ID=...    # from step 1.4
DISCORD_GUILD_ID=...     # your test server ID -> commands register instantly
```

## 4. Register the slash command, then run

```bash
npm run deploy     # one-time (re-run whenever commands change)
npm start
```

## Playing

| Command | What it does |
| --- | --- |
| `/guessjockey start` | Open a lobby. Options: `rounds` (1–20), `clip` (5–29s), `genre`, `playlist` (Deezer URL/ID), `voice` (channel). |
| `/guessjockey stop` | Host or a mod ends the current game. |
| `/guessjockey standings` | Show the current scoreboard. |

You must be **in a voice channel** when you run `start` (or pass one with the `voice` option).

Guesses can be sent as two messages (`queen`, then `bohemian rhapsody`) or one (`queen - bohemian rhapsody`).
Matching is fuzzy — minor typos, missing "the", accents, and `feat.`/remaster tags are tolerated.
A 🔥 reaction means "close but not quite".

## Tuning

Everything lives in [`src/config.js`](src/config.js):

- `defaults.rounds`, `defaults.clipSeconds`, `defaults.guessSecondsAfterClip`
- `defaults.lobbySeconds`, `defaults.minPlayers` (set to `1` to practise solo)
- `defaults.graceAfterBothSolved` — extra time once both parts are found
- `defaults.deleteChannelAfterGame` / `deleteChannelDelayMs`
- `scoring.*` — base points, the per‑order multiplier table, speed bonus
- `matching.threshold` — how strict guess matching is (0–1)

## How it fits together

```
src/
  index.js            client + intents, command routing, message -> game.handleGuess
  commands.js          slash command definition (shared by deploy + runtime)
  deploy-commands.js   registers the slash command with Discord
  config.js            all knobs
  deezer.js            keyless Deezer API client + track-pool builder
  audio/player.js      voice connection + "play this slice of the preview" helper
  ui/embeds.js         lobby / round / leaderboard embeds
  game/
    GameManager.js     one game per guild
    Game.js            lobby -> setup -> round loop -> scoring -> finish
    matching.js        normalize + fuzzy match a guess against artist/title
    scoring.js         order-based points with a speed bonus
```

## Notes / limits

- One game per server at a time.
- Players can't join mid‑game (only during the lobby).
- Deezer previews are region‑restricted for a few tracks; the pool is built with spares and a bad clip just skips.
- If `@discordjs/opus` is installed it will be used automatically (faster); `opusscript` is the pure‑JS fallback that ships here.
