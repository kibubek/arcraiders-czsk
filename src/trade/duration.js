function parseDuration(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = (match[2] || "ms").toLowerCase();
  const factors = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const factor = factors[unit];
  if (!factor) return null;
  return Math.floor(num * factor);
}

module.exports = {
  parseDuration,
};
