import type { BaseGameState, BaseGameAction, GameRuleset } from "@engine/shared/GameRules";
import type { IAIPlayer, AIDiagnosticValue } from "@engine/shared/ai/IAIPlayer";
import type { IAIStateDeterminizer } from "@engine/shared/ai/IAIStateDeterminizer";
import type { MCTSOptions } from "@engine/shared/ai/AIPlayer/MCTSPlayer";

export interface ISMCTSOptions<TState extends BaseGameState = BaseGameState> extends MCTSOptions {
  maxRolloutDepth?: number;
  // ロールアウトが深さ上限で打ち切られたときの各プレイヤーの評価値 (0..1)。未指定なら全員 0.5（引き分け扱い）
  evaluateCutoff?: (state: TState) => Record<string, number>;
}

// ネストしたオブジェクトも含めてキー順を正規化する（JSON.stringify の配列 replacer はネスト先のキーを落とすため使わない）
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashAction(action: BaseGameAction): string {
  const { timestamp: _timestamp, ...rest } = action;
  return stableStringify(rest);
}

type Evaluation = (playerId: string) => number;

function evaluationFromWinners(winnerIds: string[]): Evaluation {
  if (winnerIds.length === 0) return () => 0.5;
  return (playerId) => (winnerIds.includes(playerId) ? 1 : 0);
}

class ISMCTSNode<TAction extends BaseGameAction> {
  public visits = 0;
  public wins = 0;
  // この手が「選択肢として合法だった」回数。決定化ごとに合法手が変わるため、UCB の探索項にはこれを使う
  public availability = 0;
  public readonly children = new Map<string, ISMCTSNode<TAction>>();
  public readonly parent: ISMCTSNode<TAction> | null;
  public readonly action: TAction | null;

  constructor(parent: ISMCTSNode<TAction> | null = null, action: TAction | null = null) {
    this.parent = parent;
    this.action = action;
  }

  public getChild(action: TAction): ISMCTSNode<TAction> | undefined {
    return this.children.get(hashAction(action));
  }

  public addChild(action: TAction): ISMCTSNode<TAction> {
    const node = new ISMCTSNode(this, action);
    this.children.set(hashAction(action), node);
    return node;
  }
}

