// packages/shared/rules/Othello3DRuleset.ts
import type { GameRuleset, BaseGameState, BaseGameAction } from '../GameRules';

export type PlayerColor = 1 | -1; // 1: 黒, -1: 白

export interface Position {
    x: number;
    y: number;
    z: number;
}

// 汎用エンジンの BaseGameState を継承
export interface GameState extends BaseGameState {
    board: number[][][];
    currentTurn: PlayerColor;
    scores: Record<number, number>;
    validMoves: Position[];
    players: Record<PlayerColor, string | null>;
}

// 汎用エンジンの BaseGameAction を継承 (type が必須になる)
export interface MoveAction extends BaseGameAction, Position {
    type: 'MOVE';
    color: PlayerColor;
}

export const Othello3DRuleset: GameRuleset<GameState, MoveAction> = {

    // 初期状態の生成
    getInitialState: (options = { size: 4 }) => {
        const size = options.size;
        const board = Array.from({ length: size }, () =>
            Array.from({ length: size }, () => Array(size).fill(0))
        );
        const m = Math.floor(size / 2);
        const scores = { 1: 0, [-1]: 0 };

        for (let dz = -1; dz <= 0; dz++) {
            for (let dy = -1; dy <= 0; dy++) {
                for (let dx = -1; dx <= 0; dx++) {
                    const color = (dx + dy + dz) % 2 === 0 ? 1 : -1;
                    board[m + dz][m + dy][m + dx] = color;
                    scores[color as PlayerColor]++;
                }
            }
        }

        const state: GameState = {
            board,
            currentTurn: 1,
            scores,
            validMoves: [],
            players: { 1: null, [-1]: null }, // サーバーで割り当てる
            status: 'WAITING', // BaseGameState で要求される
            message: ''        // BaseGameState で要求される
        };
        state.validMoves = calculateValidMoves(state, 1, size);
        return state;
    },

    // 合法手チェック
    isValidAction: (state, action) => {
        if (state.status !== 'PLAYING') return false;
        if (action.color !== state.currentTurn) return false;
        if (action.type !== 'MOVE') return false; // Actionの種別チェックも追加

        // 【セキュリティ】送信者のユーザーIDが、割り当てられたプレイヤーであるかを検証
        const expectedPlayerId = state.players[action.color];
        if (expectedPlayerId !== null && action.playerId !== expectedPlayerId) {
            console.warn(`[Security] Action blocked: expected player ${expectedPlayerId}, got ${action.playerId}`);
            return false;
        }

        return isValidMove(state.board, action.x, action.y, action.z, action.color, state.board.length);
    },

    // 状態の更新 (Reducer)
    reduce: (state, action) => {
        const size = state.board.length;
        const nextBoard = JSON.parse(JSON.stringify(state.board));
        const color = action.color;
        const opponent = (color === 1 ? -1 : 1) as PlayerColor;

        nextBoard[action.z][action.y][action.x] = color;
        let flippedCount = 0;

        for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    const flips = countFlips(state.board, action.x, action.y, action.z, dx, dy, dz, color, size);
                    for (let i = 1; i <= flips; i++) {
                        nextBoard[action.z + dz * i][action.y + dy * i][action.x + dx * i] = color;
                        flippedCount++;
                    }
                }
            }
        }

        const nextScores = {
            [color]: state.scores[color] + flippedCount + 1,
            [opponent]: state.scores[opponent] - flippedCount
        };

        let nextTurn = opponent;
        let nextValidMoves = calculateValidMoves({ ...state, board: nextBoard }, nextTurn, size);
        let message = state.message; // 以前のメッセージを引き継ぐ

        if (nextValidMoves.length === 0) {
            nextValidMoves = calculateValidMoves({ ...state, board: nextBoard }, color, size);
            if (nextValidMoves.length > 0) {
                message = `${opponent === 1 ? "Black" : "White"} passed!`;
                nextTurn = color;
            } else {
                nextTurn = color;
            }
        } else {
            message = ''; // 通常のターン交代時はメッセージをクリア
        }

        return {
            ...state,
            board: nextBoard,
            currentTurn: nextTurn,
            scores: nextScores,
            validMoves: nextValidMoves,
            message
        };
    },

    // 勝敗・ステータス判定
    checkWinCondition: (state) => {
        if (state.validMoves.length === 0) {
            const b = state.scores[1];
            const w = state.scores[-1];
            let msg = "Game Over: Draw!";
            let winnerIds: string[] = [];
            if (b > w) {
                msg = "Game Over: Black Wins!";
                const bId = state.players?.[1];
                if (bId) winnerIds = [bId];
            } else if (w > b) {
                msg = "Game Over: White Wins!";
                const wId = state.players?.[-1];
                if (wId) winnerIds = [wId];
            }
            return { isFinished: true, winnerIds, message: msg };
        }
        return { isFinished: false, message: state.message };
    },

    applyWinResult: (state, winResult) => ({
        ...state,
        status: 'FINISHED',
        message: winResult.message,
        activePlayers: [],
    }),

    getLegalActions: (state, playerId) => {
        if (state.status !== 'PLAYING') return [];
        const color = state.currentTurn;

        if (state.players && state.players[color] !== null && state.players[color] !== playerId) {
            return [];
        }

        return state.validMoves.map(pos => ({
            type: 'MOVE' as const,
            color,
            x: pos.x,
            y: pos.y,
            z: pos.z,
            playerId
        }));
    }
};

// --- ヘルパー関数群 ---

function countFlips(board: number[][][], x: number, y: number, z: number, dx: number, dy: number, dz: number, color: number, size: number): number {
    let count = 0;
    let cx = x + dx, cy = y + dy, cz = z + dz;
    while (cx >= 0 && cx < size && cy >= 0 && cy < size && cz >= 0 && cz < size) {
        const piece = board[cz][cy][cx];
        if (piece === 0) return 0;
        if (piece === color) return count;
        count++;
        cx += dx; cy += dy; cz += dz;
    }
    return 0;
}

function isValidMove(board: number[][][], x: number, y: number, z: number, color: PlayerColor, size: number): boolean {
    if (board[z][y][x] !== 0) return false;
    for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0 && dz === 0) continue;
                if (countFlips(board, x, y, z, dx, dy, dz, color, size) > 0) return true;
            }
        }
    }
    return false;
}

function calculateValidMoves(state: GameState, color: PlayerColor, size: number): Position[] {
    const moves: Position[] = [];
    for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (isValidMove(state.board, x, y, z, color, size)) {
                    moves.push({ x, y, z });
                }
            }
        }
    }
    return moves;
}