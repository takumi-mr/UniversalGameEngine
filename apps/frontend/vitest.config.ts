import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// フロントエンドの単体テスト（vitest）。
// vite.config.ts とは分けてあり、Electron プラグインは読み込まない。
// ルートの `bun test` はここを走らせない（bun:test と衝突するため、
// package.json の "test" スクリプトで packages/ と apps/backend に限定している）。
export default defineConfig({
  resolve: {
    // `@/` → src/（vite.config.ts と同じ）
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
    server: {
      deps: {
        inline: ["vuetify"],
      },
    },
  },
});
