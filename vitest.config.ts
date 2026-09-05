import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Stray scratch worktree copies under .claude/ would otherwise be collected too.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
