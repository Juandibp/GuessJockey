'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const {
  entersState,
  VoiceConnectionStatus,
  getVoiceConnection,
} = require('@discordjs/voice');

const { connect, createPlayer, playClip } = require('../audio/player');
const { buildTrackPool } = require('../deezer');
const { isMatch, closeness } = require('./matching');
const { componentPoints } = require('./scoring');
const embeds = require('../ui/embeds');
const { defaults, scoring, matching } = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const ordinal = (n) => ['1st', '2nd', '3rd'][n - 1] ?? `${n}th`;

/** Split "Queen - Bohemian Rhapsody" style guesses into checkable pieces. */
function candidateParts(msg) {
  const parts = new Set([msg]);
  const split = msg
    .split(/\s*[-–—:]\s+|\s+by\s+|\s*,\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (split.length > 1) for (const s of split) parts.add(s);
  return [...parts];
}

class Game {
  constructor({ manager, guild, host, hostMember, voiceChannel, lobbyChannel, options }) {
    this.manager = manager;
    this.guild = guild;
    this.host = host; // User
    this.hostMember = hostMember;
    this.voiceChannel = voiceChannel;
    this.lobbyChannel = lobbyChannel;
    this.options = options;
    this.minPlayers = defaults.minPlayers;

    /** @type {Map<string, {id: string, tag: string, score: number}>} */
    this.players = new Map();
    this.state = 'idle'; // idle -> lobby -> starting -> playing -> ended

    this.guessChannel = null;
    this.channelIsThread = false;
    this.connection = null;
    this.player = null;
    this.tracks = [];
    this.round = null;
    this._ended = false;
  }

  // --------------------------------------------------------------- players ---

  addPlayer(user) {
    if (!this.players.has(user.id)) {
      this.players.set(user.id, { id: user.id, tag: user.username, score: 0 });
    }
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  isHostOrMod(userId, memberPermissions) {
    if (userId === this.host.id) return true;
    return Boolean(
      memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
        memberPermissions?.has(PermissionFlagsBits.Administrator)
    );
  }

  // ----------------------------------------------------------------- lobby ---

  lobbyComponents(disabled = false) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('gj_join')
          .setLabel('Join')
          .setStyle(ButtonStyle.Success)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('gj_leave')
          .setLabel('Leave')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('gj_start')
          .setLabel('Start')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('gj_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled)
      ),
    ];
  }

  /**
   * Post the lobby and wait for it to resolve.
   * @returns {Promise<'started'|'cancelled'|'timeout'>}
   */
  async runLobby() {
    this.state = 'lobby';
    this.addPlayer(this.host);

    const msg = await this.lobbyChannel.send({
      embeds: [embeds.lobbyEmbed(this)],
      components: this.lobbyComponents(),
    });
    this.lobbyMessage = msg;

    const collector = msg.createMessageComponentCollector({
      time: defaults.lobbySeconds * 1000,
    });

    const refresh = () =>
      msg
        .edit({ embeds: [embeds.lobbyEmbed(this)], components: this.lobbyComponents() })
        .catch(() => {});

    return new Promise((resolve) => {
      let outcome = 'timeout';

      collector.on('collect', async (i) => {
        try {
          if (i.customId === 'gj_join') {
            this.addPlayer(i.user);
            await i.reply({ content: "✅ You're in the game!", flags: MessageFlags.Ephemeral });
            refresh();
          } else if (i.customId === 'gj_leave') {
            this.removePlayer(i.user.id);
            await i.reply({ content: '👋 You left the lobby.', flags: MessageFlags.Ephemeral });
            refresh();
          } else if (i.customId === 'gj_start') {
            if (!this.isHostOrMod(i.user.id, i.memberPermissions)) {
              await i.reply({ content: 'Only the host can start the game.', flags: MessageFlags.Ephemeral });
              return;
            }
            if (this.players.size < this.minPlayers) {
              await i.reply({
                content: `Need at least ${this.minPlayers} players to start.`,
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            outcome = 'started';
            await i.reply({ content: '🎬 Starting…', flags: MessageFlags.Ephemeral });
            collector.stop('started');
          } else if (i.customId === 'gj_cancel') {
            if (!this.isHostOrMod(i.user.id, i.memberPermissions)) {
              await i.reply({ content: 'Only the host can cancel.', flags: MessageFlags.Ephemeral });
              return;
            }
            outcome = 'cancelled';
            await i.reply({ content: 'Lobby cancelled.', flags: MessageFlags.Ephemeral });
            collector.stop('cancelled');
          }
        } catch (err) {
          console.error('lobby collect error:', err);
        }
      });

      collector.on('end', async () => {
        await msg
          .edit({
            embeds: [embeds.lobbyEmbed(this)],
            components: this.lobbyComponents(true),
          })
          .catch(() => {});
        if (outcome === 'timeout' && this.players.size >= this.minPlayers) {
          outcome = 'started';
        }
        resolve(outcome);
      });
    });
  }

  // ----------------------------------------------------------------- setup ---

  async setup() {
    // 1. Build the track list (a few spares in case a preview 404s at play time).
    const need = this.options.rounds + 5;
    this.tracks = await buildTrackPool({
      source: this.options.source,
      genreId: this.options.genreId,
      playlistId: this.options.playlistId,
      count: need,
    });

    // 2. Create the per-game guesses channel. Fall back to a thread if the bot
    //    can't make channels.
    const me = this.guild.members.me ?? (await this.guild.members.fetchMe());
    const short = Math.random().toString(36).slice(2, 6);
    const overwrites = [
      {
        id: this.guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel],
        deny: [PermissionFlagsBits.SendMessages],
      },
      {
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AddReactions,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      ...[...this.players.keys()].map((id) => ({
        id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      })),
    ];

    try {
      this.guessChannel = await this.guild.channels.create({
        name: `guess-jockey-${short}`,
        type: ChannelType.GuildText,
        parent: this.lobbyChannel.parentId ?? undefined,
        topic: `🎧 Guess Jockey — host ${this.host.username}. Guess the artist & title here.`,
        permissionOverwrites: overwrites,
        reason: 'Guess Jockey session channel',
      });
      this.channelIsThread = false;
    } catch (err) {
      console.warn('Channel create failed, trying a thread instead:', err.message);
      this.guessChannel = await this.lobbyChannel.threads.create({
        name: `guess-jockey-${short}`,
        autoArchiveDuration: 60,
        reason: 'Guess Jockey session thread',
      });
      this.channelIsThread = true;
      for (const id of this.players.keys()) {
        this.guessChannel.members.add(id).catch(() => {});
      }
    }

    // 3. Join voice and wire up a single reusable audio player.
    this.connection = connect(this.voiceChannel);
    this.connection.on('error', (e) => console.error('voice connection error:', e));
    if (process.env.VOICE_DEBUG) {
      this.connection.on('debug', (m) => console.log('[voice:debug]', m));
    }
    this.connection.on('stateChange', (oldS, newS) => {
      console.log(`[voice] ${oldS.status} -> ${newS.status}`);
      // Surface the underlying voice-websocket close code / handshake step.
      const net = newS.networking;
      if (net && net !== oldS.networking) {
        net.on('error', (e) => console.error('[voice:net] error:', e.message));
        net.on('close', (code) => console.error('[voice:net] ws closed, code', code));
        net.on('stateChange', (o, n) =>
          console.log(`[voice:net] ${o.code ?? '?'} -> ${n.code ?? '?'}`)
        );
      }
    });
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.finish('disconnected').catch(() => {});
      }
    });

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      const stuckAt = this.connection.state.status;
      try {
        this.connection.destroy();
      } catch {}
      throw new Error(
        `voice connection never became ready (stuck at "${stuckAt}"). ` +
          'If it stalls at "connecting", UDP is being blocked — check Windows Firewall / ' +
          'any VPN, and allow node.exe. If it stalls at "signalling", the bot is missing ' +
          'the Connect permission or the GuildVoiceStates intent.'
      );
    }

    this.player = createPlayer();
    this.player.on('error', (e) => console.error('audio player error:', e.message));
    this.connection.subscribe(this.player);
  }

  // ------------------------------------------------------------------- run ---

  async run() {
    this.state = 'starting';
    try {
      await this.setup();
    } catch (err) {
      console.error('setup failed:', err);
      await this.lobbyChannel
        .send(`⚠️ Couldn't start the game: ${err.message}`)
        .catch(() => {});
      await this.finish('error');
      return;
    }

    this.state = 'playing';

    await this.guessChannel
      .send({
        content: [...this.players.keys()].map((id) => `<@${id}>`).join(' '),
        embeds: [
          {
            color: 0x5865f2,
            title: '🎧 Guess Jockey starting!',
            description:
              `**${this.options.rounds}** rounds · **${this.options.clipSeconds}s** clips\n` +
              'Type the **artist** and the **song title**. Points for each, most for getting there first, ' +
              'less for each person after.\n' +
              `You can guess during the clip and for **${this.options.guessSeconds}s** after it ends.`,
          },
        ],
      })
      .catch(() => {});
    await sleep(3000);

    for (let n = 1; n <= this.options.rounds; n++) {
      if (this._ended) break;
      const track = this.tracks.shift();
      if (!track) break;

      try {
        await this.playRound(track, n);
      } catch (err) {
        console.error(`round ${n} error:`, err.message);
        await this.guessChannel
          ?.send(`⚠️ Round ${n} hit a snag — moving on.`)
          .catch(() => {});
      }

      if (!this._ended && n < this.options.rounds) {
        await this.guessChannel
          ?.send({ embeds: [embeds.leaderboardEmbed(this)] })
          .catch(() => {});
        await sleep(defaults.interRoundDelayMs);
      }
    }

    await this.finish('completed');
  }

  // ----------------------------------------------------------------- round ---

  randomStart(clipSeconds) {
    const previewLength = 30;
    const max = Math.max(0, previewLength - clipSeconds - 1);
    return Math.floor(Math.random() * (max + 1));
  }

  fractionRemaining() {
    const r = this.round;
    if (!r) return 0;
    return clamp((r.windowEnd - Date.now()) / r.windowMs, 0, 1);
  }

  async playRound(track, n) {
    const clipSeconds = this.options.clipSeconds;
    const windowMs = (clipSeconds + this.options.guessSeconds) * 1000;

    this.round = {
      n,
      track,
      accepting: true,
      ended: false,
      artistSolvers: [], // [{ id, pts }]
      titleSolvers: [],
      gotArtist: new Set(),
      gotTitle: new Set(),
      solvedBoth: new Set(),
      windowMs,
      windowEnd: Date.now() + windowMs,
      resolve: null,
      hardTimer: null,
      graceTimer: null,
    };

    await this.guessChannel.send({
      embeds: [embeds.roundIntroEmbed(n, this.options.rounds, clipSeconds)],
    });

    // Reset the window so message latency doesn't eat into guessing time.
    this.round.windowEnd = Date.now() + windowMs;

    const start = this.randomStart(clipSeconds);
    await playClip(this.player, track.preview, { start, duration: clipSeconds });

    // The round can already be over if everyone solved it while the clip played.
    if (!this.round.ended) {
      await this.guessChannel
        .send(`⏳ Clip over — **${this.options.guessSeconds}s** left to guess!`)
        .catch(() => {});

      await new Promise((resolve) => {
        this.round.resolve = resolve;
        if (this.round.ended) return resolve('already');
        const left = Math.max(1000, this.round.windowEnd - Date.now());
        this.round.hardTimer = setTimeout(() => this.endRound('timeup'), left);
        this.maybeEndRound();
      });
    }

    this.round.accepting = false;
    await this.guessChannel
      .send({ embeds: [embeds.roundResultEmbed(this.round, this.players)] })
      .catch(() => {});
    await sleep(3500);
  }

  endRound(reason) {
    const r = this.round;
    if (!r || r.ended) return;
    r.ended = true;
    clearTimeout(r.hardTimer);
    clearTimeout(r.graceTimer);
    r.resolve?.(reason);
  }

  maybeEndRound() {
    const r = this.round;
    if (!r || r.ended) return;

    const ids = [...this.players.keys()];
    if (ids.length && ids.every((id) => r.solvedBoth.has(id))) {
      return this.endRound('all-solved');
    }

    if (r.artistSolvers.length && r.titleSolvers.length && !r.graceTimer) {
      const graceMs = defaults.graceAfterBothSolved * 1000;
      if (r.windowEnd - Date.now() > graceMs) {
        r.windowEnd = Date.now() + graceMs;
        clearTimeout(r.hardTimer);
        r.hardTimer = setTimeout(() => this.endRound('grace'), graceMs);
        this.guessChannel
          .send(
            `✅ Both parts cracked — **${defaults.graceAfterBothSolved}s** grace for everyone else!`
          )
          .catch(() => {});
      }
    }
  }

  // ---------------------------------------------------------------- guesses ---

  async handleGuess(message) {
    const r = this.round;
    if (this.state !== 'playing' || !r || !r.accepting || r.ended) return;
    if (!this.players.has(message.author.id)) return;

    const content = message.content.trim();
    if (!content) return;

    const pid = message.author.id;
    const player = this.players.get(pid);
    const parts = candidateParts(content);

    let newArtist = false;
    let newTitle = false;

    if (
      !r.gotArtist.has(pid) &&
      parts.some((p) => isMatch(p, r.track.artist, matching.threshold))
    ) {
      r.gotArtist.add(pid);
      const rank = r.artistSolvers.length;
      const pts = componentPoints({
        base: scoring.artistPoints,
        rank,
        fractionRemaining: this.fractionRemaining(),
        isFirst: rank === 0,
      });
      r.artistSolvers.push({ id: pid, pts });
      player.score += pts;
      newArtist = true;
      this.guessChannel
        .send(`🎤 **${player.tag}** locked the **artist** — +${pts} _(${ordinal(rank + 1)})_`)
        .catch(() => {});
    }

    if (
      !r.gotTitle.has(pid) &&
      parts.some((p) => isMatch(p, r.track.title, matching.threshold))
    ) {
      r.gotTitle.add(pid);
      const rank = r.titleSolvers.length;
      const pts = componentPoints({
        base: scoring.titlePoints,
        rank,
        fractionRemaining: this.fractionRemaining(),
        isFirst: rank === 0,
      });
      r.titleSolvers.push({ id: pid, pts });
      player.score += pts;
      newTitle = true;
      this.guessChannel
        .send(`🎵 **${player.tag}** locked the **title** — +${pts} _(${ordinal(rank + 1)})_`)
        .catch(() => {});
    }

    if (r.gotArtist.has(pid) && r.gotTitle.has(pid) && !r.solvedBoth.has(pid)) {
      r.solvedBoth.add(pid);
      this.guessChannel.send(`🏆 **${player.tag}** nailed the full track!`).catch(() => {});
    }

    if (newArtist || newTitle) {
      message.react(r.solvedBoth.has(pid) ? '🏆' : '✅').catch(() => {});
      this.maybeEndRound();
      return;
    }

    // "so close" nudge
    let best = 0;
    for (const p of parts) {
      best = Math.max(
        best,
        closeness(p, r.track.artist),
        closeness(p, r.track.title)
      );
    }
    if (best >= matching.closeThreshold && best < matching.threshold) {
      message.react('🔥').catch(() => {});
    }
  }

  // ---------------------------------------------------------------- finish ---

  async finish(reason) {
    if (this._ended) return;
    this._ended = true;
    this.state = 'ended';

    if (this.round && !this.round.ended) this.endRound('game-over');

    try {
      this.player?.stop(true);
    } catch {}
    try {
      this.connection?.destroy();
    } catch {}
    try {
      getVoiceConnection(this.guild.id)?.destroy();
    } catch {}

    if (this.guessChannel) {
      const heading =
        reason === 'stopped'
          ? '🛑 Game stopped by the host.'
          : reason === 'disconnected'
            ? '🔌 Lost the voice connection — ending the game.'
            : reason === 'error'
              ? '⚠️ The game ended early due to an error.'
              : "🎉 That's a wrap!";

      await this.guessChannel
        .send({
          content: heading,
          embeds: [embeds.leaderboardEmbed(this, { final: true })],
        })
        .catch(() => {});

      if (this.channelIsThread) {
        setTimeout(() => this.guessChannel.setArchived(true).catch(() => {}), 10_000);
      } else if (defaults.deleteChannelAfterGame) {
        const secs = Math.round(defaults.deleteChannelDelayMs / 1000);
        await this.guessChannel
          .send(`🧹 This channel will be deleted in ${secs}s.`)
          .catch(() => {});
        const ch = this.guessChannel;
        setTimeout(
          () => ch.delete('Guess Jockey finished').catch(() => {}),
          defaults.deleteChannelDelayMs
        );
      }
    }

    this.manager.remove(this.guild.id);
  }
}

module.exports = { Game };
