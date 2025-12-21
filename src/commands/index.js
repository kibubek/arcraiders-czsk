const accentColor = 0xf57c00;
const footerText = "Arc Raiders CZ/SK";

const obchod = require("./obchod");
const pravidla = require("./pravidla");
const boost = require("./boost");
const odkazy = require("./odkazy");
const facebook = require("./facebook");

const commands = [obchod, pravidla, boost, odkazy, facebook];

const toSlashDefinition = ({ name, description }) => ({
  name,
  description,
});

const buildEmbed = ({ title, body }) => ({
  title,
  description: body,
  color: accentColor,
  footer: { text: footerText },
});

module.exports = {
  accentColor,
  footerText,
  commands,
  toSlashDefinition,
  buildEmbed,
};
