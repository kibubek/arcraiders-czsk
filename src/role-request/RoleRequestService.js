const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
} = require("discord.js");
const { pickImageAttachment } = require("./imagePicker");
const { buildSelectCustomId, buildDenyCustomId, parseRequestCustomId } = require("./customId");
const { ephereal } = require("../commands/obchod");

class RoleRequestService {
  constructor(client, config) {
    this.client = client;
    this.channelId = config.channelId;
    this.adminChannelId = config.adminChannelId;
    this.roleOptions = config.roleOptions;
    this.roleCleanupCommandName = "reset-role";
    this.pendingRoleCleanup = new Map();
    this.roleCleanupAllowedUserIds = new Set(["240911065255378944", "595336101678546945"]);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async resolveMembersByIds(guild, ids) {
    const resolved = new Map();
    const missing = [];

    for (const id of ids) {
      const cached = guild.members.cache.get(id);
      if (cached) {
        resolved.set(id, cached);
      } else {
        missing.push(id);
      }
    }

    for (const chunk of this.chunk(missing, 90)) {
      const batch = await guild.members.fetch({ user: chunk }).catch(async (error) => {
        if (error?.data?.retry_after) {
          const waitMs = Math.ceil(error.data.retry_after * 1000) + 500;
          console.warn("role-reset: rate limited on fetch by ids, retrying", { waitMs, ids: chunk });
          await this.sleep(waitMs);
          return null;
        }
        console.warn("Failed to fetch member chunk by id", { ids: chunk, error });
        return null;
      });
      batch?.forEach((member) => resolved.set(member.id, member));
      // Gentle throttle between batches
      await this.sleep(250);
    }

    return resolved;
  }

  async collectMembersWithRoles(guild, roleIdSet, options = {}) {
    const { onProgress, timeLimitMs = 15_000 } = options;
    const targets = new Map();
    const started = Date.now();
    let lastProgress = 0;

    // Seed from cached role members to avoid unnecessary fetches.
    for (const roleId of roleIdSet) {
      const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
      role?.members?.forEach((member) => targets.set(member.id, member));
    }

    // Fetch in chunks to avoid gateway rate limits.
    let after = undefined;
    let fetched = 0;
    const limit = 500;
    while (true) {
      const batch = await guild.members.fetch({ limit, after }).catch(async (error) => {
        if (error?.data?.retry_after) {
          const waitMs = Math.ceil(error.data.retry_after * 1000) + 500;
          console.warn("role-reset: rate limited on member fetch, retrying", { after, waitMs });
          await this.sleep(waitMs);
          return null;
        }
        console.warn("role-reset: Failed to fetch member chunk", { after, error });
        return null;
      });
      if (!batch || batch.size === 0) break;
      fetched += batch.size;
      batch.forEach((member) => {
        if (member.roles.cache.some((r) => roleIdSet.has(r.id))) {
          targets.set(member.id, member);
        }
      });
      if (batch.size < limit) break;
      after = batch.last().id;
      // Light throttle between requests
      await this.sleep(400);

      const now = Date.now();
      if (onProgress && now - lastProgress > 2000) {
        lastProgress = now;
        onProgress({ fetched, targetCount: targets.size });
      }
      if (now - started > timeLimitMs) {
        console.warn("role-reset: stopping member collection due to time limit", {
          fetched,
          targetCount: targets.size,
        });
        break;
      }
    }

    console.log("role-reset: collected members with roles", {
      roleCount: roleIdSet.size,
      targetCount: targets.size,
      fetchedMembers: fetched,
    });

    return targets;
  }

  isEnabled() {
    return Boolean(this.channelId && this.adminChannelId);
  }

  getSlashCommandDefinitions() {
    return [
      {
        name: this.roleCleanupCommandName,
        description: "END OF WIPE COMMAND, RESET TRIAL RANKS.",
        dm_permission: false,
        default_member_permissions: PermissionsBitField.Flags.ManageRoles.toString(),
        options: [],
      },
    ];
  }

  async handleMessage(message) {
    if (!this.isEnabled()) return;
    if (message.author.bot) return;
    if (message.channelId !== this.channelId) return;

    console.log("Role request received", { messageId: message.id, author: message.author?.id });
    const image = await pickImageAttachment(message);
    if (!image) {
      console.log("Role request rejected (no image)", { messageId: message.id, author: message.author?.id });
      const notice = await message
        .reply({
          content: "Tento kanál je jen pro žádosti o role. Pošli prosím **jeden obrázek**, kde je vidět tvůj **rank**, **jméno** a požádej si tím o roli.",
        })
        .catch(() => null);
      if (notice) {
        setTimeout(() => notice.delete().catch(() => null), 10_000);
      }
      return;
    }

    const adminChannel = await this.client.channels.fetch(this.adminChannelId).catch(() => null);
    if (!adminChannel || !adminChannel.isTextBased()) {
      console.warn("Role request admin channel is not text-based or not accessible.");
      return;
    }

    const embed = {
      title: "Zadost o roli",
      description: `Uživatel ${message.author} poslal žádost. Vyber roli nebo jí zamítni.${image ? "" : "\n(Obrázek nebyl nalezen, zkus se podívat na původní zprávu)"}`,
      url: message.url,
      image: image ? { url: image.url } : undefined,
      footer: { text: `Uživatel ID: ${message.author.id}` },
    };

    const adminMessage = await adminChannel.send({
      content: `Nová žádost o roli od ${message.author.tag}`,
      embeds: [embed],
      components: [],
    });

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildSelectCustomId(message, adminMessage.id))
        .setPlaceholder("Vyber roli k přiřazení")
        .addOptions(this.roleOptions)
    );

