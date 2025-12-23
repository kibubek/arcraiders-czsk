function getJoinAlertConfig() {
  const daysRaw = process.env.JOIN_ALERT_MIN_ACCOUNT_AGE_DAYS;
  const minAccountAgeDays = Number.isFinite(Number(daysRaw)) ? Number(daysRaw) : 7;
  const pingRoleId = process.env.JOIN_ALERT_PING_ROLE_ID?.trim() || null;

  return {
    channelId: process.env.JOIN_ALERT_CHANNEL_ID,
    minAccountAgeDays,
    pingRoleId,
  };
}

module.exports = {
  getJoinAlertConfig,
};
