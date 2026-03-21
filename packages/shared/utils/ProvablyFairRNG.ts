// packages/shared/utils/ProvablyFairRNG.ts
import type { IGameRNG } from "./IGameRNG";
import { hmacSha256 } from "./crypto";

/**
 * Provably Fair（証明可能な公正さ）に基づく乱数生成器
 * HMAC-SHA256 的なハッシュチェーンを使用して、検証可能な乱数列を生成する。
 */
export class ProvablyFairRNG implements IGameRNG {
  private serverSeed: string;
  private clientSeed: string;
  private nonce: number;

  constructor(serverSeed: string, clientSeed: string, nonce: number = 0) {
    this.serverSeed = serverSeed;
    this.clientSeed = clientSeed;
    this.nonce = nonce;
  }

  /**
   * ハッシュチェーンを進行させて指定ラウンド（cursor）のハッシュを取得
   */
  private generateHash(currentNonce: number, cursor: number = 0): string {
    return hmacSha256(this.serverSeed, `${this.clientSeed}:${currentNonce}:${cursor}`);
  }

  /**
   * 0以上1未満の浮動小数点を取得
   */
  public nextFloat(): number {
    const currentNonce = this.nonce++; // 必ず呼び出し時に1増加
    const hash = this.generateHash(currentNonce, 0);

    // JSの浮動小数点（最大52ビットまでの精度）とするために先頭13文字(52bit)を使用
    const bits52 = parseInt(hash.substring(0, 13), 16);
    return bits52 / Math.pow(2, 52);
  }

  /**
   * 指定範囲の整数を取得 (Modulo Bias対策付き)
   *
   * 【仕様: 再試行とNonceの扱いについて】
   * - 1回の乱数生成要求につき、必ず `nonce` は 1 だけ増加します。(リプレイ再現性を担保)
   * - 取出されたハッシュ値が Modulo Bias 回避の上限（maxVal）を超え棄却された場合、
   *   `nonce` は進めず、`cursor` を使って新たなハッシュを生成し再試行します。
   * - これにより、他の乱数取得メソッド(nextFloat等)と混在して呼ばれても消費されるnonceの数が厳密に保証されます。
   */
  public nextInt(min: number, max: number): number {
    const currentNonce = this.nonce++; // 必ず呼び出し時に1増加
    const range = max - min + 1;
    let cursor = 0;
    let hash = this.generateHash(currentNonce, cursor);
    let charIndex = 0;

    // 32ビット整数の上限に基づくRejection Sampling
    const limit = 4294967296; // 2^32
    const maxVal = limit - (limit % range);

    while (true) {
      // 現在のハッシュから32ビット(8文字)分が取れない場合は、新しいハッシュを生成
      if (charIndex + 8 > hash.length) {
        cursor++;
        hash = this.generateHash(currentNonce, cursor);
        charIndex = 0;
      }

      const slice = hash.substring(charIndex, charIndex + 8);
      const val = parseInt(slice, 16);
      charIndex += 8;

      if (val < maxVal) {
        return min + (val % range);
      }
    }
  }

  /**
   * 現在のnonceを取得（状態保存用）
   */
  public getNonce(): number {
    return this.nonce;
  }

  /**
   * 結果を再検証するための静的メソッド (Float検証用デモ)
   */
  public static verify(serverSeed: string, clientSeed: string, nonce: number): number {
    const hash = hmacSha256(serverSeed, `${clientSeed}:${nonce}:0`);
    const bits52 = parseInt(hash.substring(0, 13), 16);
    return bits52 / Math.pow(2, 52);
  }
}
