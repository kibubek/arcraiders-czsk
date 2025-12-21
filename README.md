# Arc Raiders CZ/SK Discord Bot

Discord.js bot with slash commands:

- `/obchod` (pravidla obchodu)
- `/pravidla` (pravidla serveru)
- `/boost` (vyhody boostu)
- `/odkazy` (uzitecne odkazy)
- `/facebook` (link na FB)
- `/trade` (modal pro vytvoreni obchodniho inzeratu s nahranim souboru a protinabidkami)

## Prerequisites
- Node.js 18+
- Discord application with a bot token and the application client ID.

## Setup
1) Install dependencies:
   ```bash
   npm install
   ```
2) Create `.env` and fill in:
   ```dotenv
   DISCORD_TOKEN=your-bot-token
   CLIENT_ID=your-application-client-id
   TRADE_CHANNEL_ID=channel-for-trade-posts
   TRADE_DURATION_DEFAULT=60s                           # default listing lifetime (supports ms/s/m/h/d)
   TRADE_EXTENDED_ROLE_ID=role-id-with-extended-expiry  # optional
   TRADE_DURATION_EXTENDED=120s                         # optional extended lifetime
   ROLE_REQUEST_CHANNEL=channel-for-role-requests       # optional
   ROLE_REQUEST_ADMIN_CHANNEL=admin-channel-for-roles   # optional
   TRADE_DB_PATH=./data/trades.sqlite                   # optional override
   ```
3) Adjust embed copy in `src/commands/*.js` as needed. Accent color and footer live in `src/commands/index.js`.

## Run the bot
```bash
npm start
```
Commands register automatically on startup (global; propagation may take a while). Invite the bot with the `applications.commands` scope.

## Notes
- `/trade` shows a modal with text fields plus a file upload slot (up to 4 files). Listings expire after 1 minute (or 2 minutes when the author has `TRADE_EXTENDED_ROLE_ID`) and are stored in SQLite via Sequelize (default `data/trades.sqlite`).
- Trade embeds include a `Protinabidka` button: responders open a modal, the author receives DM buttons (accept/deny/silent/counter), and counter DMs omit the silent option.
- Errors reply ephemerally where possible.
