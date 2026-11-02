// Registers the D2 Conflux bot's commands in the D2 Conflux server. Run once, and again
// whenever a command changes:
//
//   node --env-file=.env.local scripts/register-discord-commands.ts
//
// Needs DISCORD_APP_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID. The command name must
// match SEND_TO_TRACKER in src/lib/feedback/discord.ts.

const MESSAGE_COMMAND = 3;
/** Manage Messages: only moderators see "Send to tracker". Server settings can widen it. */
const MANAGE_MESSAGES = String(1 << 13);

const { DISCORD_APP_ID: appId, DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guildId } = process.env;
if (!appId || !token || !guildId) {
  console.error("Set DISCORD_APP_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const commands = [
  { name: "Send to tracker", type: MESSAGE_COMMAND, default_member_permissions: MANAGE_MESSAGES },
];

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);

export {};
