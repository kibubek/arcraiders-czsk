const roleOptions = [
  { label: "Cantina Legend", value: "1434950617360764928" },
  { label: "Hotshot", value: "1434950623983308880" },
  { label: "Daredevil III", value: "1434950630698647725" },
  { label: "Daredevil II", value: "1434950637476646984" },
  { label: "Daredevil I", value: "1434950644036407407" },
  { label: "Wildcard III", value: "1434950665687535646" },
  { label: "Wildcard II", value: "1434950681680281671" },
  { label: "Wildcard I", value: "1434950692728209558" },
  { label: "Tryhard III", value: "1434950717692448958" },
  { label: "Tryhard II", value: "1434950726219731036" },
  { label: "Tryhard I", value: "1434950733769216151" },
  { label: "Rookie III", value: "1434950756913385532" },
  { label: "Rookie II", value: "1434950765444730880" },
  { label: "Rookie I", value: "1434950772814254131" },
];

function getRoleRequestConfig() {
  return {
    channelId: process.env.ROLE_REQUEST_CHANNEL,
    adminChannelId: process.env.ROLE_REQUEST_ADMIN_CHANNEL,
    roleOptions,
  };
}

module.exports = {
  roleOptions,
  getRoleRequestConfig,
};
