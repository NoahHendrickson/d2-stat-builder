/**
 * The community server's invite: a never-expiring, unlimited-use link. A plain
 * https link is what Discord expects sites to use — on phones it is an app link that
 * opens the Discord app straight to the invite, and on desktop discord.com hands it to
 * the running client (or offers the app / browser). A `discord://` link would only add
 * a browser prompt and do nothing for people without the app.
 *
 * Empty hides the sidebar button.
 */
export const DISCORD_INVITE_URL: string = "https://discord.gg/c7AexpsssU";
