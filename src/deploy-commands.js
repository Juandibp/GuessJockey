'use strict';

const { REST, Routes } = require('discord.js');
const commands = require('./commands');
const { token, clientId, guildId } = require('./config');

(async () => {
  if (!token || !clientId) {
    console.error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env first.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log(
        `✅ Registered ${commands.length} command(s) to guild ${guildId} (appears instantly).`
      );
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log(
        `✅ Registered ${commands.length} global command(s) (can take up to ~1h to appear).`
      );
    }
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
