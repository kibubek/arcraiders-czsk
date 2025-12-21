const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes, Op } = require("sequelize");

const storagePath = process.env.TRADE_DB_PATH || path.join(__dirname, "../../data/trades.sqlite");
fs.mkdirSync(path.dirname(storagePath), { recursive: true });

const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: storagePath,
  logging: false,
});

const TradePost = sequelize.define(
  "TradePost",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    guildId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    messageId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    channelId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    selling: DataTypes.TEXT,
    buying: DataTypes.TEXT,
    offering: DataTypes.TEXT,
    attachments: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    tableName: "trade_posts",
  }
);

const Setting = sequelize.define(
  "Setting",
  {
    key: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    value: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    tableName: "trade_settings",
  }
);

async function initTradeStorage() {
  await sequelize.sync();
}

async function getSetting(key, defaultValue = null) {
  const entry = await Setting.findByPk(key);
  if (!entry) return defaultValue;
  return entry.value;
}

async function setSetting(key, value) {
  await Setting.upsert({ key, value: String(value) });
}

module.exports = {
  TradePost,
  Setting,
  sequelize,
  Op,
  initTradeStorage,
  getSetting,
  setSetting,
};
