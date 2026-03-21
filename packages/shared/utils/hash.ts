// packages/shared/utils/hash.ts
import type { BaseGameState } from "../GameRules";

/**
 * 送信・受信される状態オブジェクトのハッシュ値を計算する
 * 注意: 完全に厳密である必要はないが、クライアントとサーバで同じ結果になる必要がある。
 * キーの順序が異なるとハッシュが変わるため、JSON.stringify + シンプルなハッシュ関数を使用する。
 */
export function calculateStateHash<T extends BaseGameState>(state: T): string {
  // オブジェクトのキーを再帰的にソートして順序を一定にする
  const sortKeys = (obj: unknown): unknown => {
    // プリミティブ値または null の場合はそのまま返す
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    // 配列の場合は各要素を再帰的に処理
    if (Array.isArray(obj)) {
      return obj.map(sortKeys);
    }
    // オブジェクトの場合はキーをソートして再帰的に処理
    const objectNode = obj as Record<string, unknown>;
    const sortedObj: Record<string, unknown> = {};

    Object.keys(objectNode)
      .sort()
      .forEach((key) => {
        sortedObj[key] = sortKeys(objectNode[key]);
      });

    return sortedObj;
  };

  const sortedState = sortKeys(state);
  const str = JSON.stringify(sortedState, (key, value) => {
    // hash フィールド自体は計算から除外する
    if (key === "hash") return undefined;
    return value;
  });

  // シンプルな 32-bit FNV-1a 風ハッシュ
  let hval = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hval ^= str.charCodeAt(i);
    hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
  }
  return (hval >>> 0).toString(16);
}
