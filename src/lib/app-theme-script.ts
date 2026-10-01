/** localStorage key for the app theme (see app-theme.ts). */
export const APP_THEME_KEY = "stat-builder:app-theme";

/** The theme a visitor gets until they pick one. The server renders it on <html>. */
export const DEFAULT_APP_THEME = "slate";

/** Inline head script (ES5): sets `data-app-theme` before first paint so the
    default look doesn't flash in under another choice. Scene is the attribute
    left off; anything unset or unknown keeps the server-rendered default. Kept
    out of app-theme.ts so the server layout can import it without the hooks. */
export const APP_THEME_SCRIPT =
  "(function(){try{var t=localStorage.getItem(" +
  JSON.stringify(APP_THEME_KEY) +
  '),d=document.documentElement.dataset;if(t==="scene")delete d.appTheme;else if(t==="slate"||t==="normal")d.appTheme=t}catch(e){}})()';
