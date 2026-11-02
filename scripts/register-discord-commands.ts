// Registers the D2 Conflux bot's commands in the D2 Conflux server. Run once, and again
// whenever a command changes:
//
//   node_modules/.bin/tsx --env-file=.env.local scripts/register-discord-commands.ts
//
// Needs DISCORD_APP_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.
import { TRACKER_COMMAND } from "../src/lib/feedback/discord";

async function main() {
  const { DISCORD_APP_ID: appId, DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guildId } = process.env;
  if (!appId || !token || !guildId) {
    console.error("Set DISCORD_APP_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
    process.exit(1);
  }
  const res = await fetch(`https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([TRACKER_COMMAND]),
  });
  console.log(res.status, await res.text());
  if (!res.ok) process.exit(1);
}

void main();
