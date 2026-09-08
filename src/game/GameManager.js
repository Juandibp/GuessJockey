'use strict';

/** One game per guild at a time. */
class GameManager {
  constructor() {
    /** @type {Map<string, import('./Game').Game>} */
    this.games = new Map();
  }

  has(guildId) {
    return this.games.has(guildId);
  }

  get(guildId) {
    return this.games.get(guildId);
  }

  add(game) {
    if (this.games.has(game.guild.id)) {
      throw new Error('A game is already running in this server.');
    }
    this.games.set(game.guild.id, game);
    return game;
  }

  remove(guildId) {
    this.games.delete(guildId);
  }
}

module.exports = new GameManager();
