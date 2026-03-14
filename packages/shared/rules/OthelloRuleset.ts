// packages/shared/rules/OthelloRuleset.ts
import type { GameRuleset, BaseGameState, BaseGameAction } from '../UniversalEngine';

export type PlayerColor = 1 | -1; // 1: 黒, -1: 白

export interface OthelloState extends BaseGameState {
    board: number[][];
    currentTurn: PlayerColor;
    scores: Record<number, number>;
    size: number;
    players: Record<PlayerColor, string | null>;
    validMoves: { x: number, y: number }[]; // UIハイライト用
}

export interface OthelloAction extends BaseGameAction {
    type: 'PLACE_PIECE';
    x: number;
    y: number;
    color: PlayerColor;
}

// 8方向のベクトル定義
const DIRECTIONS = [
    { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: -1, dy: 1 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 },
];

// 合法手リストを計算するヘルパー関数
function calculateValidMoves(board: number[][], color: PlayerColor, size: number): { x: number, y: number }[] {
    const validMoves = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (board[y][x] !== 0) continue;
            const canPlace = DIRECTIONS.some(d => {
                let count = 0;
                let cx = x + d.dx, cy = y + d.dy;
                while (cx >= 0 && cx < size && cy >= 0 && cy < size) {
                    const t = board[cy][cx];
                    if (t === 0) break;
                    if (t === color) return count > 0;
                    count++;
                    cx += d.dx; cy += d.dy;
                }
                return false;
            });
            if (canPlace) validMoves.push({ x, y });
        }
    }
    return validMoves;
}

export const OthelloRuleset: GameRuleset<OthelloState, OthelloAction> = {
    getInitialState: (options = { size: 8 }): OthelloState => {
        const { size } = options;
        const board = Array.from({ length: size }, () => Array(size).fill(0));
        const m = Math.floor(size / 2);

        // 初期配置（標準的な白黒の交差）
        board[m - 1][m - 1] = -1; // 白
        board[m - 1][m] = 1;      // 黒
        board[m][m - 1] = 1;      // 黒
        board[m][m] = -1;         // 白

        const initialState: OthelloState = {
            board,
            currentTurn: 1,
            scores: { 1: 2, [-1]: 2 },
            size,
            players: { 1: null, [-1]: null },
            status: 'PLAYING',
            message: '',
            validMoves: []
        };

        // 最初の合法手を計算してセット
        initialState.validMoves = calculateValidMoves(board, 1, size);
        return initialState;
    },

    isValidAction: (state, action) => {
        if (state.status !== 'PLAYING') return false;
        if (action.type !== 'PLACE_PIECE') return false;
        if (action.color !== state.currentTurn) return false;

        const expectedPlayerId = state.players[action.color];
        if (expectedPlayerId !== null && action.playerId !== expectedPlayerId) return false;

        // 計算済みの合法手リストに含まれているかチェック
        return state.validMoves.some(m => m.x === action.x && m.y === action.y);
    },

    reduce: (state, action) => {
        // 2D配列のディープコピー
        const nextBoard = state.board.map(row => [...row]);
        const color = action.color;
        let flippedCount = 0;

        nextBoard[action.y][action.x] = color;

        DIRECTIONS.forEach(d => {
            let count = 0;
            let cx = action.x + d.dx, cy = action.y + d.dy;
            let canFlip = false;

            while (cx >= 0 && cx < state.size && cy >= 0 && cy < state.size) {
                const target = nextBoard[cy][cx];
                if (target === 0) break;
                if (target === color) {
                    canFlip = count > 0;
                    break;
                }
                count++;
                cx += d.dx; cy += d.dy;
            }

            if (canFlip) {
                cx = action.x + d.dx; cy = action.y + d.dy;
                for (let i = 0; i < count; i++) {
                    nextBoard[cy][cx] = color;
                    flippedCount++;
                    cx += d.dx; cy += d.dy;
                }
            }
        });

        const nextScores = {
            1: state.scores[1] + (color === 1 ? flippedCount + 1 : -flippedCount),
            [-1]: state.scores[-1] + (color === -1 ? flippedCount + 1 : -flippedCount)
        };

        const nextPlayer = (color * -1) as PlayerColor;
        let nextValidMoves = calculateValidMoves(nextBoard, nextPlayer, state.size);

        let finalTurn = nextPlayer;
        let message = '';
        let status = state.status;

        // パス判定
        if (nextValidMoves.length === 0) {
            nextValidMoves = calculateValidMoves(nextBoard, color, state.size);
            if (nextValidMoves.length === 0) {
                return { ...state, board: nextBoard, scores: nextScores, status: 'FINISHED', validMoves: [] };
            }
            message = `${nextPlayer === 1 ? '黒' : '白'} はパスです！`;
            finalTurn = color;
        }

        return {
            ...state,
            board: nextBoard,
            currentTurn: finalTurn,
            scores: nextScores,
            message,
            status,
            validMoves: nextValidMoves
        };
    },

    checkWinCondition: (state) => {
        if (state.status === 'FINISHED') {
            const { 1: b, [-1]: w } = state.scores;
            const msg = b > w ? "黒の勝ち！" : w > b ? "白の勝ち！" : "引き分け！";
            return { isFinished: true, message: msg };
        }
        return { isFinished: false, message: state.message };
    },

    getLegalActions: (state, playerId) => {
        if (state.status !== 'PLAYING') return [];
        const color = state.currentTurn;
        if (state.players && state.players[color] !== null && state.players[color] !== playerId) return [];

        return state.validMoves.map(m => ({
            type: 'PLACE_PIECE', color, x: m.x, y: m.y, playerId
        }));
    }
};