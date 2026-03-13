// packages/shared/rules/OthelloRuleset.ts
import type { GameRuleset, BaseGameState, BaseGameAction } from '../UniversalEngine';

export type PlayerColor = 1 | -1; // 1: 黒, -1: 白

// BaseGameState を継承することで status, message が保証される
export interface OthelloState extends BaseGameState {
    board: number[][][];
    currentTurn: PlayerColor;
    scores: Record<number, number>;
    size: number;
}

// BaseGameAction を継承しつつ、固有のプロパティを定義
export interface OthelloAction extends BaseGameAction {
    type: 'PLACE_PIECE';
    x: number; 
    y: number; 
    z: number;
    color: PlayerColor;
}

// 26方向のベクトル定義
const DIRECTIONS = (() => {
    const dirs = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dy === 0 && dz === 0) continue;
                dirs.push({ dx, dy, dz });
            }
        }
    }
    return dirs;
})();

export const OthelloRuleset: GameRuleset<OthelloState, OthelloAction> = {
    getInitialState: (options = { size: 4 }): OthelloState => {
        const { size } = options;
        const board = Array.from({ length: size }, () =>
            Array.from({ length: size }, () => Array(size).fill(0))
        );
        const m = Math.floor(size / 2);
        
        // 初期配置
        for (let dz = -1; dz <= 0; dz++) {
            for (let dy = -1; dy <= 0; dy++) {
                for (let dx = -1; dx <= 0; dx++) {
                    board[m + dz][m + dy][m + dx] = (dx + dy + dz) % 2 === 0 ? 1 : -1;
                }
            }
        }
        
        return { 
            board, 
            currentTurn: 1, 
            scores: { 1: 4, [-1]: 4 }, 
            size,
            status: 'PLAYING', 
            message: '' 
        };
    },

    isValidAction: (state, action) => {
        if (state.status !== 'PLAYING') return false;
        if (action.type !== 'PLACE_PIECE') return false; // 型チェック
        if (action.color !== state.currentTurn) return false;
        if (state.board[action.z][action.y][action.x] !== 0) return false;

        return DIRECTIONS.some(d => countFlips(state, action.x, action.y, action.z, d.dx, d.dy, d.dz, action.color) > 0);
    },

    reduce: (state, action) => {
        // イミュータブルに更新（深いコピー）
        const nextBoard = JSON.parse(JSON.stringify(state.board));
        const color = action.color;
        let flippedCount = 0;

        nextBoard[action.z][action.y][action.x] = color;

        DIRECTIONS.forEach(d => {
            const flips = countFlips(state, action.x, action.y, action.z, d.dx, d.dy, d.dz, color);
            for (let i = 1; i <= flips; i++) {
                nextBoard[action.z + d.dz * i][action.y + d.dy * i][action.x + d.dx * i] = color;
                flippedCount++;
            }
        });

        const nextScores = {
            1: state.scores[1] + (color === 1 ? flippedCount + 1 : -flippedCount),
            [-1]: state.scores[-1] + (color === -1 ? flippedCount + 1 : -flippedCount)
        };

        // 次のターンを決定（パス判定含む）
        const nextPlayer = (color * -1) as PlayerColor;
        const hasMoves = hasValidMoves(nextBoard, nextPlayer, state.size);
        
        let finalTurn = nextPlayer;
        let message = '';
        let status = state.status;
        
        if (!hasMoves) {
            const currentHasMoves = hasValidMoves(nextBoard, color, state.size);
            if (!currentHasMoves) {
                // 両者パスで終了
                return { ...state, board: nextBoard, scores: nextScores, status: 'FINISHED' };
            }
            message = `${nextPlayer === 1 ? 'Black' : 'White'} passed!`;
            finalTurn = color; // パスなので手番交代しない
        }

        return { 
            ...state, 
            board: nextBoard, 
            currentTurn: finalTurn, 
            scores: nextScores, 
            message,
            status
        };
    },

    checkWinCondition: (state) => {
        if (state.status === 'FINISHED') {
            const { 1: b, [-1]: w } = state.scores;
            const msg = b > w ? "Black Wins!" : w > b ? "White Wins!" : "Draw!";
            return { isFinished: true, message: `Finished: ${msg}` };
        }
        return { isFinished: false, message: state.message };
    }
};

// ヘルパー関数群
function countFlips(state: OthelloState, x: number, y: number, z: number, dx: number, dy: number, dz: number, color: number): number {
    let count = 0;
    let cx = x + dx, cy = y + dy, cz = z + dz;
    while (cx >= 0 && cx < state.size && cy >= 0 && cy < state.size && cz >= 0 && cz < state.size) {
        const target = state.board[cz][cy][cx];
        if (target === 0) return 0;
        if (target === color) return count;
        count++;
        cx += dx; cy += dy; cz += dz;
    }
    return 0;
}

function hasValidMoves(board: number[][][], color: PlayerColor, size: number): boolean {
    for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (board[z][y][x] !== 0) continue;
                const canPlace = DIRECTIONS.some(d => {
                    let count = 0;
                    let cx = x + d.dx, cy = y + d.dy, cz = z + d.dz;
                    while (cx >= 0 && cx < size && cy >= 0 && cy < size && cz >= 0 && cz < size) {
                        const t = board[cz][cy][cx];
                        if (t === 0) break;
                        if (t === color) return count > 0;
                        count++;
                        cx += d.dx; cy += d.dy; cz += d.dz;
                    }
                    return false;
                });
                if (canPlace) return true;
            }
        }
    }
    return false;
}