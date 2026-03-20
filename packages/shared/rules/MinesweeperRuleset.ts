import type { BaseGameState, BaseGameAction, GameRuleset, GameResult, Secret } from '../GameRules';
import { createSecret } from '../GameRules';
import type { IGameRNG } from '../utils/IGameRNG';

// --- Types ---

export interface MinesweeperCell {
    isRevealed: boolean;
    isFlagged: boolean;
    secret: Secret<{
        isMine: boolean;
        neighborMines: number;
    }>;
}

export interface MinesweeperState extends BaseGameState {
    board: MinesweeperCell[][];
    rows: number;
    cols: number;
    mineCount: number;
    isInitialized: boolean;
}

export type MinesweeperActionType = 'REVEAL' | 'FLAG';

export interface MinesweeperAction extends BaseGameAction {
    type: MinesweeperActionType;
    row: number;
    col: number;
}

// --- Rule Implementation ---

export const MinesweeperRuleset: GameRuleset<MinesweeperState, MinesweeperAction> = {

    getInitialState: (options?: { rows?: number, cols?: number, mineCount?: number }, rng?: IGameRNG): MinesweeperState => {
        const rows = options?.rows ?? 10;
        const cols = options?.cols ?? 10;
        const mineCount = options?.mineCount ?? 10;

        const board: MinesweeperCell[][] = [];
        for (let r = 0; r < rows; r++) {
            const row: MinesweeperCell[] = [];
            for (let c = 0; c < cols; c++) {
                row.push({
                    isRevealed: false,
                    isFlagged: false,
                    secret: createSecret({ isMine: false, neighborMines: 0 }, [])
                });
            }
            board.push(row);
        }

        return {
            status: 'WAITING',
            players: { 1: null },
            activePlayers: [],
            board,
            rows,
            cols,
            mineCount,
            isInitialized: false
        };
    },

    isValidAction: (state, action) => {
        if (state.status !== 'PLAYING') return false;
        if (action.row < 0 || action.row >= state.rows || action.col < 0 || action.col >= state.cols) return false;

        const cell = state.board[action.row][action.col];
        if (action.type === 'REVEAL') {
            return !cell.isRevealed && !cell.isFlagged;
        }
        if (action.type === 'FLAG') {
            return !cell.isRevealed;
        }
        return false;
    },

    reduce: (state, action, rng) => {
        // Use a simple clone for state
        const newState: MinesweeperState = JSON.parse(JSON.stringify(state));

        if (action.type === 'FLAG') {
            const cell = newState.board[action.row][action.col];
            cell.isFlagged = !cell.isFlagged;
            return newState;
        }

        if (action.type === 'REVEAL') {
            if (!newState.isInitialized) {
                initializeBoard(newState, action.row, action.col, rng);
                newState.isInitialized = true;
            }
            revealCells(newState, action.row, action.col);
        }

        return newState;
    },

    checkWinCondition: (state) => {
        for (let r = 0; r < state.rows; r++) {
            for (let c = 0; c < state.cols; c++) {
                const cell = state.board[r][c];
                if (cell.isRevealed && cell.secret.value.isMine) {
                    return { isFinished: true, winnerIds: [], message: "Game Over! You hit a mine." };
                }
            }
        }

        let unrevealedNonMines = 0;
        for (let r = 0; r < state.rows; r++) {
            for (let c = 0; c < state.cols; c++) {
                const cell = state.board[r][c];
                if (!cell.secret.value.isMine && !cell.isRevealed) {
                    unrevealedNonMines++;
                }
            }
        }

        if (unrevealedNonMines === 0) {
            const winnerId = state.players ? Object.values(state.players)[0] : "Player";
            return {
                isFinished: true,
                winnerIds: winnerId ? [winnerId] : [],
                message: "Congratulations! You cleared all mines."
            };
        }

        return { isFinished: false };
    },

    applyWinResult: (state, result) => {
        const newState: MinesweeperState = JSON.parse(JSON.stringify(state));
        newState.status = 'FINISHED';
        newState.message = result.message;
        newState.activePlayers = [];

        if (result.winnerIds?.length === 0) {
            for (let r = 0; r < newState.rows; r++) {
                for (let c = 0; c < newState.cols; c++) {
                    const cell = newState.board[r][c];
                    if (cell.secret.value.isMine) {
                        cell.isRevealed = true;
                        cell.secret.visibleTo = ['*'];
                    }
                }
            }
        }
        return newState;
    },

    getLegalActions: (state, playerId) => {
        if (state.status !== 'PLAYING') return [];
        const actions: MinesweeperAction[] = [];
        for (let r = 0; r < state.rows; r++) {
            for (let c = 0; c < state.cols; c++) {
                const cell = state.board[r][c];
                if (!cell.isRevealed) {
                    if (!cell.isFlagged) {
                        actions.push({ type: 'REVEAL', row: r, col: c, playerId });
                    }
                    actions.push({ type: 'FLAG', row: r, col: c, playerId });
                }
            }
        }
        return actions;
    }
};

function initializeBoard(state: MinesweeperState, startRow: number, startCol: number, rng?: IGameRNG) {
    const { rows, cols, mineCount } = state;
    let placedMines = 0;
    while (placedMines < mineCount) {
        const r = rng ? rng.nextInt(0, rows - 1) : Math.floor(Math.random() * rows);
        const c = rng ? rng.nextInt(0, cols - 1) : Math.floor(Math.random() * cols);
        if (r === startRow && c === startCol) continue;
        if (state.board[r][c].secret.value.isMine) continue;
        state.board[r][c].secret.value.isMine = true;
        placedMines++;
    }

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (state.board[r][c].secret.value.isMine) continue;
            let count = 0;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                        if (state.board[nr][nc].secret.value.isMine) count++;
                    }
                }
            }
            state.board[r][c].secret.value.neighborMines = count;
        }
    }
}

function revealCells(state: MinesweeperState, startRow: number, startCol: number) {
    const stack: [number, number][] = [[startRow, startCol]];

    while (stack.length > 0) {
        const [r, c] = stack.pop()!;
        const cell = state.board[r][c];

        if (cell.isRevealed || cell.isFlagged) continue;

        cell.isRevealed = true;
        cell.secret.visibleTo = ['*'];

        if (!cell.secret.value.isMine && cell.secret.value.neighborMines === 0) {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) {
                        if (!state.board[nr][nc].isRevealed && !state.board[nr][nc].isFlagged) {
                            stack.push([nr, nc]);
                        }
                    }
                }
            }
        }
    }
}
