function buildSelectCustomId(message, adminMessageId) {
  return `role-req/select/${message.channelId}/${message.id}/${message.author.id}/${adminMessageId}`;
}

function buildDenyCustomId(message, adminMessageId) {
  return `role-req/deny/${message.channelId}/${message.id}/${message.author.id}/${adminMessageId}`;
}

function parseRequestCustomId(customId) {
  const [, , channelId, messageId, userId, adminMessageId] = customId.split("/");
  return { channelId, messageId, userId, adminMessageId };
}

module.exports = {
  buildSelectCustomId,
  buildDenyCustomId,
  parseRequestCustomId,
};
