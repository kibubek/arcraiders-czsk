const defaultRoleOptions = [
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

function parseRoleOptionsFromEnv(raw) {
  if (!raw) return { options: null, error: null };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { options: null, error: new Error("ROLE_REQUEST_OPTIONS must be an array") };
    const options = parsed
      .filter((item) => item && typeof item.label === "string" && typeof item.value === "string")
      .map((item) => ({ label: item.label, value: item.value }));
    return { options, error: null };
  } catch (error) {
    return { options: null, error };
  }
}

function parseIndexedRoleOptionsFromEnv(env) {
  const entries = Object.entries(env)
    .filter(([key, value]) => /^ROLE_REQUEST_OPTION_\d+$/.test(key) && value)
    .map(([key, value]) => {
      const index = Number(key.split("_").pop());
      return { index, value: value.trim() };
    })
    .filter(({ index, value }) => Number.isFinite(index) && value.length > 0)
    .sort((a, b) => a.index - b.index);

  if (entries.length === 0) return null;

  return entries.map(({ value }, idx) => ({
    label: defaultRoleOptions[idx]?.label ?? `Role ${idx + 1}`,
    value,
  }));
}

const { options: jsonRoleOptions, error: jsonParseError } = parseRoleOptionsFromEnv(process.env.ROLE_REQUEST_OPTIONS);
const indexedRoleOptions = parseIndexedRoleOptionsFromEnv(process.env);

if (!jsonRoleOptions && jsonParseError && !indexedRoleOptions) {
  console.warn("Failed to parse ROLE_REQUEST_OPTIONS, using defaults.", { error: jsonParseError });
}

const roleOptions = jsonRoleOptions ?? indexedRoleOptions ?? defaultRoleOptions;

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
