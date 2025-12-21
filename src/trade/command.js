const tradeCommand = {
  name: "trade",
  description: "Vytvor obchodni prispevek",
};

const autoTradingCommand = {
  name: "autotrading",
  description: "Zapne nebo vypne automaticke zpracovani obrazku v obchodnim kanalu",
  options: [
    {
      name: "enabled",
      description: "true pro zapnuti, false pro vypnuti; kdyz neni zadano, prepneme stav",
      type: 5, // Boolean
      required: false,
    },
  ],
};

module.exports = {
  tradeCommand,
  autoTradingCommand,
};
