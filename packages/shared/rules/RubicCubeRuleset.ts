// packages/shared/rules/RubiksRuleset.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from '../GameRules';

export type FaceName = 'U' | 'D' | 'F' | 'B' | 'L' | 'R'; // Up, Down, Front, Back, Left, Right
export type Color = 'W' | 'Y' | 'G' | 'B' | 'O' | 'R'; // White, Yellow, Green, Blue, Orange, Red

export interface RubiksState extends BaseGameState {
    faces: Record<FaceName, Color[][]>;
    moveCount: number;
}

export type RubiksAction = 
    | { type: 'ROTATE'; face: FaceName; direction: 1 | -1; playerId?: string }
    | { type: 'RESET'; playerId?: string };

// 初期状態の生成（揃った状態）
const createSolvedFaces = (): Record<FaceName, Color[][]> => {
    const defaultColors: Record<FaceName, Color> = {
        U: 'W', D: 'Y', F: 'G', B: 'B', L: 'O', R: 'R'
    };
    const faces = {} as Record<FaceName, Color[][]>;
    for (const [f, color] of Object.entries(defaultColors)) {
        faces[f as FaceName] = Array.from({ length: 3 }, () => Array(3).fill(color));
    }
    return faces;
};

// --- 数学・行列計算のコアヘルパー ---

// 1. 指定した3x3の面（行列）自体を回転する関数
function rotateMatrix(matrix: Color[][], dir: 1 | -1): Color[][] {
    const N = matrix.length;
    const res: Color[][] = Array.from({ length: N }, () => Array(N).fill(''));
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            if (dir === 1) {
                // 時計回り: 元の (r, c) は 新しい (c, N-1-r) へ移動
                res[c][N - 1 - r] = matrix[r][c];
            } else {
                // 反時計回り: 元の (r, c) は 新しい (N-1-c, r) へ移動
                res[N - 1 - c][r] = matrix[r][c];
            }
        }
    }
    return res;
}

// 2. 面が回転した際、隣接する4つの辺（リング）を抽出・更新するための定義
// ※展開図のトポロジーを定義します。各面から見て「時計回り」に隣接する面の [行or列, インデックス, 逆順か] を定義。
type EdgeDef = { face: FaceName; type: 'row' | 'col'; index: number; reverse: boolean };

const ADJACENCY_MAP: Record<FaceName, EdgeDef[]> = {
    // F(Front)を時計回りに回すと、Uの「下」、Rの「左」、Dの「上」、Lの「右」が影響を受ける
    // D(Down), B(Back), L(Left), R(Right) も含めた完全な定義
    F: [
        { face: 'U', type: 'row', index: 2, reverse: false },
        { face: 'R', type: 'col', index: 0, reverse: false },
        { face: 'D', type: 'row', index: 0, reverse: true },
        { face: 'L', type: 'col', index: 2, reverse: true }
    ],
    U: [
        { face: 'B', type: 'row', index: 0, reverse: true },
        { face: 'R', type: 'row', index: 0, reverse: false },
        { face: 'F', type: 'row', index: 0, reverse: false },
        { face: 'L', type: 'row', index: 0, reverse: false }
    ],
    D: [
        { face: 'F', type: 'row', index: 2, reverse: false },
        { face: 'R', type: 'row', index: 2, reverse: false },
        { face: 'B', type: 'row', index: 2, reverse: true },
        { face: 'L', type: 'row', index: 2, reverse: false }
    ],
    B: [
        { face: 'U', type: 'row', index: 0, reverse: true },
        { face: 'L', type: 'col', index: 0, reverse: false },
        { face: 'D', type: 'row', index: 2, reverse: false },
        { face: 'R', type: 'col', index: 2, reverse: true }
    ],
    L: [
        { face: 'U', type: 'col', index: 0, reverse: false },
        { face: 'F', type: 'col', index: 0, reverse: false },
        { face: 'D', type: 'col', index: 0, reverse: false },
        { face: 'B', type: 'col', index: 2, reverse: true }
    ],
    R: [
        { face: 'U', type: 'col', index: 2, reverse: true },
        { face: 'B', type: 'col', index: 0, reverse: false },
        { face: 'D', type: 'col', index: 2, reverse: true },
        { face: 'F', type: 'col', index: 2, reverse: false }
    ],
};

