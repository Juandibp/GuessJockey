'use strict';

const { EmbedBuilder } = require('discord.js');

const BLURPLE = 0x5865f2;
const GOLD = 0xf1c40f;
const MEDALS = ['🥇', '🥈', '🥉'];

function lobbyEmbed(game) {
  const players =
    [...game.players.values()].map((p) => `• ${p.tag}`).join('\n') ||
    '_No one yet — be the first!_';

  return new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle('🎧 Guess Jockey — Lobby')
    .setDescription(
      'Click **Join** to sign up. The host clicks **Start** when everyone is in.\n' +
        `Auto-starts when the timer runs out (if at least ${game.minPlayers} players joined).`
    )
    .addFields(
      {
        name: 'Setup',
        value:
          `**Rounds:** ${game.options.rounds}\n` +
          `**Clip length:** ${game.options.clipSeconds}s\n` +
          `**Songs from:** ${game.options.sourceLabel}`,
        inline: true,
      },
      {
        name: `Players (${game.players.size})`,
        value: players,
        inline: true,
      }
    )
    .setFooter({ text: `Host: ${game.host.username}` });
}

function roundIntroEmbed(n, total, clipSeconds) {
  return new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle(`🔊 Round ${n} / ${total}`)
    .setDescription(
      'Listen, then type your guesses for the **artist** and the **song title**.\n' +
        'Send them separately, or together as `Artist - Title`.'
    )
    .setFooter({ text: `Clip: ${clipSeconds}s — you can guess while it plays` });
}

function solverList(solvers, players) {
  if (!solvers.length) return '_Nobody got it_';
  return solvers
    .map((s, i) => {
      const who = players.get(s.id)?.tag ?? 'someone';
      const mark = MEDALS[i] ?? `#${i + 1}`;
      return `${mark} ${who} — +${s.pts}`;
    })
    .join('\n');
}

function roundResultEmbed(round, players) {
  const t = round.track;
  return new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`Round ${round.n} — answer`)
    .setDescription(
      `🎵 **${t.title}**\n🎤 **${t.artist}**` +
        (t.album ? `\n💿 ${t.album}` : '')
    )
    .setThumbnail(t.cover || null)
    .addFields(
      { name: 'Guessed the artist', value: solverList(round.artistSolvers, players), inline: true },
      { name: 'Guessed the title', value: solverList(round.titleSolvers, players), inline: true }
    );
}

function leaderboardEmbed(game, { final = false } = {}) {
  const ranked = [...game.players.values()].sort((a, b) => b.score - a.score);
  const lines =
    ranked
      .map((p, i) => {
        const medal = MEDALS[i] ?? `\`#${String(i + 1).padStart(2, ' ')}\``;
        return `${medal} **${p.tag}** — ${p.score}`;
      })
      .join('\n') || '_No scores yet_';

  return new EmbedBuilder()
    .setColor(final ? GOLD : BLURPLE)
    .setTitle(final ? '🏆 Final results' : '📊 Standings')
    .setDescription(lines);
}

module.exports = {
  lobbyEmbed,
  roundIntroEmbed,
  roundResultEmbed,
  leaderboardEmbed,
};
