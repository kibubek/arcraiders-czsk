const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
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
  }

  isEnabled() {
    return Boolean(this.channelId && this.adminChannelId);
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
          content: "Tento kanal je jen pro zadosti o roli. Pripni prosim screen hry s nickem a rankem (obrazek).",
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
      description: `Uzivatel ${message.author} poslal zadost. Vyber roli nebo ji zamitni.${image ? "" : "\n(Obrazek nebyl detekovan - otevri puvodni zpravu)"}`,
      url: message.url,
      image: image ? { url: image.url } : undefined,
      footer: { text: `Uzivatel ID: ${message.author.id}` },
    };

    const adminMessage = await adminChannel.send({
      content: `Nova zadost o roli od ${message.author.tag}`,
      embeds: [embed],
      components: [],
    });

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildSelectCustomId(message, adminMessage.id))
        .setPlaceholder("Vyber roli k prirazeni")
        .addOptions(this.roleOptions)
    );

    const denyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(buildDenyCustomId(message, adminMessage.id)).setLabel("X").setStyle(ButtonStyle.Danger)
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
        await interaction.reply({ content: `Roli se nepodarilo najit (id: ${selectedRoleId}).`, ephemeral: true });
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

      await member.roles.add(role, `Approved by ${interaction.user.tag} via role request`);
      console.log("Role assigned", {
        userId,
        roleId: selectedRoleId,
        roleLabel: selectedRole?.label ?? role.name,
        by: interaction.user.id,
      });

      const originalMessage = await this.fetchOriginalMessage(channelId, messageId);
      if (originalMessage) {
        await originalMessage.react("\u2705").catch(() => null);
      }

      await this.updateAdminOutcomeEmbed(adminMessageId, {
        resolver: interaction.user,
        status: "approved",
        roleLabel: selectedRole?.label ?? role.name,
        userId,
      });

      await interaction.update({ components: [] });
      await interaction.followUp({
        content: `Role "${selectedRole?.label ?? role.name}" byla prirazena uzivateli <@${userId}>.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("Failed to assign role:", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Nepodarilo se priradit roli.", ephemeral: true });
      } else {
        await interaction.reply({ content: "Nepodarilo se priradit roli.", ephemeral: true });
      }
    }
  }

  async handleDenyButton(interaction) {
    const { channelId, messageId, userId } = parseRequestCustomId(interaction.customId);
    const modal = new ModalBuilder()
      .setCustomId(`role-req/modal/${channelId}/${messageId}/${userId}/${interaction.message.id}`)
      .setTitle("Zamitnout zadost");

    const reasonInput = new TextInputBuilder()
      .setCustomId("deny-reason")
      .setLabel("Duvod zamitnuti")
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
          content: `Tvoje zadost o roli byla zamitnuta.\nDuvod: ${reason}\nZamitl: ${interaction.user}\nOdkaz: ${originalMessage?.url ?? "nelze nacist zpravu"}`,
        })
        .catch((error) => console.warn("Failed to DM user about denial", { userId, error }));
    }

    await this.removeAdminComponents(this.adminChannelId, adminMessageId);
    const replyPayload = { content: "Zadost byla zamitnuta.", ephemeral: true };
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
      description: outcome.status === "approved" ? "Zadost byla schvalena." : "Zadost byla zamitnuta.",
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
