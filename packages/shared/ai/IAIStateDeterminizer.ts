import type { BaseGameState } from "../GameRules";

/**
 * 不完全情報ゲームにおける「情報集合（Information Set）」から、
 * 矛盾のない「確定状態（決定化状態）」をサンプリングするためのインターフェース
 */
export interface IAIStateDeterminizer<TState extends BaseGameState> {
  /**
   * 現在のプレイヤー視点でのマスクされた状態から、
   * 手札や隠し情報などを矛盾なく埋めた状態を1つ返す。
   * @param maskedState AIが観測している現在の状態（不完全情報）
   * @param viewpointPlayerId 視点となるプレイヤーID
   * @returns 決定化された（推論用の）完全情報状態
   */
  determinize(maskedState: TState, viewpointPlayerId: string): TState;
}