export class InformationSetMCTSPlayer<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
> implements IAIPlayer<TState, TAction> {
  public readonly playerId: string;
  public readonly name: string;
  private readonly ruleset: GameRuleset<TState, TAction>;
  private readonly determinizer: IAIStateDeterminizer<TState>;
  private readonly iterations: number;
  private readonly explorationConstant: number;
  private readonly thinkDelayMs: number;
  private readonly maxRolloutDepth: number;
  private readonly evaluateCutoff?: (state: TState) => Record<string, number>;

  constructor(
    playerId: string,
    ruleset: GameRuleset<TState, TAction>,
    determinizer: IAIStateDeterminizer<TState>,
    options: ISMCTSOptions<TState> = {},
    name: string = "ISMCTSBot",
  ) {
    this.playerId = playerId;
    this.ruleset = ruleset;
    this.determinizer = determinizer;
    this.name = name;
    this.iterations = options.iterations ?? 1000;
    this.explorationConstant = options.explorationConstant ?? Math.sqrt(2);
    this.thinkDelayMs = options.thinkDelayMs ?? 0;
    this.maxRolloutDepth = options.maxRolloutDepth ?? 100;
    this.evaluateCutoff = options.evaluateCutoff;
  }

  public async computeNextMove(
    maskedState: TState,
    legalActions: TAction[],
  ): Promise<TAction | null> {
    if (!legalActions || legalActions.length === 0) {
      return null;
    }

    if (this.thinkDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.thinkDelayMs));
    }

    const root = new ISMCTSNode<TAction>();

    for (let i = 0; i < this.iterations; i++) {
      // 反復ごとに、「もし相手の手札がこうだったら」という完全状態をサンプリングする
      const determinizedState = this.determinizer.determinize(maskedState, this.playerId);

      const { node, state: expandedState } = this.selectAndExpand(root, determinizedState);
      const scores = this.simulate(expandedState);
      this.backpropagate(node, scores);
    }

    // 合法手の中から最も訪問回数が多い手（＝期待値・安定感が最も高い手）を選択
    let bestVisits = -1;
    let bestAction: TAction | null = null;
    for (const action of legalActions) {
      const child = root.getChild(action);
      if (child && child.visits > bestVisits) {
        bestVisits = child.visits;
        bestAction = action;
      }
    }

    return bestAction ?? legalActions[Math.floor(Math.random() * legalActions.length)];
  }

  private selectAndExpand(
    root: ISMCTSNode<TAction>,
    initialState: TState,
  ): { node: ISMCTSNode<TAction>; state: TState } {
    let current = root;
    let currentState = initialState;

    while (true) {
      const winResult = this.ruleset.checkWinCondition(currentState);
      if (winResult.isFinished) {
        return { node: current, state: currentState };
      }

      const activePlayer = currentState.activePlayers?.[0];
      if (!activePlayer) return { node: current, state: currentState };

      const allLegalActions = this.ruleset.getLegalActions(currentState, activePlayer);
      if (allLegalActions.length === 0) return { node: current, state: currentState };

      const untriedActions = allLegalActions.filter((a) => !current.getChild(a));

      if (untriedActions.length > 0) {
        // Expansion
        const randomUntriedAction =
          untriedActions[Math.floor(Math.random() * untriedActions.length)];
        const childNode = current.addChild(randomUntriedAction);
        childNode.availability++;
        currentState = this.ruleset.reduce(currentState, randomUntriedAction);
        return { node: childNode, state: currentState };
      }

      // Selection (UCB1) - この決定化状態で合法な子だけを候補にする
      let bestScore = -Infinity;
      let bestAction: TAction | null = null;
      let bestChild: ISMCTSNode<TAction> | null = null;

      for (const action of allLegalActions) {
        const child = current.getChild(action)!;
        child.availability++;

        const exploitation = child.wins / child.visits;
        const exploration =
          this.explorationConstant * Math.sqrt(Math.log(child.availability) / child.visits);
        const score = exploitation + exploration;

        if (score > bestScore) {
          bestScore = score;
          bestAction = action;
          bestChild = child;
        }
      }

      current = bestChild!;
      currentState = this.ruleset.reduce(currentState, bestAction!);
    }
  }

  /**
   * Rollout。プレイヤーID → 評価値 (勝ち=1, 引き分け=0.5, 負け=0) の関数を返す
   */
  private simulate(state: TState): Evaluation {
    let current = state;

    for (let depth = 0; depth < this.maxRolloutDepth; depth++) {
      const winResult = this.ruleset.checkWinCondition(current);
      if (winResult.isFinished) {
        return evaluationFromWinners(winResult.winnerIds ?? []);
      }

      const activePlayer = current.activePlayers?.[0];
      if (!activePlayer) return evaluationFromWinners([]);

      const actions = this.ruleset.getLegalActions(current, activePlayer);
      if (actions.length === 0) return evaluationFromWinners([]);

      const randomAction = actions[Math.floor(Math.random() * actions.length)];
      current = this.ruleset.reduce(current, randomAction);
    }

    if (!this.evaluateCutoff) return evaluationFromWinners([]);
    const scores = this.evaluateCutoff(current);
    return (playerId) => scores[playerId] ?? 0.5;
  }

  private backpropagate(node: ISMCTSNode<TAction>, evaluate: Evaluation): void {
    let current: ISMCTSNode<TAction> | null = node;

    while (current) {
      current.visits++;
      // そのノードに向かう手を打ったプレイヤー視点の評価値を加算する（root は自分視点）
      current.wins += evaluate(current.action?.playerId ?? this.playerId);
      current = current.parent;
    }
  }

  public getDiagnostics?(): Record<string, AIDiagnosticValue> {
    return {
      type: "InformationSetMCTS",
      iterations: this.iterations,
    };
  }
}
