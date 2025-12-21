function getTradeConfig() {
  const { parseDuration } = require("./duration");
  const defaultDurationMs = parseDuration(process.env.TRADE_DURATION_DEFAULT) ?? 60_000;
  const extendedDurationMs =
    parseDuration(process.env.TRADE_DURATION_EXTENDED) ?? (process.env.TRADE_EXTENDED_ROLE_ID ? 120_000 : defaultDurationMs);

  return {
    tradeChannelId: process.env.TRADE_CHANNEL_ID,
    extendedRoleId: process.env.TRADE_EXTENDED_ROLE_ID,
    defaultDurationMs,
    extendedDurationMs,
  };
}

module.exports = {
  getTradeConfig,
};
