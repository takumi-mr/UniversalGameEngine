// packages/shared/rules/MancalaRuleset.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from '../GameRules';

export interface MancalaState extends BaseGameState {
    board: number[]; // 長さ14の配列（0~5: P1陣地, 6: P1ストア, 7~12: P2陣地, 13: P2ストア）
    turn: 1 | -1;    // 1: P1(下側), -1: P2(上側)
    scores: Record<number, number>;
}

export interface MancalaAction extends BaseGameAction {
    type: 'SOW';
    pitIndex: number; // 0~5 または 7~12
}

export const MancalaRuleset: GameRuleset<MancalaState, MancalaAction> = {
    getInitialState: (options?: any): MancalaState => {
        // 各ポケットに石を4個ずつ。ストア(6, 13)は0個。
        const board = [
            4, 4, 4, 4, 4, 4, 0,
            4, 4, 4, 4, 4, 4, 0
        ];

        return {
            status: 'WAITING',
            board,
            turn: 1,
            scores: { 1: 0, "-1": 0 },
            players: { 1: null, "-1": null },
            activePlayers: [],
            message: 'Game Started!'
        };
    },

    isValidAction: (state, action) => {
        if (state.status !== 'PLAYING') return false;
        if (action.type !== 'SOW') return false;

        // 手番プレイヤーの検証
        const expectedPlayer = state.players?.[state.turn];
        if (expectedPlayer && action.playerId !== expectedPlayer) return false;

        const { pitIndex } = action;

        // 自分の陣地のポケットかチェック
        const isP1 = state.turn === 1;
        if (isP1 && (pitIndex < 0 || pitIndex > 5)) return false;
        if (!isP1 && (pitIndex < 7 || pitIndex > 12)) return false;

        // 空のポケットからは種まきできない
        if (state.board[pitIndex] === 0) return false;

        return true;
    },

    reduce: (state, action) => {
        const newState = structuredClone(state);
        let { pitIndex } = action;
        const isP1 = newState.turn === 1;

        const ownStore = isP1 ? 6 : 13;
        const oppStore = isP1 ? 13 : 6;

        // 1. 石を手に取る
        let stones = newState.board[pitIndex];
        newState.board[pitIndex] = 0;

        // 2. 種まき（Sowing）
        let currentIndex = pitIndex;
        while (stones > 0) {
            currentIndex = (currentIndex + 1) % 14;

            // 相手のストアには石を落とさない（スキップ）
            if (currentIndex === oppStore) continue;

            newState.board[currentIndex]++;
            stones--;
        }

        // 3. ルール判定：横取り（Capture）
        // 最後の石が「自分の陣地の空のポケット」に落ちた場合、向かい側の石ごと奪う
        const isOwnPit = isP1 ? (currentIndex >= 0 && currentIndex <= 5) : (currentIndex >= 7 && currentIndex <= 12);
        if (isOwnPit && newState.board[currentIndex] === 1) {
            const oppositeIndex = 12 - currentIndex; // 向かいのポケットの計算式
            if (newState.board[oppositeIndex] > 0) {
                // 横取り発生！
                const captured = newState.board[currentIndex] + newState.board[oppositeIndex];
                newState.board[ownStore] += captured;
                newState.board[currentIndex] = 0;
                newState.board[oppositeIndex] = 0;
                newState.message = "Capture! (横取り)";
            } else {
                newState.message = "";
            }
        } else {
            newState.message = "";
        }

        // 4. ルール判定：連続ターン（Extra Turn）
        // 最後の石が自分のストアで終わったら、もう一度自分の番
        let extraTurn = false;
        if (currentIndex === ownStore) {
            extraTurn = true;
            newState.message = "Extra Turn! (もう一回)";
        }

        // 5. 終了判定（どちらかの陣地の石がすべて無くなったか）
        const p1Empty = newState.board.slice(0, 6).every(s => s === 0);
        const p2Empty = newState.board.slice(7, 13).every(s => s === 0);

        if (p1Empty || p2Empty) {
            // 残った石をすべて自分のストアに回収
            for (let i = 0; i <= 5; i++) {
                newState.board[6] += newState.board[i];
                newState.board[i] = 0;
            }
            for (let i = 7; i <= 12; i++) {
                newState.board[13] += newState.board[i];
                newState.board[i] = 0;
            }
            newState.status = 'FINISHED';
        } else if (!extraTurn) {
            // 連続ターンでなければ手番交代
            newState.turn = (newState.turn * -1) as 1 | -1;
        }

        // スコアとアクティブプレイヤーの更新
        newState.scores = { 1: newState.board[6], "-1": newState.board[13] };
        const nextPlayer = newState.players?.[newState.turn];
        newState.activePlayers = nextPlayer && newState.status === 'PLAYING' ? [nextPlayer] : [];

        return newState;
    },

    checkWinCondition: (state) => {
        if (state.status === 'FINISHED') {
            const p1Score = state.board[6];
            const p2Score = state.board[13];
            let msg = "Draw!";
            if (p1Score > p2Score) msg = "Player 1 Wins!";
            if (p2Score > p1Score) msg = "Player 2 Wins!";
            return { isFinished: true, message: `Game Over. ${msg}` };
        }
        return { isFinished: false };
    },

    getLegalActions: (state, playerId) => {
        if (state.status !== 'PLAYING') return [];
        const expectedPlayer = state.players?.[state.turn];
        if (expectedPlayer && playerId !== expectedPlayer) return [];

        const actions: MancalaAction[] = [];
        const startIndex = state.turn === 1 ? 0 : 7;
        const endIndex = state.turn === 1 ? 5 : 12;

        for (let i = startIndex; i <= endIndex; i++) {
            if (state.board[i] > 0) {
                actions.push({ type: 'SOW', pitIndex: i, playerId });
            }
        }
        return actions;
    }
};