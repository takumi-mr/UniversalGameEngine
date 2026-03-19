GameRuleset の拡張性を高め、reduce が肥大化（fat）するのを防ぐためのベストプラクティス。

### Action Dispatcher Pattern: 
Giant switch を排除し、アクションごとにハンドラーを分離。
### Phase-Based Reducers:
ゲームのフェーズ（オークション、メインなど）ごとにロジックを分割。
Atomic State Mutators: 状態更新のボイラープレートを削減し、可読性を向上。

```ts
/**
 * ModularRulesetTemplate.ts
 * A template for implementing scalable game rules in the UniversalGameEngine.
 */

import { BaseGameState, BaseGameAction, GameRuleset } from '../GameRules';

// --- Types ---
export interface MyState extends BaseGameState {
    phase: 'PRE' | 'MAIN' | 'POST';
    players: Record<string, MyPlayer>;
}

export interface MyPlayer {
    hp: number;
    score: number;
}

export type MyAction = 
    | { type: 'MOVE', playerId: string; x: number; y: number }
    | { type: 'END_TURN', playerId: string };

// --- Sub-Reducers ---

function handleMove(state: MyState, action: MyAction & { type: 'MOVE' }): MyState {
    const player = state.players[action.playerId];
    if (!player) return state;

    // Perform specific logic
    return {
        ...state,
        players: {
            ...state.players,
            [action.playerId]: { ...player, score: player.score + 1 }
        }
    };
}

function handleEndTurn(state: MyState, action: MyAction & { type: 'END_TURN' }): MyState {
    // Phase transition logic
    const nextPhase = state.phase === 'PRE' ? 'MAIN' : 'POST';
    return { ...state, phase: nextPhase };
}

// --- Dispatcher Mapping ---

const ACTION_MAP: Record<string, (state: MyState, action: any) => MyState> = {
    'MOVE': handleMove,
    'END_TURN': handleEndTurn,
};

// --- Ruleset Implementation ---

export const MyModularRuleset: GameRuleset<MyState, MyAction> = {
    getInitialState: (options) => ({
        status: 'WAITING',
        phase: 'PRE',
        players: {}
    }),

    isValidAction: (state, action) => {
        // Shared validation layer
        if (state.status !== 'PLAYING') return false;
        
        switch (action.type) {
            case 'MOVE': return action.x >= 0;
            default: return true;
        }
    },

    reduce: (state, action) => {
        // Master Dispatcher
        const handler = ACTION_MAP[action.type];
        if (handler) {
            return handler(state, action);
        }
        return state;
    },

    checkWinCondition: (state) => ({ isFinished: false }),
    getLegalActions: (state, playerId) => []
};

```