// packages/shared/ai/MinimaxPlayer.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IAIPlayer } from "./IAIPlayer";

/**
 * 状態評価関数の型
 * @param state 評価対象の状態
 * @param playerId AI自身のプレイヤーID。このプレイヤーにとって有利なほど高い値を返す必要がある。
 */
export type EvaluationFunction<TState extends BaseGameState> = (
  state: TState,
  playerId: string,
) => number;

export interface MinimaxOptions<TState extends BaseGameState> {
  maxDepth?: number;
  evaluationFunction?: EvaluationFunction<TState>;
  thinkDelayMs?: number;
}

/**
 * Minimaxアルゴリズム（Alpha-Beta枝刈り付き）を用いたAIプレイヤー
 */
export class MinimaxPlayer<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
> implements IAIPlayer<TState, TAction> {
  public readonly name: string;
  public readonly playerId: string;
  private readonly ruleset: GameRuleset<TState, TAction>;
  private readonly maxDepth: number;
  private readonly evaluationFunction: EvaluationFunction<TState>;
  private readonly thinkDelayMs: number;

  constructor(
    playerId: string,
    ruleset: GameRuleset<TState, TAction>,
    options: MinimaxOptions<TState> = {},
    name: string = "MinimaxBot",
  ) {
    this.playerId = playerId;
    this.ruleset = ruleset;
    this.name = name;
    this.maxDepth = options.maxDepth ?? 3;
    this.thinkDelayMs = options.thinkDelayMs ?? 0;

    // デフォルトの評価関数（単純に勝利なら1000、敗北なら-1000、それ以外は0）
    this.evaluationFunction =
      options.evaluationFunction ??
      ((state, pId) => {
        const result = this.ruleset.checkWinCondition(state);
        if (result.isFinished) {
          if (!result.winnerIds || result.winnerIds.length === 0) return 0;
          // messageに勝者が含まれていると仮定するか、
          // activePlayersが空で誰が勝ったか判断する仕組みが必要だが、
          // 一般的なルールセットでは message に勝者が書かれることが多い。
          // 仮の実装として、自分のIDが含まれていれば勝ちとする。
          if (result.message?.includes(pId)) return 1000;
          return -1000;
        }
        return 0;
      });
  }

  public async computeNextMove(state: TState, legalActions: TAction[]): Promise<TAction | null> {
    if (!legalActions || legalActions.length === 0) {
      return null;
    }

    if (this.thinkDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.thinkDelayMs));
    }

    let bestAction: TAction | null = null;
    let bestValue = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    // ルートノードで全合法手を評価
    for (const action of legalActions) {
      const nextState = this.ruleset.reduce(state, action);
      const value = this.minimax(nextState, this.maxDepth - 1, alpha, beta);

      if (value > bestValue) {
        bestValue = value;
        bestAction = action;
      }
      alpha = Math.max(alpha, bestValue);
    }

    return bestAction ? { ...bestAction, playerId: this.playerId } : null;
  }

  /**
   * アルファ・ベータ法による探索
   */
  private minimax(state: TState, depth: number, alpha: number, beta: number): number {
    // 終了条件
    const winResult = this.ruleset.checkWinCondition(state);
    if (winResult.isFinished || depth === 0) {
      return this.evaluationFunction(state, this.playerId);
    }

    const activePlayers = state.activePlayers || [];
    // もしアクティブプレイヤーがいない（終わっているはずだが念のため）場合は評価を返す
    if (activePlayers.length === 0) {
      return this.evaluationFunction(state, this.playerId);
    }

    // 現在のアクティブプレイヤーが自分自身かどうかで最大化・最小化を切り替える
    // (複数人いる場合は先頭のプレイヤーを基準にする)
    const isMyTurn = activePlayers.includes(this.playerId);

    if (isMyTurn) {
      let maxEval = -Infinity;
      const actions = this.ruleset.getLegalActions(state, this.playerId);

      // 手が打てない場合は相手のターンとしてパス（深さを減らして探索継続）
      if (actions.length === 0) return this.minimax(state, depth - 1, alpha, beta);

      for (const action of actions) {
        const nextState = this.ruleset.reduce(state, action);
        const evalVal = this.minimax(nextState, depth - 1, alpha, beta);
        maxEval = Math.max(maxEval, evalVal);
        alpha = Math.max(alpha, evalVal);
        if (beta <= alpha) break; // Beta cut-off
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      // 相手（自分以外の誰か）の視点での探索
      const opponentId = activePlayers.find((id) => id !== this.playerId) || "opponent";
      const actions = this.ruleset.getLegalActions(state, opponentId);

      if (actions.length === 0) return this.minimax(state, depth - 1, alpha, beta);

      for (const action of actions) {
        const nextState = this.ruleset.reduce(state, action);
        const evalVal = this.minimax(nextState, depth - 1, alpha, beta);
        minEval = Math.min(minEval, evalVal);
        beta = Math.min(beta, evalVal);
        if (beta <= alpha) break; // Alpha cut-off
      }
      return minEval;
    }
  }
}
