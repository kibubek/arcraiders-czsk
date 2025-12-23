const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  FileUploadBuilder,
} = require("discord.js");
const { accentColor, footerText } = require("../commands");
const { TradePost, initTradeStorage, Op, getSetting, setSetting } = require("./storage");
const { pickImageAttachment } = require("../role-request/imagePicker");

function isImageAttachment(att) {
  return (
    (att.contentType && att.contentType.startsWith("image/")) ||
    att.height ||
    att.width ||
    (att.name && att.name.match(/\.(png|jpe?g|gif|webp)$/i))
  );
}

class TradeService {
  constructor(client, options) {
    this.client = client;
    this.tradeChannelId = options.tradeChannelId;
    this.extendedRoleId = options.extendedRoleId;
    this.defaultDurationMs = options.defaultDurationMs ?? 60_000;
    this.extendedDurationMs = options.extendedDurationMs ?? 120_000;
    this.expirationTimers = new Map();
    this.offerMessages = new Map();
    this.autoTradingEnabled = false;
    this.imageCache = options.imageCache || null;
  }

  formatDuration(ms) {
    if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
    if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
    if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
    if (ms >= 1000) return `${Math.round(ms / 1000)}s`;
    return `${ms}ms`;
  }

  async init() {
    if (!this.tradeChannelId) {
      console.warn("Trade channel is not configured. Set TRADE_CHANNEL_ID to enable /trade.");
      return;
    }
    await initTradeStorage();
    const savedAutoTrading = await getSetting("autoTradingEnabled", "false");
    this.autoTradingEnabled = savedAutoTrading === "true";
    console.log("Trade service state loaded", { autoTradingEnabled: this.autoTradingEnabled });
    await this.restoreActivePosts();
  }

  getSlashCommandDefinitions() {
    const { tradeCommand, autoTradingCommand } = require("./command");
    return [tradeCommand, autoTradingCommand];
  }

  async handleInteraction(interaction) {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "trade") {
        await this.handleTradeCommand(interaction);
        return true;
      }
      if (interaction.commandName === "autotrading") {
        await this.handleAutoTradingCommand(interaction);
        return true;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("trade/modal/")) {
      await this.handleTradeModalSubmit(interaction);
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("tr:edit-modal:")) {
      await this.handleEditModal(interaction);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith("trade/offer/start/")) {
      await this.handleOfferButton(interaction);
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("trade/offer-modal/")) {
      await this.handleOfferModalSubmit(interaction);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith("tr:accept-direct:")) {
      await this.handleDirectAccept(interaction);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith("tr:complete:")) {
      await this.handleCompleteTrade(interaction);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith("tr:edit:")) {
      await this.handleEditListing(interaction);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith("tr:del:")) {
      await this.handleDeleteListing(interaction);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith("tr:")) {
      await this.handleOfferAction(interaction);
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("trade/counter-modal/")) {
      await this.handleCounterModal(interaction);
      return true;
    }

