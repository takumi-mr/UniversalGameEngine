// apps/backend/config.ts

const DEV_JWT_SECRET = "dev-only-insecure-jwt-secret";

/**
 * JWT の署名鍵。
 * - 本番（NODE_ENV=production）で未設定なら起動を拒否する（既定値のまま公開すると誰でもトークンを偽造できるため）
 * - 開発環境では警告を出して固定の開発用シークレットを使う
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[config] JWT_SECRET is not set. Refusing to start in production with a default secret. " +
        "Set the JWT_SECRET environment variable.",
    );
  }
  console.warn(
    "[config] JWT_SECRET is not set — using an insecure development secret. " +
      "Set JWT_SECRET in .env before exposing this server.",
  );
  return DEV_JWT_SECRET;
}

export const JWT_SECRET = resolveJwtSecret();

/**
 * 強化学習モード。true のときだけ gRPC の Reset / Step / Simulate / BatchSimulate を提供し、
 * リポジトリはインメモリ実装になる（Redis / MongoDB 不要）。
 * これらの RPC は無認証でセッションを操作し、マスクなしの状態を返すので本番では有効にしない。
 */
export const isRlMode = (): boolean => process.env.RL_MODE === "true";
