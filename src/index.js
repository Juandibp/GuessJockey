'use strict';

const {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
require('@noble/ciphers/chacha'); // ensure the voice encryption backend resolves

const { token, defaults, deezer } = require('./config');
const manager = require('./game/GameManager');
const { Game } = require('./game/Game');
const { parsePlaylistId } = require('./deezer');
const embeds = require('./ui/embeds');

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — enable it in the Dev Portal
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`🎧 Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'guessjockey') return;

  const sub = interaction.options.getSubcommand();

  try {
    if (sub === 'stop') return void (await handleStop(interaction));
    if (sub === 'standings') return void (await handleStandings(interaction));
    if (sub === 'start') return void (await handleStart(interaction));
  } catch (err) {
    console.error('command handler error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: 'Something went wrong.', ...EPHEMERAL }).catch(() => {});
    }
  }
});

async function handleStop(interaction) {
  const game = manager.get(interaction.guildId);
  if (!game) {
    return interaction.reply({ content: 'No game is running.', ...EPHEMERAL });
  }
  if (
    game.host.id !== interaction.user.id &&
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return interaction.reply({
      content: 'Only the host or a mod can stop the game.',
      ...EPHEMERAL,
    });
  }
  await interaction.reply({ content: 'Stopping the game…', ...EPHEMERAL });
  await game.finish('stopped');
}

async function handleStandings(interaction) {
  const game = manager.get(interaction.guildId);
  if (!game) {
    return interaction.reply({ content: 'No game is running.', ...EPHEMERAL });
  }
  return interaction.reply({ embeds: [embeds.leaderboardEmbed(game)] });
}

async function handleStart(interaction) {
  if (manager.has(interaction.guildId)) {
    return interaction.reply({
      content: 'A game is already running in this server.',
      ...EPHEMERAL,
    });
  }

  const voiceChannel =
    interaction.options.getChannel('voice') ?? interaction.member?.voice?.channel;
  if (
    !voiceChannel ||
    ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(voiceChannel.type)
  ) {
    return interaction.reply({
      content: 'Join a voice channel first, or pass one with the `voice` option.',
      ...EPHEMERAL,
    });
  }

  const me = await interaction.guild.members.fetchMe();
  const vperms = voiceChannel.permissionsFor(me);
  if (!vperms?.has(PermissionFlagsBits.Connect) || !vperms?.has(PermissionFlagsBits.Speak)) {
    return interaction.reply({
      content: `I need **Connect** and **Speak** in ${voiceChannel}.`,
      ...EPHEMERAL,
    });
  }

  const rounds = interaction.options.getInteger('rounds') ?? defaults.rounds;
  const clipSeconds = interaction.options.getInteger('clip') ?? defaults.clipSeconds;
  const genre = interaction.options.getString('genre') ?? 'all';
  const playlistRaw = interaction.options.getString('playlist');
  const playlistId = playlistRaw ? parsePlaylistId(playlistRaw) : null;

  if (playlistRaw && !playlistId) {
    return interaction.reply({
      content: "That doesn't look like a Deezer playlist URL or ID.",
      ...EPHEMERAL,
    });
  }

  const options = {
    rounds,
    clipSeconds,
    guessSeconds: defaults.guessSecondsAfterClip,
    source: playlistId ? 'playlist' : 'chart',
    genreId: deezer.genres[genre] ?? 0,
    playlistId,
    sourceLabel: playlistId
      ? `Deezer playlist \`${playlistId}\``
      : `${genre} charts`,
  };

  await interaction.reply({ content: '🎧 Opening a lobby…' });

  const game = new Game({
    manager,
    guild: interaction.guild,
    host: interaction.user,
    hostMember: interaction.member,
    voiceChannel,
    lobbyChannel: interaction.channel,
    options,
  });
  manager.add(game);

  let outcome;
  try {
    outcome = await game.runLobby();
  } catch (err) {
    console.error('lobby error:', err);
    manager.remove(interaction.guildId);
    return interaction.editReply({ content: 'Failed to open the lobby.' }).catch(() => {});
  }

  if (outcome !== 'started') {
    manager.remove(interaction.guildId);
    await interaction
      .editReply({
        content:
          outcome === 'cancelled'
            ? '❌ Lobby cancelled.'
            : '⌛ Not enough players — lobby closed.',
      })
      .catch(() => {});
    return;
  }

  await interaction
    .editReply({ content: '✅ Game starting — check the new channel!' })
    .catch(() => {});

  try {
    await game.run();
  } catch (err) {
    console.error('game run error:', err);
    await game.finish('error').catch(() => {});
  }
}

client.on(Events.MessageCreate, (message) => {
  if (!message.guild || message.author.bot) return;
  const game = manager.get(message.guild.id);
  if (!game || !game.guessChannel || message.channelId !== game.guessChannel.id) return;
  game.handleGuess(message).catch((err) => console.error('handleGuess error:', err));
});

process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));

if (!token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}
client.login(token);
