class ActionLogger {
  constructor(client, channelId) {
    this.client = client;
    this.channelId = channelId?.trim?.() || null;
    this.channelPromise = null;
  }

  isEnabled() {
    return Boolean(this.channelId);
  }

  async fetchChannel() {
    if (!this.channelId) return null;
    if (!this.channelPromise) {
      this.channelPromise = this.client.channels.fetch(this.channelId).catch((error) => {
        console.warn("action-logger: failed to fetch channel", { channelId: this.channelId, error });
        return null;
      });
    }
    const channel = await this.channelPromise;
    if (!channel || !channel.isTextBased()) return null;
    return channel;
  }

  async log(content, options = {}) {
    if (!this.isEnabled()) return false;
    const channel = await this.fetchChannel();
    if (!channel) return false;

    const payload = {
      allowedMentions: { parse: [] },
      ...options,
      content,
    };

    if (!payload.content) return false;

    await channel.send(payload).catch((error) => {
      console.warn("action-logger: failed to send log message", { error });
    });
    return true;
  }
}

function createActionLoggerFromEnv(client) {
  return new ActionLogger(client, process.env.ACTION_LOG_CHANNEL_ID);
}

module.exports = {
  ActionLogger,
  createActionLoggerFromEnv,
};