// 辺の抽出関数
function getEdge(state: RubiksState, def: EdgeDef): Color[] {
    const faceMatrix = state.faces[def.face];
    let edge: Color[] = [];
    if (def.type === 'row') edge = [...faceMatrix[def.index]];
    if (def.type === 'col') edge = faceMatrix.map(row => row[def.index]);
    return def.reverse ? edge.reverse() : edge;
}

// 辺の書き戻し関数
function setEdge(state: RubiksState, def: EdgeDef, colors: Color[]) {
    const faceMatrix = state.faces[def.face];
    const toWrite = def.reverse ? [...colors].reverse() : colors;

    if (def.type === 'row') {
        faceMatrix[def.index] = [...toWrite];
    } else {
        for (let i = 0; i < 3; i++) {
            faceMatrix[i][def.index] = toWrite[i];
        }
    }
}

export const RubiksRuleset: GameRuleset<RubiksState, RubiksAction> = {
    getInitialState: (): RubiksState => ({
        status: 'PLAYING',
        faces: createSolvedFaces(),
        moveCount: 0,
        players: { '1': null }
    }),

    isValidAction: (state, action) => {
        if (action.type === 'RESET') return true; // RESETはいつでも可能
        
        if (state.status !== 'PLAYING') return false;
        if (action.type !== 'ROTATE') return false;
        if (!['U', 'D', 'F', 'B', 'L', 'R'].includes(action.face)) return false;
        if (action.direction !== 1 && action.direction !== -1) return false;
        return true;
    },

    reduce: (state, action) => {
        if (action.type === 'RESET') {
            return {
                ...RubiksRuleset.getInitialState(),
                players: state.players // プレイヤー割り当ては引き継ぐ
            };
        }

        // 1. ディープコピーして不変性を維持
        const newState = structuredClone(state);

        // 2. 指定された面（3x3の行列）自体の回転
        newState.faces[action.face] = rotateMatrix(newState.faces[action.face], action.direction);

        // 3. 隣接する4つの辺（リング）の巡回置換（シフト）
        const edgesDef = ADJACENCY_MAP[action.face];
        if (edgesDef && edgesDef.length === 4) {
            // 現在の辺の配列を抽出 [Edge0, Edge1, Edge2, Edge3]
            const currentEdges = edgesDef.map(def => getEdge(state, def));

            // 時計回りなら配列を右にシフト、反時計なら左にシフト
            for (let i = 0; i < 4; i++) {
                const targetDef = edgesDef[i];
                let sourceIndex = action.direction === 1
                    ? (i + 3) % 4 // CW: 3->0, 0->1, 1->2, 2->3
                    : (i + 1) % 4; // CCW: 1->0, 2->1, 3->2, 0->3

                setEdge(newState, targetDef, currentEdges[sourceIndex]);
            }
        }

        newState.moveCount++;
        return newState;
    },

    checkWinCondition: (state) => {
        // すべての面が「単一の色」で構成されているかをチェック
        const isSolved = Object.values(state.faces).every(matrix => {
            const firstColor = matrix[0][0];
            return matrix.every(row => row.every(cell => cell === firstColor));
        });

        if (isSolved && state.moveCount > 0) {
            const winnerId = state.players?.['1'] || Object.values(state.players || {})[0];
            return {
                isFinished: true,
                winnerIds: winnerId ? [winnerId] : [],
                message: `Cube Solved in ${state.moveCount} moves!`
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

    getLegalActions: (state: RubiksState, playerId: string): RubiksAction[] => {
        if (state.status !== 'PLAYING') return [];
        const actions: RubiksAction[] = [];
        const faces: FaceName[] = ['U', 'D', 'F', 'B', 'L', 'R'];
        const dirs: (1 | -1)[] = [1, -1];

        for (const face of faces) {
            for (const direction of dirs) {
                const action: RubiksAction = { type: 'ROTATE', face, direction, playerId };
                if (RubiksRuleset.isValidAction(state, action)) {
                    actions.push(action);
                }
            }
        }
        return actions;
    }
};