    const denyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(buildDenyCustomId(message, adminMessage.id)).setEmoji("❌").setStyle(ButtonStyle.Danger)
    );

    await adminMessage.edit({ components: [selectRow, denyRow] }).catch((error) => {
      console.warn("Failed to update admin message components", { error });
    });
    console.log("Role request forwarded", {
      messageId: message.id,
      author: message.author?.id,
      adminChannelId: adminChannel.id,
      imageSource: image?.source ?? "none",
    });
  }

  async handleInteraction(interaction) {
    if (interaction.isChatInputCommand() && interaction.commandName === this.roleCleanupCommandName) {
      await this.handleRoleCleanupCommand(interaction);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith("role-req/cleanup/")) {
      await this.handleRoleCleanupConfirmation(interaction);
      return true;
    }

    if (!this.isEnabled()) return false;

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("role-req/select/")) {
      await this.handleRoleSelection(interaction);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith("role-req/deny/")) {
      await this.handleDenyButton(interaction);
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("role-req/modal/")) {
      await this.handleDenyModal(interaction);
      return true;
    }

    return false;
  }

  async handleRoleSelection(interaction) {
    const { channelId, messageId, userId, adminMessageId } = parseRequestCustomId(interaction.customId);
    const selectedRoleId = interaction.values[0];
    const selectedRole = this.roleOptions.find((opt) => opt.value === selectedRoleId);
    try {
      const role = interaction.guild.roles.cache.get(selectedRoleId);
      if (!role) {
        await interaction.reply({ content: `Roli se nepodařilo najít najit (id: ${selectedRoleId}).`, ephemeral: false });
        return;
      }

      const member = await interaction.guild.members.fetch(userId);
      const roleIdsToRemove = this.roleOptions
        .filter((opt) => opt.value !== selectedRoleId)
        .map((opt) => opt.value)
        .filter((id) => member.roles.cache.has(id));

      if (roleIdsToRemove.length > 0) {
        await member.roles.remove(roleIdsToRemove, `Cleanup by ${interaction.user.tag} via role request`).catch((error) => {
          console.warn("Failed to remove existing roles from member", { userId, roleIdsToRemove, error });
        });
      }

      await member.roles.add(role, `Schváleno uživatele ${interaction.user.tag}`);
      console.log("Role assigned", {
        userId,
        roleId: selectedRoleId,
        roleLabel: selectedRole?.label ?? role.name,
        by: interaction.user.id,
      });

      const originalMessage = await this.fetchOriginalMessage(channelId, messageId);
      if (originalMessage) {
        await originalMessage.react("<a:check1:1451917747540852859>").catch(() => null);
      }

      await this.updateAdminOutcomeEmbed(adminMessageId, {
        resolver: interaction.user,
        status: "approved",
        roleLabel: selectedRole?.label ?? role.name,
        userId,
      });

      await interaction.update({ components: [] });
      await interaction.followUp({
        content: `Role "${selectedRole?.label ?? role.name}" byla přiřazena uživateli <@${userId}>.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("Failed to assign role:", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Nepodařilo se přiřadit roli.", ephemeral: false });
      } else {
        await interaction.reply({ content: "Nepodařilo se přiřadit roli.", ephemeral: false });
      }
    }
  }

  async handleRoleCleanupCommand(interaction) {
    if (!this.roleCleanupAllowedUserIds.has(interaction.user.id)) {
      await interaction.reply({ content: "Tento příkaz může použít pouze owner.", ephemeral: true });
      return;
    }

    const send = async (payload) => {
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload);
      }
      return interaction.reply(payload);
    };

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true }).catch(() => null);
    }

    if (!interaction.inGuild()) {
      await send({ content: "Tento prikaz lze pouzit jen na serveru.", ephemeral: true });
      return;
    }

    const requester = interaction.member ?? (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
    if (!requester || !requester.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      await send({ content: "Na tento prikaz je potreba opravneni Spravovat role.", ephemeral: true });
      return;
    }

    const roleIds = (this.roleOptions || []).map((opt) => opt.value).filter(Boolean);
    if (roleIds.length === 0) {
      await send({ content: "Nenalezeny zadne role pro reset.", ephemeral: true });
      return;
    }

    const roles = await Promise.all(
      roleIds.map((id) => interaction.guild.roles.cache.get(id) || interaction.guild.roles.fetch(id).catch(() => null))
    );
    const validRoles = roles.filter(Boolean);
    if (validRoles.length === 0) {
      await send({ content: "Zadne z konfigurovanych roli nebyly nalezeny.", ephemeral: true });
      return;
    }

    const nonEditable = validRoles.filter((role) => !role.editable);
    if (nonEditable.length > 0) {
      const names = nonEditable.map((r) => r.name).join(", ");
      await send({
        content: `Nemohu upravit tyto role: ${names}. Zkontroluj prosim poradi roli.`,
        ephemeral: true,
      });
      return;
    }

    const botMember =
      interaction.guild.members.me ??
      (await interaction.guild.members.fetch(this.client?.user?.id ?? interaction.client?.user?.id).catch(() => null));
    if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      await send({ content: "Bot nema opravneni pro spravu roli.", ephemeral: true });
      return;
    }

    await send({
      content: "Počítám odhad počtu uživatelů, může to trvat několik sekund...",
      ephemeral: true,
    });

    const roleIdSet = new Set(validRoles.map((role) => role.id));
    console.log("role-reset: starting estimate", {
      requestedBy: interaction.user.id,
      guildId: interaction.guildId,
      roleCount: roleIdSet.size,
    });

    const targets = await this.collectMembersWithRoles(interaction.guild, roleIdSet, {
      onProgress: ({ fetched, targetCount }) =>
        interaction.editReply({
          content: `Počítám odhad... zkontrolováno ${fetched}+ členů, nalezeno ${targetCount} s vybranými rolemi.`,
        }),
    });
    const estimatedCount = targets.size;

    if (estimatedCount === 0) {
      await send({ content: "Zadny clen nema zadnou z techto roli.", ephemeral: true });
      return;
    }

    console.log("role-reset: confirmation prompt", {
      requestedBy: interaction.user.id,
      guildId: interaction.guildId,
      roleCount: roleIdSet.size,
      estimatedCount,
    });

    this.pendingRoleCleanup.set(interaction.id, {
      roleIds: Array.from(roleIdSet),
      roleNames: validRoles.map((role) => role.name),
      estimatedCount,
      requesterId: interaction.user.id,
      targetIds: Array.from(targets.keys()),
    });

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`role-req/cleanup/confirm/${interaction.id}`)
        .setLabel("Odebrat vsem")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`role-req/cleanup/cancel/${interaction.id}`)
        .setLabel("Zrusit")
        .setStyle(ButtonStyle.Secondary)
    );

    await send({
      content: `Role (**${validRoles.length}**): ${validRoles
        .map((r) => `\`${r.name}\``)
        .join(", ")}
Odhadovane ovlivni **${estimatedCount}** uzivatelu. Pokracovat?`,
      components: [confirmRow],
      ephemeral: true,
    });
  }

  async handleRoleCleanupConfirmation(interaction) {
    const [, , action, commandId] = interaction.customId.split("/");
    const pending = this.pendingRoleCleanup.get(commandId);

    if (!pending) {
      await interaction.reply({ content: "Tahle akce uz neni platna.", ephemeral: true });
      return;
    }

    if (interaction.user.id !== pending.requesterId) {
      await interaction.reply({ content: "Tuto akci muze potvrdit jen autor prikazu.", ephemeral: true });
      return;
    }

    if (action === "cancel") {
      this.pendingRoleCleanup.delete(commandId);
      await interaction.update({ content: "Odebrani role bylo zruseno.", components: [] });
      return;
    }

    await interaction.update({
      content: `Odebiram role (${pending.roleNames.length}) z ${pending.estimatedCount} uzivatelu...`,
      components: [],
    });

    const roleIdSet = new Set(pending.roleIds);
    let targets = new Map();

    if (pending.targetIds && pending.targetIds.length > 0) {
      targets = await this.resolveMembersByIds(interaction.guild, pending.targetIds);
    }

    // Fallback: collect again if nothing fetched (cache cold or members left the guild).
    if (targets.size === 0) {
      targets = await this.collectMembersWithRoles(interaction.guild, roleIdSet);
    }

    let removedMembers = 0;
    let failedMembers = 0;
    const reason = `Bulk role removal by ${interaction.user.tag}`;

    for (const member of targets.values()) {
      const rolesToRemove = member.roles.cache.filter((r) => roleIdSet.has(r.id));
      if (rolesToRemove.size === 0) continue;
      const result = await member.roles.remove(Array.from(rolesToRemove.keys()), reason).catch((error) => {
        console.warn("Failed to remove role during cleanup", { userId: member.id, roleIds: Array.from(rolesToRemove.keys()), error });
        failedMembers += 1;
        return null;
      });
      if (result) removedMembers += 1;
    }

    this.pendingRoleCleanup.delete(commandId);
    const summaryParts = [`Hotovo. Odebrano u ${removedMembers} uzivatelu.`];
    if (failedMembers > 0) summaryParts.push(`Nepodarilo se odebrat u ${failedMembers} uzivatelu.`);

    await interaction.followUp({ content: summaryParts.join(" "), ephemeral: true });
  }

  async handleDenyButton(interaction) {
    const { channelId, messageId, userId } = parseRequestCustomId(interaction.customId);
    const modal = new ModalBuilder()
      .setCustomId(`role-req/modal/${channelId}/${messageId}/${userId}/${interaction.message.id}`)
      .setTitle("Zamítnout žádost");

    const reasonInput = new TextInputBuilder()
      .setCustomId("deny-reason")
      .setLabel("Důvod zamítnutí")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  async handleDenyModal(interaction) {
    const { channelId, messageId, userId, adminMessageId } = parseRequestCustomId(interaction.customId);
    const reason = interaction.fields.getTextInputValue("deny-reason").trim();

    const originalMessage = await this.fetchOriginalMessage(channelId, messageId);
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (originalMessage) {
      await originalMessage.react("\u274c").catch(() => null);
    }

    if (member) {
      await member
        .send({
          content: `Tvoje žádost o roli byla zamítnuta.\nDůvod: ${reason}\nZamítl: ${interaction.user}\nOdkaz: ${originalMessage?.url ?? "nelze načíst zprávu"}`,
        })
        .catch((error) => console.warn("Failed to DM user about denial", { userId, error }));
    }

    await this.removeAdminComponents(this.adminChannelId, adminMessageId);
    const replyPayload = { content: "Žádost byla zamitnuta.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyPayload).catch((error) =>
        console.warn("Failed to follow up deny modal response", { error })
      );
    } else {
      await interaction.reply(replyPayload).catch((error) =>
        console.warn("Failed to reply to deny modal response", { error })
      );
    }

    await this.updateAdminOutcomeEmbed(adminMessageId, {
      resolver: interaction.user,
      status: "denied",
      reason,
      userId,
    });
    console.log("Role request denied", { userId, messageId, adminMessageId, by: interaction.user.id });
  }

  async fetchOriginalMessage(channelId, messageId) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return null;
      return await channel.messages.fetch(messageId);
    } catch (error) {
      console.error("Failed to fetch original message:", error);
      return null;
    }
  }

  async removeAdminComponents(adminChannelId, adminMessageId) {
    if (!adminChannelId || !adminMessageId) return;
    try {
      const adminChannel = await this.client.channels.fetch(adminChannelId);
      if (!adminChannel || !adminChannel.isTextBased()) return;
      const adminMessage = await adminChannel.messages.fetch(adminMessageId);
      await adminMessage.edit({ components: [] });
    } catch (error) {
      console.error("Failed to remove admin components:", error);
    }
  }

  async fetchAdminMessage(adminMessageId) {
    try {
      const adminChannel = await this.client.channels.fetch(this.adminChannelId);
      if (!adminChannel || !adminChannel.isTextBased()) return null;
      return await adminChannel.messages.fetch(adminMessageId);
    } catch (error) {
      console.error("Failed to fetch admin message:", error);
      return null;
    }
  }

  async updateAdminOutcomeEmbed(adminMessageId, outcome) {
    const adminMessage = await this.fetchAdminMessage(adminMessageId);
    if (!adminMessage) return;

    const baseEmbed = adminMessage.embeds?.[0]?.toJSON() ?? {};
    const fields = [];

    fields.push({ name: "Vyřešil", value: `${outcome.resolver}`, inline: false });

    if (outcome.status === "approved") {
      fields.push({ name: "Přiřazena role", value: outcome.roleLabel ?? "Neuvedeno", inline: false });
      fields.push({ name: "Obdržel ji", value: `<@${outcome.userId}>`, inline: false });
    } else {
      fields.push({ name: "Stav", value: "Zamítnuto", inline: false });
      fields.push({ name: "Důvod", value: outcome.reason || "Neuveden", inline: false });
      fields.push({ name: "Žadatel", value: `<@${outcome.userId}>`, inline: false });
    }

    const updatedEmbed = {
      ...baseEmbed,
      description: outcome.status === "approved" ? "Žádost byla schvalena." : "Žádost byla zamítnuta.",
      fields,
    };

    await adminMessage.edit({ embeds: [updatedEmbed], components: [] }).catch((error) => {
      console.warn("Failed to update admin embed outcome", { error });
    });
  }
}

module.exports = {
  RoleRequestService,
};
