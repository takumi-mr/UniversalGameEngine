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

/**
 * リポジトリをインメモリ実装にするか。
 * - RL_MODE: 学習ループでは Redis / MongoDB を使わない
 * - NODE_ENV=test（`bun test` が自動で設定する）: 単体テストが外部 DB に接続しないようにする
 */
export const useInMemoryStore = (): boolean => isRlMode() || process.env.NODE_ENV === "test";

/**
 * 複数インスタンス構成（Socket.io の Redis アダプタ + インスタンス間通知）を有効にするか。
 * インメモリストアのときは常に単一プロセスなので無効。
 */
export const isClusterMode = (): boolean => !useInMemoryStore();

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
export const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
