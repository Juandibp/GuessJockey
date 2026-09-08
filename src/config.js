'use strict';

require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID || null,

  defaults: {
    rounds: 10,
    clipSeconds: 20,
    guessSecondsAfterClip: 25, // extra time to keep guessing once the clip stops
    lobbySeconds: 90, // how long the lobby stays open before it auto-starts
    minPlayers: 2, // lower to 1 if you want to practice solo
    graceAfterBothSolved: 8, // once artist + title are both found, others get this long
    interRoundDelayMs: 4000,

    deleteChannelAfterGame: process.env.DELETE_CHANNEL_AFTER_GAME !== 'false',
    deleteChannelDelayMs: 120_000,
  },

  scoring: {
    artistPoints: 100,
    titlePoints: 100,
    // Multiplier applied by finishing order for each component (0 = first, 1 = second, ...).
    orderMultipliers: [1, 0.7, 0.5, 0.35, 0.25],
    laterMultiplier: 0.15, // for 5th+ place
    speedBonusMax: 30, // only the first solver of a component; scales with time left in the window
  },

  matching: {
    threshold: 0.82, // similarity (0..1) required to count a guess as correct
    closeThreshold: 0.66, // similarity that earns a "so close" reaction but not points
  },

  deezer: {
    api: 'https://api.deezer.com',
    // Deezer genre/chart IDs -> friendly names offered as a slash-command choice.
    genres: {
      all: 0,
      pop: 132,
      rock: 152,
      rap: 116,
      dance: 113,
      rnb: 165,
      alternative: 85,
      jazz: 129,
      classical: 98,
      metal: 464,
    },
  },
};
