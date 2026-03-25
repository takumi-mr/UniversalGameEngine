import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IAIPlayer, AIDiagnosticValue } from "./IAIPlayer";
import type { IAIStateDeterminizer } from "./IAIStateDeterminizer";
import type { MCTSOptions } from "./MCTSPlayer";

class ISMCTSNode<TAction extends BaseGameAction> {
  public visits = 0;
  public wins = 0;
  public readonly children = new Map<string, ISMCTSNode<TAction>>();

  constructor(
    public readonly parent: ISMCTSNode<TAction> | null = null,
    public readonly action: TAction | null = null,
  ) {}

  public hasChild(action: TAction): boolean {
    return this.children.has(this.hashAction(action));
  }

  public getChild(action: TAction): ISMCTSNode<TAction> | undefined {
    return this.children.get(this.hashAction(action));
  }

  public addChild(action: TAction): ISMCTSNode<TAction> {
    const node = new ISMCTSNode(this, action);
    this.children.set(this.hashAction(action), node);
    return node;
  }

  // Actionの同一性判定ロジック
  private hashAction(action: TAction): string {
    return JSON.stringify(action, Object.keys(action).sort());
  }
}

export class InformationSetMCTSPlayer<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
> implements IAIPlayer<TState, TAction> {
  public readonly name: string;
  private readonly iterations: number;
  private readonly explorationConstant: number;
  private readonly thinkDelayMs: number;

  constructor(
    public readonly playerId: string,
    private readonly ruleset: GameRuleset<TState, TAction>,
    private readonly determinizer: IAIStateDeterminizer<TState>,
    options: MCTSOptions = {},
    name: string = "ISMCTSBot",
  ) {
    this.name = name;
    this.iterations = options.iterations ?? 1000;
    this.explorationConstant = options.explorationConstant ?? Math.sqrt(2);
    this.thinkDelayMs = options.thinkDelayMs ?? 0;
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

      // Selection & Expansion
      const { node, state: expandedState } = this.selectAndExpand(root, determinizedState);

      // Simulation
      const winnerIds = this.simulate(expandedState);

      // Backpropagation
      this.backpropagate(node, winnerIds);
    }

    // 最も訪問回数が多い子ノード（＝期待値・安定感が最も高い手）を選択
    let bestVisits = -1;
    let bestActionStr = "";

    // 合法手の中から最も訪問されたものを探す（rootのchildrenには非合法手が含まれている可能性があるため）
    for (const action of legalActions) {
      const actionHash = JSON.stringify(action, Object.keys(action).sort());
      const child = root.children.get(actionHash);
      if (child && child.visits > bestVisits) {
        bestVisits = child.visits;
        bestActionStr = actionHash;
      }
    }

    if (bestActionStr === "" || bestVisits === -1) {
      // もし探索で見つからなかった場合はランダム
      return legalActions[Math.floor(Math.random() * legalActions.length)];
    }

    return JSON.parse(bestActionStr) as TAction;
  }

  /**
   * Selection and Expansion
   */
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

      // この状態で可能なアクションのうち、まだ探索木に追加されていないもの（unexpanded）を探す
      const untriedActions = allLegalActions.filter((a) => !current.hasChild(a));

      if (untriedActions.length > 0) {
        // Expansion
        const randomUntriedAction =
          untriedActions[Math.floor(Math.random() * untriedActions.length)];
        const childNode = current.addChild(randomUntriedAction);
        currentState = this.ruleset.reduce(currentState, randomUntriedAction);
        return { node: childNode, state: currentState };
      } else {
        // Selection (UCB1) - 全ての合法手が木に存在する場合
        // この「決定化された状態」での合法手のみから評価する
        let bestScore = -Infinity;
        let bestAction: TAction | null = null;
        let bestChild: ISMCTSNode<TAction> | null = null;

        for (const action of allLegalActions) {
          const child = current.getChild(action);
          if (!child) continue;

          const exploitation = child.wins / child.visits;
          // ここでの親の総訪問回数は、あくまで「その手番の全合法手の訪問回数合計」とするのが厳密だが
          // 簡略化して current.visits を使うのが一般的
          const exploration =
            this.explorationConstant * Math.sqrt(Math.log(current.visits) / child.visits);
          const score = exploitation + exploration;

          if (score > bestScore) {
            bestScore = score;
            bestAction = action;
            bestChild = child;
          }
        }

        if (!bestChild || !bestAction) {
          // 予期せぬエラー発生時はここで返す
          return { node: current, state: currentState };
        }

        current = bestChild;
        currentState = this.ruleset.reduce(currentState, bestAction);
      }
    }
  }

  /**
   * Simulation (Rollout)
   */
  private simulate(state: TState): string[] {
    let current = state;
    let depth = 0;
    const MAX_ROLLOUT_DEPTH = 100; // 無限ループ回避用

    while (depth < MAX_ROLLOUT_DEPTH) {
      const winResult = this.ruleset.checkWinCondition(current);
      if (winResult.isFinished) {
        return winResult.winnerIds || [];
      }

      const activePlayer = current.activePlayers?.[0];
      if (!activePlayer) break;

      const actions = this.ruleset.getLegalActions(current, activePlayer);
      if (actions.length === 0) break;

      const randomAction = actions[Math.floor(Math.random() * actions.length)];
      current = this.ruleset.reduce(current, randomAction);
      depth++;
    }

    return []; // Depth到達または行動不能による引き分け扱い
  }

  /**
   * Backpropagation
   */
  private backpropagate(node: ISMCTSNode<TAction>, winnerIds: string[]): void {
    let current: ISMCTSNode<TAction> | null = node;

    while (current) {
      current.visits++;

      if (current.action) {
        // そのノードに向かう手（アクション）を打ったプレイヤーが勝者なら勝利数を加算
        const actionPlayerId = current.action.playerId;
        if (actionPlayerId && winnerIds.includes(actionPlayerId)) {
          current.wins += 1;
        } else if (winnerIds.length === 0) {
          // 引き分け
          current.wins += 0.5;
        }
      } else {
        // root node
        if (winnerIds.includes(this.playerId)) {
          current.wins += 1;
        } else if (winnerIds.length === 0) {
          current.wins += 0.5;
        }
      }

      current = current.parent;
    }
  }

  // ------------------------------------------
  // オプショナルな IAIPlayer メソッドの実装
  // ------------------------------------------
  public getDiagnostics?(): Record<string, AIDiagnosticValue> {
    return {
      type: "InformationSetMCTS",
      iterations: this.iterations,
    };
  }
}
