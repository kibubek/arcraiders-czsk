function getJoinAlertConfig() {
  const daysRaw = process.env.JOIN_ALERT_MIN_ACCOUNT_AGE_DAYS;
  const minAccountAgeDays = Number.isFinite(Number(daysRaw)) ? Number(daysRaw) : 7;
  const pingRoleIds = [];
  const main = process.env.JOIN_ALERT_PING_ROLE_ID?.trim();
  const secondary = process.env.JOIN_ALERT_PING_ROLE_ID_2?.trim();
  if (main) pingRoleIds.push(main);
  if (secondary) pingRoleIds.push(secondary);

  return {
    channelId: process.env.JOIN_ALERT_CHANNEL_ID,
    minAccountAgeDays,
    pingRoleIds,
  };
}

module.exports = {
  getJoinAlertConfig,
};
