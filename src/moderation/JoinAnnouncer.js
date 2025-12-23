const { PermissionsBitField } = require("discord.js");
const { accentColor, footerText } = require("../commands");

class JoinAnnouncer {
  constructor(client, options) {
    this.client = client;
    this.channelId = options.channelId;
    this.minAccountAgeDays = Number.isFinite(options.minAccountAgeDays) ? options.minAccountAgeDays : 0;
    this.pingRoleIds = Array.isArray(options.pingRoleIds) ? options.pingRoleIds.filter(Boolean) : [];
    this.actionLogger = options.actionLogger || null;
  }

  isEnabled() {
    return Boolean(this.channelId);
  }

  async logAction(content) {
    if (!this.actionLogger || !content) return;
    await this.actionLogger.log(content);
  }

  getSlashCommandDefinitions() {
    if (!this.isEnabled()) return [];
    return [
      {
        name: "joinalert",
        description: "Send a test join alert to the mod channel (mods only).",
        dm_permission: false,
        default_member_permissions: PermissionsBitField.Flags.ManageGuild.toString(),
        options: [],
      },
    ];
  }

  async fetchChannel() {
    if (!this.channelId) return null;
    const channel = await this.client.channels.fetch(this.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;
    return channel;
  }

  formatAge(ageMs) {
    const totalMinutes = Math.max(0, Math.floor(ageMs / 60_000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(" ");
  }

  buildEmbed(member, { createdAt, ageMs, isNew }) {
    const createdTs = Math.floor(createdAt.getTime() / 1000);
    const fields = [
      { name: "Account created", value: `<t:${createdTs}:R> (<t:${createdTs}:F>)`, inline: false },
      { name: "Account age", value: this.formatAge(ageMs), inline: true },
    ];

    if (isNew && this.minAccountAgeDays > 0) {
      fields.push({
        name: "Flag",
        value: `Younger than ${this.minAccountAgeDays} days`,
        inline: true,
      });
    }

    return {
      title: "NOVÝ ČLEN",
      description: `${member.user} se připojil.`,
      color: accentColor,
      fields,
      thumbnail: {
        url: member.user.displayAvatarURL({ size: 256, extension: "png", forceStatic: false }),
      },
      footer: { text: footerText },
    };
  }

  buildLeaveEmbed(member, leftAtTs) {
    const createdAt = member.user?.createdTimestamp
      ? new Date(member.user.createdTimestamp)
      : new Date();
    const createdTs = Math.floor(createdAt.getTime() / 1000);
    const joinedTs = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
    const fields = [{ name: "Account created", value: `<t:${createdTs}:R> (<t:${createdTs}:F>)`, inline: false }];

    if (joinedTs) {
      fields.push({ name: "Na serveru od", value: `<t:${joinedTs}:R> (<t:${joinedTs}:F>)`, inline: false });
    }

    fields.push({ name: "Opustil", value: `<t:${leftAtTs}:F>`, inline: true });

    return {
      title: "ODCHOD",
      description: `${member.user?.tag ?? member.user ?? member.id} opustil server.`,
      color: accentColor,
      fields,
      thumbnail: {
        url: member.user.displayAvatarURL({ size: 256, extension: "png", forceStatic: false }),
      },
      footer: { text: footerText },
    };
  }

  async handleMemberJoin(member) {
    if (!this.isEnabled()) return;
    const channel = await this.fetchChannel();
    if (!channel) return;

    const createdAt = member.user?.createdAt ?? new Date(member.user?.createdTimestamp ?? Date.now());
    const ageMs = Date.now() - createdAt.getTime();
    const ageDays = ageMs / 86_400_000;
    const isNew = this.minAccountAgeDays > 0 ? ageDays < this.minAccountAgeDays : false;

    const embed = this.buildEmbed(member, { createdAt, ageMs, isNew });
    const parts = [`Připojil se ${member}.\n`];
    const shouldPing = isNew && this.pingRoleIds.length > 0;
    if (shouldPing) parts.push(...this.pingRoleIds.map((id) => `<@&${id}>`));
    if (isNew) parts.push("Novej SUS ACC se pripojil.");
    const content = parts.join(" ").trim();

    await channel
      .send({
        content,
        embeds: [embed],
        allowedMentions: {
          roles: shouldPing ? this.pingRoleIds : [],
          users: [member.id],
          parse: [],
        },
      })
      .catch((error) => {
        console.warn("join-announcer: failed to send join alert", { error });
      });
    await this.logAction(`[MEMBER] ${member.user?.tag ?? member.id} se připojil.`);
  }

  async handleMemberLeave(member) {
    if (!this.isEnabled()) return;
    const channel = await this.fetchChannel();
    if (!channel) return;

    const leftAtTs = Math.floor(Date.now() / 1000);
    const embed = this.buildLeaveEmbed(member, leftAtTs);
    const content = `${member.user?.tag ?? member.user ?? member.id} opustil server.`;

    await channel
      .send({
        content,
        embeds: [embed],
        allowedMentions: { parse: [] },
      })
      .catch((error) => {
        console.warn("join-announcer: failed to send leave alert", { error });
      });
    await this.logAction(`[MEMBER] ${member.user?.tag ?? member.id} opustil server.`);
  }

  async handleInteraction(interaction) {
    if (!this.isEnabled()) return false;
    if (!interaction.isChatInputCommand()) return false;
    if (interaction.commandName !== "joinalert") return false;

    if (!interaction.inGuild()) {
      await interaction.reply({ content: "This command only works in servers.", ephemeral: true });
      return true;
    }

    const member =
      interaction.member ??
      (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
    if (!member) {
      await interaction.reply({ content: "Could not load your member record.", ephemeral: true });
      return true;
    }

    await interaction.reply({
      content: "Sending test join alert to the mod channel.",
      ephemeral: true,
    });

    await this.handleMemberJoin(member);
    return true;
  }
}

module.exports = {
  JoinAnnouncer,
};
