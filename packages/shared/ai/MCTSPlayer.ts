// packages/shared/ai/MCTSPlayer.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from '../GameRules';
import type { IAIPlayer } from './IAIPlayer';

export interface MCTSOptions {
    iterations?: number;
    explorationConstant?: number; // C in UCB1
    thinkDelayMs?: number;
}

class MCTSNode<TState extends BaseGameState, TAction extends BaseGameAction> {
    public visits = 0;
    public wins = 0;
    public children: MCTSNode<TState, TAction>[] = [];
    public parent: MCTSNode<TState, TAction> | null = null;

    // キャッシュ用プロパティ
    public unexpandedActions: TAction[];
    public isTerminal: boolean;

    constructor(
        public readonly state: TState,
        ruleset: GameRuleset<TState, TAction>,
        public readonly lastAction: TAction | null = null
    ) {
        // ノード生成時に1回だけ計算してキャッシュする
        const winResult = ruleset.checkWinCondition(state);
        this.isTerminal = winResult.isFinished;

        if (this.isTerminal) {
            this.unexpandedActions = [];
        } else {
            const activePlayer = state.activePlayers?.[0];
            this.unexpandedActions = activePlayer
                ? ruleset.getLegalActions(state, activePlayer)
                : [];
        }
    }

    // 未探索の手がなければ完全に展開済み
    public isFullyExpanded(): boolean {
        return this.unexpandedActions.length === 0;
    }

    public getBestChild(c: number): MCTSNode<TState, TAction> | null {
        let bestScore = -Infinity;
        let bestChild: MCTSNode<TState, TAction> | null = null;

        for (const node of this.children) {
            const exploitation = node.wins / node.visits;
            const exploration = c * Math.sqrt(Math.log(this.visits) / node.visits);
            const score = exploitation + exploration;

            if (score > bestScore) {
                bestScore = score;
                bestChild = node;
            }
        }

        return bestChild;
    }
}

/**
 * モンテカルロ木探索 (MCTS) を用いたAIプレイヤー
 */
export class MCTSPlayer<TState extends BaseGameState, TAction extends BaseGameAction>
    implements IAIPlayer<TState, TAction> {

    public readonly name: string;
    public readonly playerId: string;
    private readonly ruleset: GameRuleset<TState, TAction>;
    private readonly iterations: number;
    private readonly explorationConstant: number;
    private readonly thinkDelayMs: number;

    constructor(
        playerId: string,
        ruleset: GameRuleset<TState, TAction>,
        options: MCTSOptions = {},
        name: string = "MCTSBot"
    ) {
        this.playerId = playerId;
        this.ruleset = ruleset;
        this.name = name;
        this.iterations = options.iterations ?? 1000;
        this.explorationConstant = options.explorationConstant ?? Math.sqrt(2);
        this.thinkDelayMs = options.thinkDelayMs ?? 0;
    }

    public async computeNextMove(state: TState, legalActions: TAction[]): Promise<TAction | null> {
        if (!legalActions || legalActions.length === 0) {
            return null;
        }

        if (this.thinkDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.thinkDelayMs));
        }

        const root = new MCTSNode<TState, TAction>(state, this.ruleset);

        for (let i = 0; i < this.iterations; i++) {
            let node = this.select(root);
            const winner = this.simulate(node.state);
            this.backpropagate(node, winner);
        }

        // 最も訪問回数が多い子ノードを選択
        let bestVisits = -1;
        let bestAction: TAction | null = null;

        for (const node of root.children) {
            if (node.visits > bestVisits) {
                bestVisits = node.visits;
                bestAction = node.lastAction;
            }
        }

        return bestAction ? { ...bestAction, playerId: this.playerId } : null;
    }

    /**
     * Selection & Expansion
     */
    private select(node: MCTSNode<TState, TAction>): MCTSNode<TState, TAction> {
        let current = node;

        while (!current.isTerminal) {
            if (!current.isFullyExpanded()) {
                // 未展開の手があれば展開して返す
                return this.expand(current);
            } else {
                // 全て展開済みならUCB1値が最大の子へ進む
                const nextChild = current.getBestChild(this.explorationConstant);
                if (!nextChild) break;
                current = nextChild;
            }
        }
        return current;
    }

    /**
     * Expansion
     */
    private expand(node: MCTSNode<TState, TAction>): MCTSNode<TState, TAction> {
        // キャッシュされた未展開リストからランダムに1つ取り出す (popを使うとより高速)
        const randomIndex = Math.floor(Math.random() * node.unexpandedActions.length);
        const action = node.unexpandedActions.splice(randomIndex, 1)[0];

        const nextState = this.ruleset.reduce(node.state, action);
        // 新しいノード生成時にルールセットを渡してキャッシュを作らせる
        const newNode = new MCTSNode<TState, TAction>(nextState, this.ruleset, action);
        newNode.parent = node;

        node.children.push(newNode);

        return newNode;
    }

    /**
     * Simulation (Rollout)
     */
    private simulate(state: TState): string | undefined {
        let current = state;
        let depth = 0;
        const MAX_ROLLOUT_DEPTH = 100; // 無限ループ防止

        while (depth < MAX_ROLLOUT_DEPTH) {
            const winResult = this.ruleset.checkWinCondition(current);
            if (winResult.isFinished) {
                if (!winResult.winnerIds || winResult.winnerIds.length === 0) {
                    return undefined;
                }
                return winResult.winnerIds[0];
            }

            const activePlayer = current.activePlayers?.[0];
            if (!activePlayer) return undefined;

            const actions = this.ruleset.getLegalActions(current, activePlayer);
            if (actions.length === 0) return undefined;

            const randomAction = actions[Math.floor(Math.random() * actions.length)];
            current = this.ruleset.reduce(current, randomAction);
            depth++;
        }

        return undefined;
    }

    /**
     * Backpropagation
     */
    private backpropagate(node: MCTSNode<TState, TAction>, winnerId: string | undefined): void {
        let current: MCTSNode<TState, TAction> | null = node;
        while (current) {
            current.visits++;

            if (winnerId !== undefined) {
                // このノードに到達するアクションを行ったプレイヤー（＝親ノードでの手番プレイヤー）を取得
                // ルートノードの場合は playerId (AI初期手番プレイヤー) と見なす
                const actingPlayerId = current.parent
                    ? (current.parent.state.activePlayers?.[0] || this.playerId)
                    : this.playerId;

                if (winnerId === actingPlayerId) {
                    current.wins += 1;
                }
            } else {
                // 引き分け
                current.wins += 0.5;
            }
            current = current.parent;
        }
    }
}
