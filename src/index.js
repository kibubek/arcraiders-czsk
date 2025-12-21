require("dotenv").config();

const { Client, GatewayIntentBits, REST, Routes, ActivityType } = require("discord.js");
const { commands, buildEmbed, toSlashDefinition } = require("./commands");
const { getRoleRequestConfig } = require("./role-request/config");
const { RoleRequestService } = require("./role-request/RoleRequestService");
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error("DISCORD_TOKEN and CLIENT_ID must be set in the environment.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
});

const commandMap = new Map(commands.map((cmd) => [cmd.name, cmd]));
const roleRequestService = new RoleRequestService(client, getRoleRequestConfig());

async function registerSlashCommands() {
  console.log("Registering global slash commands (propagation can take up to an hour)...");
  await rest.put(Routes.applicationCommands(clientId), {
    body: commands.map(toSlashDefinition),
  });
  console.log("Commands registered globally.");
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    client.user.setPresence({
      activities: [
        {
          name: "<:arcz:1434879854641152020>",
          type: ActivityType.Playing,
        },
      ],
      status: "online",
    });
  } catch (error) {
    console.warn("Failed to set bot presence", { error });
  }
  if (!roleRequestService.isEnabled()) {
    console.warn("Role request workflow disabled: set ROLE_REQUEST_CHANNEL and ROLE_REQUEST_ADMIN_CHANNEL in .env");
  }
});

client.on("messageCreate", async (message) => {
  try {
    await roleRequestService.handleMessage(message);
  } catch (error) {
    console.error("Failed to process role request message:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = commandMap.get(interaction.commandName);
    if (!command) return;

    try {
      await interaction.reply({
        embeds: [buildEmbed(command)],
      });
    } catch (error) {
      console.error(`Failed to handle /${interaction.commandName}:`, error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Neco se pokazilo, zkuste to prosim znovu.", ephemeral: true });
      }
    }
    return;
  }

  try {
    const handled = await roleRequestService.handleInteraction(interaction);
    if (handled) return;
  } catch (error) {
    console.error("Failed to handle role request interaction:", error);
    return;
  }
});

(async () => {
  try {
    await registerSlashCommands();
    await client.login(token);
  } catch (error) {
    console.error("Failed to start the bot:", error);
    process.exit(1);
  }
})();
