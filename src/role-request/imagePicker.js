const allowedImageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
]);

async function pickImageAttachment(message) {
  console.log("pickImageAttachment: start", {
    id: message.id,
    partial: Boolean(message.partial),
    attachmentsCount: message.attachments?.size ?? 0,
    embedsCount: message.embeds?.length ?? 0,
    contentLength: message.content?.length ?? 0,
  });

  const fullMessage =
    message.partial || message.attachments.size === 0 || (message.embeds?.length ?? 0) === 0
      ? await message.fetch().catch(() => null)
      : message;
  if (!fullMessage) {
    console.warn("pickImageAttachment: fetch failed for message", { id: message.id });
    return null;
  }

  const attachments = Array.from(fullMessage.attachments.values());
  const embeds = fullMessage.embeds || [];
  const content = fullMessage.content || "";

  if (attachments.length > 0) {
    const first = attachments[0];
    console.log("pickImageAttachment: using attachment", {
      url: first.url,
      proxyURL: first.proxyURL,
      contentType: first.contentType,
      name: first.name,
      width: first.width,
      height: first.height,
      isImageType: (first.contentType && first.contentType.startsWith("image/")) || allowedImageTypes.has(first.contentType),
    });
    return { url: first.url || first.proxyURL, source: "attachment-any" };
  }

  const sticker = fullMessage.stickers?.first();
  if (sticker && sticker.url) {
    console.log("pickImageAttachment: using sticker", { url: sticker.url, format: sticker.format });
    return { url: sticker.url, source: "sticker" };
  }

  const byEmbedImage = embeds.find((embed) => embed.image?.url || embed.thumbnail?.url);
  if (byEmbedImage) {
    console.log("pickImageAttachment: using embed image", {
      image: byEmbedImage.image?.url,
      thumb: byEmbedImage.thumbnail?.url,
    });
    return { url: byEmbedImage.image?.url || byEmbedImage.thumbnail?.url, source: "embed" };
  }

  const urlFromContent = content.match(/https?:\/\/\S+/);
  if (urlFromContent) {
    console.log("pickImageAttachment: using content url", { url: urlFromContent[0] });
    return { url: urlFromContent[0], source: "content-url" };
  }

  console.warn("No valid image attachment found on message", {
    id: fullMessage.id,
    author: fullMessage.author?.id,
    attachmentContentTypes: attachments.map((a) => a.contentType),
    attachmentNames: attachments.map((a) => a.name),
    embedTypes: embeds.map((e) => e.type),
    embedImages: embeds.map((e) => e.image?.url || e.thumbnail?.url),
    stickerFormats: fullMessage.stickers?.map((s) => s.format) ?? [],
    contentLength: content.length,
  });
  return null;
}

module.exports = {
  pickImageAttachment,
};