    return false;
  }

  async handleTradeCommand(interaction) {
    const customId = `trade/modal/${interaction.id}`;

    const modal = new ModalBuilder().setCustomId(customId).setTitle("Obchod");
    const upload = new FileUploadBuilder()
      .setCustomId("trade-files")
      .setRequired(false)
      .setMinValues(0)
      .setMaxValues(4);
    const uploadLabel = new LabelBuilder()
      .setLabel("Přilož soubory (max 4)")
      .setDescription("Obrázky se zobrazí v embedu")
      .setFileUploadComponent(upload);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("selling")
          .setLabel("Prodávám")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(900)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("buying")
          .setLabel("Kupuji")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(900)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("offering")
          .setLabel("Zpráva do Inzerátu")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(900)
      ),
      uploadLabel
    );

    await interaction.showModal(modal);
  }

  async handleTradeModalSubmit(interaction) {
    const selling = interaction.fields.getTextInputValue("selling")?.trim();
    const buying = interaction.fields.getTextInputValue("buying")?.trim();
    const offering = interaction.fields.getTextInputValue("offering")?.trim();
    const uploaded = interaction.fields.getUploadedFiles("trade-files", false);
    const attachments = uploaded
      ? Array.from(uploaded.values()).map((file) => ({
          id: file.id,
          url: file.url,
          name: file.name,
          contentType: file.contentType,
        }))
      : [];
    const cachedAttachments = await this.cacheImages(attachments, interaction.id);

    const hasContent = Boolean((selling && selling.length) || (buying && buying.length) || (offering && offering.length));
    if (!hasContent && cachedAttachments.length === 0) {
      await interaction.reply({ content: "Nebyl vyplněn žádný obsah. Zkuste to prosím znovu.", ephemeral: true });
      return;
    }

    const tradeChannel = await this.fetchTradeChannel();
    if (!tradeChannel) {
      await interaction.reply({ content: "Obchodní kanál nenalezen. Kontaktuj správce.", ephemeral: true });
      return;
    }

    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    const lifetimeMs = this.getLifetime(member);
    const expiresAt = new Date(Date.now() + lifetimeMs);

    const { files, embeds } = this.buildTradeMessage({
      author: interaction.user,
      selling,
      buying,
      offering,
      expiresAt,
      attachments: cachedAttachments,
    });

    const sentMessage = await tradeChannel.send({ embeds, files, components: [] });

    const post = await TradePost.create({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      messageId: sentMessage.id,
      channelId: tradeChannel.id,
      expiresAt,
      selling,
      buying,
      offering,
      attachments: cachedAttachments,
    });
    const offerButtonRow = this.buildOfferButtonRow({
      messageId: sentMessage.id,
      postId: post.id,
      ownerId: interaction.user.id,
      hasBothSides: Boolean(selling && buying),
    });
    await sentMessage.edit({ components: [offerButtonRow] });
    await this.pinIfEligible(sentMessage, member);

    this.scheduleExpiration(sentMessage.id, expiresAt);

    const expireText = this.formatDuration(lifetimeMs);
    await interaction.reply({
      content: `Inzerát vytvořen. Zanikne za ${expireText}.`,
      ephemeral: true,
    });
  }

  async handleAutoTradingCommand(interaction) {
    const explicit = interaction.options.getBoolean("enabled");
    if (explicit === null || explicit === undefined) {
      this.autoTradingEnabled = !this.autoTradingEnabled;
    } else {
      this.autoTradingEnabled = explicit;
    }
    await setSetting("autoTradingEnabled", this.autoTradingEnabled);
    await interaction.reply({
      content: `Autotrading je nyní ${this.autoTradingEnabled ? "zapnutý" : "vypnutý"}.`,
      ephemeral: true,
    });
  }

  buildTradeMessage({ author, selling, buying, offering, expiresAt, attachments }) {
    const parts = [`Vytvořil: ${author}`, `Vyprší: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`];
    const instructions = this.autoTradingEnabled
      ? "Použij /trade nebo pošli obrázek pro vytvoření svého vlastního inzerátu"
      : "Použij /trade pro vytvoření svého vlastního inzerátu";
    const embed = {
      title: "Obchodní nabídka",
      description: parts.join(" | "),
      color: accentColor,
      footer: { text: `${footerText} • ${instructions}` },
      fields: [],
    };

    if (selling) {
      embed.fields.push({ name: "Prodávám", value: selling, inline: false });
    }
    if (buying) {
      embed.fields.push({ name: "Kupuji", value: buying, inline: false });
    }
    if (offering) {
      embed.fields.push({ name: "Zpráva do Inzerátu", value: offering, inline: false });
    }

    const imageEmbeds = [];
    attachments.slice(0, 4).forEach((attachment, index) => {
      const imageUrl = this.pickValidImageUrl(attachment);
      if (!imageUrl) {
        console.log("trade: attachment skipped (no valid url)", {
          index,
          name: attachment.name,
          contentType: attachment.contentType,
          url: attachment.url,
          cachedUrl: attachment.cachedUrl,
        });
        return;
      }
      const looksLikeImage =
        (attachment.contentType && attachment.contentType.startsWith("image/")) ||
        (attachment.name && attachment.name.match(/\.(png|jpe?g|gif|webp|heic|heif|avif)$/i)) ||
        imageUrl.match(/\.(png|jpe?g|gif|webp|heic|heif|avif)(\?|$)/i);
      if (looksLikeImage) {
        imageEmbeds.push({
          color: accentColor,
          image: { url: imageUrl },
        });
      } else {
        console.log("trade: attachment skipped (not image?)", {
          index,
          name: attachment.name,
          contentType: attachment.contentType,
          url: attachment.url,
          cachedUrl: attachment.cachedUrl,
        });
      }
    });

    if (imageEmbeds.length === 0 && attachments.length > 0) {
      const fallbackUrl = this.pickValidImageUrl(attachments[0]);
      if (fallbackUrl) {
        imageEmbeds.push({ color: accentColor, image: { url: fallbackUrl } });
        console.log("trade: using fallback image url", { url: fallbackUrl });
      }
    }

    if (imageEmbeds.length > 0) {
      embed.image = imageEmbeds.shift().image;
      console.log("trade: image embed built", {
        mainImage: embed.image?.url,
        extraImages: imageEmbeds.map((e) => e.image?.url),
      });
    } else {
      console.log("trade: no image embed built", {
        attachmentsCount: attachments.length,
        attachmentPreviews: attachments.map((att) => ({
          name: att.name,
          contentType: att.contentType,
          url: att.url,
          cachedUrl: att.cachedUrl,
        })),
      });
    }

    return {
      embeds: [embed, ...imageEmbeds].slice(0, 10),
      files: [],
    };
  }

  pickValidImageUrl(attachment) {
    const candidates = [attachment?.cachedUrl, attachment?.url];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "string") continue;
      if (!candidate.startsWith("http://") && !candidate.startsWith("https://")) continue;
      if (candidate.includes("<") || candidate.includes(">") || /\s/.test(candidate)) continue;
      return candidate;
    }
    return null;
  }

  buildOfferButtonRow({ messageId, postId, ownerId, hasBothSides }) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`trade/offer/start/${messageId}`)
        .setLabel("Protinabídka")
        .setStyle(ButtonStyle.Primary)
    );

    if (hasBothSides) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`tr:accept-direct:${postId}:${ownerId}`)
          .setLabel("Přijmout")
          .setStyle(ButtonStyle.Success)
      );
    }

    row.addComponents(
      new ButtonBuilder().setCustomId(`tr:edit:${postId}`).setLabel("Upravit inzerát").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tr:complete:${postId}:${ownerId}`).setLabel("Obchod proběhl").setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`tr:del:${postId}:${ownerId}`)
        .setLabel("Smazat inzerát")
        .setStyle(ButtonStyle.Danger)
    );

    return row;
  }

  getLifetime(member) {
    if (member && this.extendedRoleId && member.roles.cache.has(this.extendedRoleId)) {
      return this.extendedDurationMs;
    }
    return this.defaultDurationMs;
  }

  async cacheImages(attachments, contextKey) {
    if (!this.imageCache || !attachments || attachments.length === 0) return attachments;
    try {
      return await this.imageCache.cacheAttachments(attachments, contextKey);
    } catch (error) {
      console.warn("autotrading: failed to cache images", { contextKey, error });
      return attachments;
    }
  }

  async fetchTradeChannel() {
    if (!this.tradeChannelId) return null;
    const channel = await this.client.channels.fetch(this.tradeChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;
    return channel;
  }

  async handleMessage(message) {
    if (!this.autoTradingEnabled) return;
    if (message.author.bot) return;
    if (message.channelId !== this.tradeChannelId) return;

    console.log("autotrading: received message", {
      id: message.id,
      author: message.author?.id,
      attachments: message.attachments?.size ?? 0,
      contentLength: message.content?.length ?? 0,
    });

    const attachments = await this.collectImageAttachments(message);
    let picked = null;
    if (attachments.length === 0) {
      picked = await pickImageAttachment(message);
      if (picked?.url) {
        attachments.push({
          id: picked.id ?? "auto",
          url: picked.url,
          name: picked.url?.split("/").pop() || "image",
          contentType: "image/auto",
        });
      }
    }

    if (attachments.length === 0) {
      console.log("autotrading: no usable image found, skipping", { id: message.id });
      return;
    }

    const tradeChannel = await this.fetchTradeChannel();
    if (!tradeChannel) {
      console.warn("autotrading: trade channel not found", { tradeChannelId: this.tradeChannelId });
      return;
    }

    const cachedAttachments = await this.cacheImages(attachments, message.id);

    const member = message.member ?? (await message.guild?.members.fetch(message.author.id).catch(() => null));
    const lifetimeMs = this.getLifetime(member);
    const expiresAt = new Date(Date.now() + lifetimeMs);

    const { files, embeds } = this.buildTradeMessage({
      author: message.author,
      selling: null,
      buying: null,
      offering: message.content?.trim() || null,
      expiresAt,
      attachments: cachedAttachments,
    });

    const sentMessage = await tradeChannel.send({ embeds, files, components: [] });

    const post = await TradePost.create({
      userId: message.author.id,
      guildId: message.guildId,
      messageId: sentMessage.id,
      channelId: tradeChannel.id,
      expiresAt,
      selling: null,
      buying: null,
      offering: message.content?.trim() || null,
      attachments: cachedAttachments,
    });
    const offerButtonRow = this.buildOfferButtonRow({
      messageId: sentMessage.id,
      postId: post.id,
      ownerId: message.author.id,
      hasBothSides: false,
    });
    await sentMessage.edit({ components: [offerButtonRow] });
    await this.pinIfEligible(sentMessage, member);
    this.scheduleExpiration(sentMessage.id, expiresAt);

    console.log("autotrading: listing created", {
      id: message.id,
      newMessageId: sentMessage.id,
      attachments: cachedAttachments.length,
      expiresAt,
    });

    await message.delete().catch(() => null);
  }

  async collectImageAttachments(message) {
    const fullMessage =
      message.partial || (message.attachments?.size ?? 0) === 0 ? await message.fetch().catch(() => null) : message;
    if (!fullMessage) {
      console.warn("autotrading: failed to fetch full message", { id: message.id });
      return [];
    }

    const attachments = Array.from(fullMessage.attachments.values())
      .filter(isImageAttachment)
      .slice(0, 4)
      .map((att) => ({
        id: att.id,
        url: att.url || att.proxyURL,
        name: att.name,
        contentType: att.contentType,
      }))
      .filter((att) => Boolean(att.url));

    console.log("autotrading: collected attachments", {
      id: message.id,
      count: attachments.length,
      names: attachments.map((a) => a.name),
    });
    return attachments;
  }

  scheduleExpiration(messageId, expiresAt) {
    const delay = expiresAt.getTime() - Date.now();
    if (delay <= 0) {
      this.expirePost(messageId);
      return;
    }
    const timer = setTimeout(() => this.expirePost(messageId), delay);
    this.expirationTimers.set(messageId, timer);
  }

  async expirePost(messageId) {
    const post = await TradePost.findOne({ where: { messageId } });
    if (!post) return;

    const channel = await this.client.channels.fetch(post.channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages.fetch(post.messageId).catch(() => null);
      if (message) {
        await message.edit({ components: [] }).catch(() => null);
        await message.delete().catch(() => null);
      }
    }

    await this.cleanupOfferMessages(post.id);
    await TradePost.destroy({ where: { id: post.id } });
    const timer = this.expirationTimers.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.expirationTimers.delete(messageId);
    }
  }

  async restoreActivePosts() {
    const now = new Date();
    const active = await TradePost.findAll({ where: { expiresAt: { [Op.gt]: now } } });
    const expired = await TradePost.findAll({ where: { expiresAt: { [Op.lte]: now } } });

    for (const post of expired) {
      await this.expirePost(post.messageId);
    }

    for (const post of active) {
      this.scheduleExpiration(post.messageId, post.expiresAt);
    }
  }

  async handleOfferButton(interaction) {
    const messageId = interaction.customId.split("trade/offer/start/")[1];
    const post = await TradePost.findOne({ where: { messageId } });
    if (!post) {
      await interaction.reply({ content: "Tento inzerát už není aktivní.", ephemeral: true });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`trade/offer-modal/${post.id}/${interaction.user.id}`)
      .setTitle("Protinabídka");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("offer-body")
          .setLabel("Co nabízíš?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(900)
      )
    );
    await interaction.showModal(modal);
  }

  async handleDeleteListing(interaction) {
    const [, , postId, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: "Tento inzerát může smazat jen autor.", ephemeral: true });
      return;
    }

    const post = await TradePost.findOne({ where: { id: postId } });
    if (!post) {
      await interaction.reply({ content: "Inzerát už není aktivní.", ephemeral: true });
      return;
    }

    await this.expirePost(post.messageId);
    await interaction.reply({ content: "Inzerát byl smazán.", ephemeral: true });
  }

  async handleCompleteTrade(interaction) {
    const [, , postId, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: "Toto tlačítko je jen pro autora inzerátu.", ephemeral: true });
      return;
    }

    const post = await TradePost.findOne({ where: { id: postId } });
    if (!post) {
      await interaction.reply({ content: "Inzerát už není aktivní.", ephemeral: true });
      return;
    }

    await this.expirePost(post.messageId);
    await interaction.reply({
      content: "Inzerát byl uzavřen jako dokončený. Díky za potvrzení obchodu!",
      ephemeral: true,
    });
  }

  async pinIfEligible(message, member) {
    if (!this.extendedRoleId || !member) return;
    if (!member.roles.cache.has(this.extendedRoleId)) return;
    await message.pin().catch(() => null);
    const systemMessage = await this.findLatestPinSystemMessage(message.channel).catch(() => null);
    if (systemMessage) {
      await systemMessage.delete().catch(() => null);
    }
  }

  async findLatestPinSystemMessage(channel) {
    if (!channel || !channel.isTextBased()) return null;
    const fetched = await channel.messages.fetch({ limit: 5 }).catch(() => null);
    if (!fetched) return null;
    return fetched.find((msg) => msg.type === 6); // ChannelPinnedMessage
  }

  async handleEditListing(interaction) {
    const [, , postId] = interaction.customId.split(":");
    const post = await TradePost.findOne({ where: { id: postId } });
    if (!post) {
      await interaction.reply({ content: "Inzerát už není aktivní.", ephemeral: true });
      return;
    }
    if (interaction.user.id !== post.userId) {
      await interaction.reply({ content: "Tento inzerát může upravit jen autor.", ephemeral: true });
      return;
    }

    const modal = new ModalBuilder().setCustomId(`tr:edit-modal:${postId}`).setTitle("Upravit inzerát");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("selling")
          .setLabel("Prodávám")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(900)
          .setValue(post.selling ?? "")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("buying")
          .setLabel("Kupuji")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(900)
          .setValue(post.buying ?? "")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("offering")
          .setLabel("Zpráva do Inzerátu")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(900)
          .setValue(post.offering ?? "")
      )
    );

    await interaction.showModal(modal);
  }

  async handleEditModal(interaction) {
    const [, , postId] = interaction.customId.split(":");
    const post = await TradePost.findOne({ where: { id: postId } });
    if (!post) {
      await interaction.reply({ content: "Inzerát už není aktivní.", ephemeral: true });
      return;
    }
    if (interaction.user.id !== post.userId) {
      await interaction.reply({ content: "Tento inzerát může upravit jen autor.", ephemeral: true });
      return;
    }

    const selling = interaction.fields.getTextInputValue("selling")?.trim();
    const buying = interaction.fields.getTextInputValue("buying")?.trim();
    const offering = interaction.fields.getTextInputValue("offering")?.trim();

    const hasContent = Boolean((selling && selling.length) || (buying && buying.length) || (offering && offering.length));
    const hasAttachments = Array.isArray(post.attachments) && post.attachments.length > 0;
    if (!hasContent && !hasAttachments) {
      await interaction.reply({ content: "Není co uložit – vše je prázdné.", ephemeral: true });
      return;
    }

    await TradePost.update(
      { selling: selling || null, buying: buying || null, offering: offering || null },
      { where: { id: post.id } }
    );

    const channel = await this.client.channels.fetch(post.channelId).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(post.messageId).catch(() => null) : null;

    const author = await this.client.users.fetch(post.userId).catch(() => interaction.user);
    const { files, embeds } = this.buildTradeMessage({
      author,
      selling,
      buying,
      offering,
      expiresAt: post.expiresAt,
      attachments: post.attachments ?? [],
    });

    if (message) {
      const hasBothSides = Boolean(selling && buying);
      const offerButtonRow = this.buildOfferButtonRow({
        messageId: post.messageId,
        postId: post.id,
        ownerId: post.userId,
        hasBothSides,
      });
      await message.edit({ embeds, files, components: [offerButtonRow] }).catch(() => null);
    }

    await interaction.reply({ content: "Inzerát byl upraven.", ephemeral: true });
  }

  async handleDirectAccept(interaction) {
    const [, , postId, ownerId] = interaction.customId.split(":");
    const post = await TradePost.findOne({ where: { id: postId } });
    if (!post) {
      await interaction.reply({ content: "Inzerát už není aktivní.", ephemeral: true });
      return;
    }
    if (interaction.user.id === ownerId) {
      await interaction.reply({ content: "Toto tlačítko je pro zájemce, ne pro autora.", ephemeral: true });
      return;
    }

    const listingUrl = `https://discord.com/channels/${post.guildId}/${post.channelId}/${post.messageId}`;
    const embed = {
      title: "Někdo přijal tvůj inzerát",
      description: `${interaction.user} přijal nabídku. Kontaktuj ho a domluvte se.`,
      color: accentColor,
      fields: [{ name: "Inzerát", value: `[Odkaz na inzerát](${listingUrl})`, inline: false }],
      footer: { text: footerText },
    };

    const ownerUser = await this.client.users.fetch(ownerId).catch(() => null);
    if (ownerUser) {
      await this.sendOwnerAcceptDm({ ownerUser, embed, listingUrl });
    }

    await interaction.reply({
      content: 'Autor inzerátu byl informován v DM. Po dokončení obchod uzavřete tlačítkem "Obchod proběhl".',
      ephemeral: true,
    });
  }

  async handleOfferModalSubmit(interaction) {
    const [, , postId, offererId] = interaction.customId.split("/");
    if (interaction.user.id !== offererId) {
      await interaction.reply({ content: "Tento formulář není pro tebe.", ephemeral: true });
      return;
    }

    const post = await TradePost.findOne({ where: { id: postId } });
    if (!post) {
      await interaction.reply({ content: "Inzerát už není aktivní.", ephemeral: true });
      return;
    }

    const offerText = interaction.fields.getTextInputValue("offer-body")?.trim();
    if (!offerText) {
      await interaction.reply({ content: "Text nabídky nesmí být prázdný.", ephemeral: true });
      return;
    }

    const owner = await this.client.users.fetch(post.userId).catch(() => null);
    if (!owner) {
      await interaction.reply({ content: "Nepodařilo se kontaktovat autora.", ephemeral: true });
      return;
    }

    const listingUrl = `https://discord.com/channels/${post.guildId}/${post.channelId}/${post.messageId}`;
    const embed = {
      title: "Nová protinabídka",
      description: `${interaction.user} reagoval na tvůj inzerát.`,
      color: accentColor,
      fields: [
        { name: "Nabídka", value: offerText, inline: false },
        { name: "Odkaz", value: listingUrl, inline: false },
      ],
      footer: { text: footerText },
    };

    const actionRow = this.buildOfferActions(post.id, owner.id, interaction.user.id, true);
    try {
      const dmMessage = await owner.send({ embeds: [embed], components: [actionRow] });
      this.recordOfferMessage(post.id, dmMessage);
      await interaction.reply({ content: "Protinabídka byla odeslána autorovi v DM.", ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: "Nepodařilo se odeslat DM autorovi inzerátu.", ephemeral: true });
    }
  }

  buildOfferActions(postId, recipientId, otherUserId, includeSilentDeny) {
    const row = new ActionRowBuilder();
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`tr:accept:${postId}:${recipientId}:${otherUserId}`)
        .setLabel("Přijmout")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`tr:deny:${postId}:${recipientId}:${otherUserId}`)
        .setLabel("Odmítnout")
        .setStyle(ButtonStyle.Danger)
    );

    if (includeSilentDeny) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`tr:silent:${postId}:${recipientId}:${otherUserId}`)
          .setLabel("Odmítnout potichu")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`tr:counter:${postId}:${recipientId}:${otherUserId}`)
        .setLabel("Protinabídka")
        .setStyle(ButtonStyle.Primary)
    );

    return row;
  }

  async handleOfferAction(interaction) {
    const [, action, postId, recipientId, otherUserId] = interaction.customId.split(":");
    if (interaction.user.id !== recipientId) {
      await interaction.reply({ content: "Toto tlačítko není pro tebe.", ephemeral: true });
      return;
    }

    const post = await TradePost.findOne({ where: { id: postId } });
    if (!post) {
      await interaction.reply({ content: "Inzerát už není aktivní.", ephemeral: true });
      return;
    }

    const listingUrl = `https://discord.com/channels/${post.guildId}/${post.channelId}/${post.messageId}`;
    const otherUser = await this.client.users.fetch(otherUserId).catch(() => null);
    const disableComponents = this.disableComponents(interaction.message);

    if (action === "accept") {
      if (otherUser) {
        await otherUser
          .send({
            content: `Tvoje protinabídka byla přijata. Spojte se a domluvte obchod s ${interaction.user}.`,
          })
          .catch(() => null);
      }
      await disableComponents;
      await interaction.reply({
        content:
          'Přijato a druhá strana byla informována. Po dokončení obchod uzavři tlačítkem "Obchod proběhl" v inzerátu.',
        ephemeral: true,
      });
      return;
    }

    if (action === "deny") {
      if (otherUser) {
        const embed = {
          title: "Protinabídka odmítnuta",
          description: "Tvoje protinabídka byla odmítnuta.",
          color: accentColor,
          fields: [{ name: "Inzerát", value: `[Odkaz na inzerát](${listingUrl})`, inline: false }],
          footer: { text: footerText },
        };
        await otherUser.send({ embeds: [embed] }).catch(() => null);
      }
      await disableComponents;
      await interaction.reply({ content: "Nabídka odmítnuta.", ephemeral: true });
      return;
    }

    if (action === "silent") {
      await disableComponents;
      await interaction.reply({
        content: "Nabídka byla odmítnuta a druhá strana nedostala upozornění o odmítnutí.",
        ephemeral: true,
      });
      return;
    }

    if (action === "counter") {
      const modal = new ModalBuilder()
        .setCustomId(`trade/counter-modal/${postId}/${recipientId}/${otherUserId}`)
        .setTitle("Protinabídka");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("counter-body")
            .setLabel("Co nabízíš?")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(900)
        )
      );
      await interaction.showModal(modal);
      return;
    }

    await interaction.reply({ content: "Neplatná akce.", ephemeral: true });
  }

  async handleCounterModal(interaction) {
    const [, , postId, senderId, targetId] = interaction.customId.split("/");
    if (interaction.user.id !== senderId) {
      await interaction.reply({ content: "Tento formulář není pro tebe.", ephemeral: true });
      return;
    }

    const post = await TradePost.findOne({ where: { id: postId } });
    if (!post) {
      await interaction.reply({ content: "Inzerát už není aktivní.", ephemeral: true });
      return;
    }

    const body = interaction.fields.getTextInputValue("counter-body")?.trim();
    if (!body) {
      await interaction.reply({ content: "Text nesmí být prázdný.", ephemeral: true });
      return;
    }

    const targetUser = await this.client.users.fetch(targetId).catch(() => null);
    if (!targetUser) {
      await interaction.reply({ content: "Nepodařilo se kontaktovat druhého uživatele.", ephemeral: true });
      return;
    }

    const listingUrl = `https://discord.com/channels/${post.guildId}/${post.channelId}/${post.messageId}`;
    const embed = {
      title: "Nová protinabídka",
      description: `${interaction.user} poslal protinabídku.`,
      color: accentColor,
      fields: [
        { name: "Nabídka", value: body, inline: false },
        { name: "Odkaz", value: listingUrl, inline: false },
      ],
      footer: { text: footerText },
    };

    const actionRow = this.buildOfferActions(post.id, targetId, interaction.user.id, false);
    try {
      const dmMessage = await targetUser.send({ embeds: [embed], components: [actionRow] });
      this.recordOfferMessage(post.id, dmMessage);
      await interaction.reply({ content: "Protinabídka byla odeslána.", ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: "DM se nepodařilo odeslat.", ephemeral: true });
    }
  }

  async sendOwnerAcceptDm({ ownerUser, embed, listingUrl }) {
    if (!ownerUser) return;

    await ownerUser.send({ embeds: [embed] }).catch(() => null);
    const instructions =
      'Pokud trade doběhl, klikni na tlačítko "Obchod proběhl" přímo v inzerátu, aby se mohl uzavřít.';
    if (listingUrl) {
      await ownerUser.send({ content: `${instructions}\n${listingUrl}` }).catch(() => null);
    } else {
      await ownerUser.send({ content: instructions }).catch(() => null);
    }
  }

  async disableComponents(message) {
    const rows = (message.components || []).map((row) =>
      ActionRowBuilder.from(row).setComponents(
        row.components.map((component) => ButtonBuilder.from(component).setDisabled(true))
      )
    );
    return message.edit({ components: rows }).catch(() => null);
  }

  recordOfferMessage(postId, message) {
    if (!message) return;
    const list = this.offerMessages.get(postId) || [];
    list.push({ channelId: message.channelId, messageId: message.id });
    this.offerMessages.set(postId, list);
  }

  async cleanupOfferMessages(postId) {
    const refs = this.offerMessages.get(postId);
    if (!refs || refs.length === 0) return;

    const updatedRefs = [];
    for (const ref of refs) {
      const channel = await this.client.channels.fetch(ref.channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) continue;
      const msg = await channel.messages.fetch(ref.messageId).catch(() => null);
      if (!msg) continue;
      await msg.edit({ components: [] }).catch(() => null);
      updatedRefs.push(ref);
    }

    this.offerMessages.delete(postId);
    return updatedRefs;
  }
}

module.exports = {
  TradeService,
};
