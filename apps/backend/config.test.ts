// apps/backend/config.test.ts
import { describe, it, expect } from "bun:test";

// config.ts はモジュール読み込み時に JWT_SECRET を解決するので、環境を変えて都度 import する
async function loadConfig(env: Record<string, string | undefined>) {
  const saved = { JWT_SECRET: process.env.JWT_SECRET, NODE_ENV: process.env.NODE_ENV };
  Object.assign(process.env, env);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
  try {
    return await import(`./config?${Math.random()}`);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("config.JWT_SECRET", () => {
  it("設定されていればそれを使うこと", async () => {
    const cfg = await loadConfig({ JWT_SECRET: "abc", NODE_ENV: "production" });
    expect(cfg.JWT_SECRET).toBe("abc");
  });

  it("本番で未設定なら起動を拒否すること", async () => {
    await expect(loadConfig({ JWT_SECRET: undefined, NODE_ENV: "production" })).rejects.toThrow(
      /JWT_SECRET is not set/,
    );
  });

  it("開発環境で未設定なら開発用シークレットに fallback すること", async () => {
    const cfg = await loadConfig({ JWT_SECRET: undefined, NODE_ENV: "development" });
    expect(cfg.JWT_SECRET).toBe("dev-only-insecure-jwt-secret");
  });
});
