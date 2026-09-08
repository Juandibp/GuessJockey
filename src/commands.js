'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { deezer } = require('./config');

const genreChoices = Object.keys(deezer.genres).map((k) => ({ name: k, value: k }));

const guessjockey = new SlashCommandBuilder()
  .setName('guessjockey')
  .setDescription('Guess Jockey — name the artist and song from a short clip')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription('Open a lobby and start a game')
      .addIntegerOption((o) =>
        o
          .setName('rounds')
          .setDescription('Number of rounds (1–20, default 10)')
          .setMinValue(1)
          .setMaxValue(20)
      )
      .addIntegerOption((o) =>
        o
          .setName('clip')
          .setDescription('Clip length in seconds (5–29, default 20)')
          .setMinValue(5)
          .setMaxValue(29)
      )
      .addStringOption((o) =>
        o
          .setName('genre')
          .setDescription('Genre pool (ignored when a playlist is given)')
          .addChoices(...genreChoices)
      )
      .addStringOption((o) =>
        o
          .setName('playlist')
          .setDescription('Deezer playlist URL or ID to pull songs from')
      )
      .addChannelOption((o) =>
        o
          .setName('voice')
          .setDescription('Voice channel to play in (default: your current one)')
      )
  )
  .addSubcommand((sub) =>
    sub.setName('stop').setDescription('Stop the current game (host or mods only)')
  )
  .addSubcommand((sub) =>
    sub.setName('standings').setDescription('Show the current scoreboard')
  );

module.exports = [guessjockey.toJSON()];
