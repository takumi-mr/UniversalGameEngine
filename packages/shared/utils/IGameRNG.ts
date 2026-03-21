// packages/shared/utils/IGameRNG.ts

/**
 * 汎用的な乱数生成器のインターフェース
 * 将来的に異なるアルゴリズムや外部ソースに差し替え可能
 */
export interface IGameRNG {
  /** 0以上1未満の浮動小数点を返す */
  nextFloat(): number;
  /** min以上max以下の整数を返す */
  nextInt(min: number, max: number): number;
}
