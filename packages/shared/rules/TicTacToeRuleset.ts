import type { BaseGameState, BaseGameAction, GameRuleset } from '../GameRules';
import type { IGameRNG } from '../utils/IGameRNG';

// --- 型定義 ---
export interface TicTacToeState extends BaseGameState {
    board: number[];
    turn: number; // 1 or -1
}

export type TicTacToeActionType = 'PLACE';

export interface TicTacToeAction extends BaseGameAction {
    type: TicTacToeActionType;
    index?: number;
}

const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

export const TicTacToeRuleset: GameRuleset<TicTacToeState, TicTacToeAction> = {

    getInitialState: (_options?: any, _rng?: IGameRNG): TicTacToeState => ({
        status: 'WAITING',
        board: Array(9).fill(0),
        turn: 1,
        players: {
            1: null,
            "-1": null
        },
        activePlayers: []
    }),

    isValidAction: (state, action) => {

        if (state.status !== 'PLAYING') return false;
        if (action.type !== 'PLACE') return false;

        if (action.index === undefined) return false;
        if (action.index < 0 || action.index > 8) return false;

        // 手番プレイヤーチェック
        if (state.players) {
            const currentPlayer = state.players[state.turn];
            if (currentPlayer && action.playerId !== currentPlayer) {
                return false;
            }
        }

        // 空きマスチェック
        if (state.board[action.index] !== 0) return false;

        return true;
    },

    reduce: (state, action, _rng?: IGameRNG) => {

        const newState = structuredClone(state);

        switch (action.type) {

            case 'PLACE':

                if (action.index === undefined) break;

                newState.board[action.index] = state.turn;

                // ターン交代
                newState.turn = state.turn === 1 ? -1 : 1;

                if (newState.players) {
                    const next = newState.players[newState.turn];
                    newState.activePlayers = next ? [next] : [];
                }

                break;
        }

        return newState;
    },

    checkWinCondition: (state) => {
        for (const [a, b, c] of WIN_LINES) {
            const v = state.board[a];
            if (
                v !== 0 &&
                v === state.board[b] &&
                v === state.board[c]
            ) {
                const winnerId = state.players?.[v] ?? String(v);
                return {
                    isFinished: true,
                    winnerIds: [winnerId],
                    message: v === 1 ? "O Wins" : "X Wins"
                };
            }
        }

        if (!state.board.includes(0)) {
            return {
                isFinished: true,
                winnerIds: [],
                message: "Draw"
            };
        }

        return { isFinished: false };
    },

    applyWinResult: (state, winResult) => ({
        ...state,
        status: 'FINISHED',
        message: winResult.message,
        activePlayers: [],
    }),

    getLegalActions: (state, playerId) => {
        if (state.status !== 'PLAYING') return [];

        // 手番チェック
        if (state.players) {
            const current = state.players[state.turn];
            if (current && current !== playerId) return [];
        }

        const actions: TicTacToeAction[] = [];

        for (let i = 0; i < 9; i++) {
            if (state.board[i] === 0) {
                actions.push({
                    type: 'PLACE',
                    index: i,
                    playerId
                });
            }
        }

        return actions;
    }
};