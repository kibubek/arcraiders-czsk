require("dotenv").config();

const { REST, Routes } = require("discord.js");
const { commands, toSlashDefinition } = require("./commands");
const { TradeService } = require("./trade/TradeService");
const { getTradeConfig } = require("./trade/config");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error("DISCORD_TOKEN and CLIENT_ID must be set in the environment.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

async function main() {
  const tradeService = new TradeService(null, getTradeConfig());
  try {
    console.log("Registering global slash commands (propagation can take up to an hour)...");
    await rest.put(Routes.applicationCommands(clientId), {
      body: [...commands.map(toSlashDefinition), ...tradeService.getSlashCommandDefinitions()],
    });
    console.log("Commands registered globally.");
  } catch (error) {
    console.error("Failed to register commands:", error);
    process.exit(1);
  }
}

main();
