import { BaseGameState, BaseGameAction, GameRuleset } from '../UniversalEngine';

// --- 1. 型定義 ---

export interface SudokuCell {
    value: number;    // 0 = 空白, 1~9 = 入力済み
    isFixed: boolean; // true = 問題の初期数字（変更不可）
}

export interface SudokuState extends BaseGameState {
    board: SudokuCell[][]; // 9x9の盤面
}

export interface SudokuAction extends BaseGameAction {
    type: 'PLACE_NUMBER';
    row: number;   // 0-8
    col: number;   // 0-8
    value: number; // 0（消去）または 1-9
}

// --- 2. ルールセットの実装 ---

export class SudokuRuleset implements GameRuleset<SudokuState, SudokuAction> {

    // ゲームの初期状態を生成
    getInitialState(options?: { initialBoard?: number[][] }): SudokuState {
        // デフォルトは空の盤面。実運用時は options から問題データを渡す
        const defaultBoard = Array(9).fill(0).map(() => Array(9).fill(0));
        const initData = options?.initialBoard || defaultBoard;

        const board: SudokuCell[][] = initData.map(row =>
            row.map(val => ({
                value: val,
                isFixed: val !== 0 // 初期値が0以外なら固定マスにする
            }))
        );

        return {
            status: 'PLAYING',
            players: { "1": "player1" }, // 一人用なので固定
            activePlayers: ["player1"],
            board
        };
    }

    // アクションが合法手かどうかを判定
    isValidAction(state: SudokuState, action: SudokuAction): boolean {
        if (action.type !== 'PLACE_NUMBER') return false;

        const { row, col, value } = action;

        // 範囲チェック
        if (row < 0 || row > 8 || col < 0 || col > 8) return false;
        if (value < 0 || value > 9) return false;

        // 固定マスの上書きは不可
        if (state.board[row][col].isFixed) return false;

        // 0（消去）は常に合法
        if (value === 0) return true;

        // 重複チェック（行、列、3x3ブロック）
        return this.isValidPlacement(state.board, row, col, value);
    }

    // 新しい状態を生成 (Reducer)
    reduce(state: SudokuState, action: SudokuAction): SudokuState {
        // 状態をイミュータブルに保つため、盤面をディープコピー
        const newBoard = state.board.map(row => row.map(cell => ({ ...cell })));

        // アクションを適用
        newBoard[action.row][action.col].value = action.value;

        return {
            ...state,
            board: newBoard
        };
    }

    // ゲーム終了（クリア）判定
    checkWinCondition(state: SudokuState): { isFinished: boolean; message?: string } {
        // 全てのマスが埋まっているか確認
        // (isValidActionで重複を防いでいるため、全て埋まっていれば自動的に正解となる)
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                if (state.board[row][col].value === 0) {
                    return { isFinished: false }; // まだ空きがある
                }
            }
        }

        return { isFinished: true, message: 'Sudoku Cleared!' };
    }

    // AIやヒント機能のための合法手一覧取得
    getLegalActions(state: SudokuState, playerId: string): SudokuAction[] {
        const actions: SudokuAction[] = [];

        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                if (state.board[row][col].isFixed) continue;

                // 1~9の数字で配置可能なものを探索
                for (let val = 1; val <= 9; val++) {
                    if (this.isValidPlacement(state.board, row, col, val)) {
                        actions.push({
                            type: 'PLACE_NUMBER',
                            playerId,
                            row,
                            col,
                            value: val
                        });
                    }
                }

                // 消去アクション(0)も合法手として含める場合
                if (state.board[row][col].value !== 0) {
                    actions.push({ type: 'PLACE_NUMBER', playerId, row, col, value: 0 });
                }
            }
        }

        return actions;
    }

    // --- プライベートヘルパーメソッド ---

    // 特定のマスにその数字を置けるか（数独のルールを満たすか）を検証する
    private isValidPlacement(board: SudokuCell[][], row: number, col: number, value: number): boolean {
        // 行と列のチェック
        for (let i = 0; i < 9; i++) {
            if (i !== col && board[row][i].value === value) return false;
            if (i !== row && board[i][col].value === value) return false;
        }

        // 3x3ブロックのチェック
        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        for (let r = startRow; r < startRow + 3; r++) {
            for (let c = startCol; c < startCol + 3; c++) {
                if ((r !== row || c !== col) && board[r][c].value === value) return false;
            }
        }

        return true;
    }
}