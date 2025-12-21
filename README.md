# Arc Raiders CZ/SK Discord Bot

Discord.js bot with five slash commands that reply with embeds:

- `/obchod` (UkĂˇĹľe pravidla obchodovĂˇnĂ­)
- `/pravidla` (UkĂˇĹľe pravidla serveru)
- `/boost` (UkĂˇĹľe vĂ˝hody vylepĹˇenĂ­)
- `/odkazy` (UkĂˇĹľe uĹľiteÄŤnĂ© odkazy)
- `/facebook` (UkĂˇĹľe nĂˇĹˇ Facebook)

## Prerequisites
- Node.js 18+ (Discord.js v14 requires Node 18).
- Discord application with a bot token and the application client ID.

## Setup
1) Install dependencies:
   ```bash
   npm install
   ```
2) Copy `.env.example` to `.env` and fill in:
   ```dotenv
   DISCORD_TOKEN=your-bot-token
   CLIENT_ID=your-application-client-id
   ```
3) Update the files in `src/commands/` (`obchod.js`, `pravidla.js`, `boost.js`, `odkazy.js`, `facebook.js`) to replace the lorem ipsum embed bodies with your real text. You can adjust `accentColor` and `footerText` in `src/commands/index.js`.

## Run the bot
```bash
npm start
```
Commands now register automatically on startup (global; can take up to an hour to propagate). Invite the bot to your server with the `applications.commands` scope. Once global commands finish propagating, use the five commands above to receive the embeds.

## Notes
- The bot only needs the `Guilds` intent since it replies to slash commands.
- Error handling replies with an ephemeral message if something goes wrong while responding.


