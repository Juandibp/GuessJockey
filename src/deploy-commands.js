'use strict';

const { REST, Routes } = require('discord.js');
const commands = require('./commands');
const { token, clientId, guildId } = require('./config');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

(async () => {
  if (!token || token === 'your-bot-token-here') {
    die(
      '❌ DISCORD_TOKEN is missing or still the placeholder.\n' +
        '   Discord Dev Portal → your app → Bot → Reset Token → paste it into .env'
    );
  }
  if (!clientId || clientId === 'your-application-id-here') {
    die(
      '❌ DISCORD_CLIENT_ID is missing or still the placeholder.\n' +
        '   Dev Portal → your app → General Information → Application ID'
    );
  }

  const rest = new REST({ version: '10' }).setToken(token);

  // --- Preflight: verify the token is valid and matches the client id ------
  let app;
  try {
    app = await rest.get(Routes.oauth2CurrentApplication());
  } catch (err) {
    if (err && err.status === 401) {
      die(
        '❌ Discord rejected the bot token (401 Unauthorized).\n' +
          '   • DISCORD_TOKEN must be the *Bot* token (Dev Portal → Bot → Reset Token),\n' +
          '     NOT the Client Secret (OAuth2 page) and NOT the Public Key.\n' +
          '   • No quotes or spaces around it in .env, and no "Bot " prefix.\n' +
          '   • If you clicked "Reset Token" after copying, the old one is dead — copy the new one.'
      );
    }
    throw err;
  }

  const me = await rest.get(Routes.user()); // /users/@me
  console.log(`🔑 Token OK — logged in as ${me.username} (application ${app.id})`);

  if (String(app.id) !== String(clientId)) {
    die(
      `❌ DISCORD_CLIENT_ID (${clientId}) is not the app this token belongs to (${app.id}).\n` +
        '   Set DISCORD_CLIENT_ID to the Application ID of the SAME app as the bot token.'
    );
  }

  // --- Register -----------------------------------------------------------
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
    die(`Failed to register commands: ${err}`);
  }
})();
