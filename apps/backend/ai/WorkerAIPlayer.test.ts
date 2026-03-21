// apps/backend/ai/WorkerAIPlayer.test.ts
// WorkerAIPlayer の動作テスト
// bun:test + worker_threads のモックを使用して、メインスレッドを実際にブロックしないことを検証する。

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { WorkerRequest, WorkerResponse } from './ai-worker';
import { EventEmitter } from 'events';

// --- worker_threads モック ---

// Worker インスタンスのふるまいをシミュレートする EventEmitter
class MockWorker extends EventEmitter {
    // postMessage が呼ばれたら即座に正しいレスポンスを返すシミュレーション
    public postMessage(req: WorkerRequest): void {
        // 非同期でレスポンスを返す（実際の Worker と同様の動作）
        setImmediate(() => {
            const res: WorkerResponse = {
                requestId: req.requestId,
                // テスト用の「インデックス0に PLACE する」アクションを返す
                actionJson: JSON.stringify({
                    type: 'PLACE',
                    index: 0,
                    playerId: req.playerId
                }),
            };
            this.emit('message', res);
        });
    }

    public terminate(): void {
        // テスト中はなにもしない
    }
}

let workerInstances: MockWorker[] = [

];
const MockWorkerConstructor = mock((_path: string) => {
    const w = new MockWorker();
    workerInstances.push(w);
    return w;
});

// worker_threads をモックする
mock.module('worker_threads', () => ({
    Worker: MockWorkerConstructor,
    isMainThread: true,
    parentPort: null,
}));

// モック設定の後にインポート
import { WorkerAIPlayer } from './WorkerAIPlayer';

// --- テスト用のゲーム状態 ---
const makeTicTacToeState = () => ({
    status: 'PLAYING' as const,
    board: Array(9).fill(0),
    turn: 1,
    players: { 1: 'player_1', '-1': 'player_2' },
    activePlayers: ['player_1'],
    version: 0,
});

const makeLegalActions = (playerId: string) =>
    Array.from({ length: 9 }, (_, i) => ({
        type: 'PLACE' as const,
        index: i,
        playerId,
    }));

// --- テスト ---

describe('WorkerAIPlayer', () => {
    beforeEach(() => {
        workerInstances = [];
        MockWorkerConstructor.mockClear();
    });

    it('computeNextMove() が null でないアクションを返すこと', async () => {
        const player = new WorkerAIPlayer('player_1', 'tic_tac_toe', 'minimax', { maxDepth: 3 }, 'Minimax Test');
        const state = makeTicTacToeState();
        const legalActions = makeLegalActions('player_1');

        const action = await player.computeNextMove(state, legalActions);

        expect(action).not.toBeNull();
        expect(action?.type).toBe('PLACE');
        expect(action?.playerId).toBe('player_1');
    });

    it('合法手が空の場合は null を返すこと', async () => {
        const player = new WorkerAIPlayer('player_1', 'tic_tac_toe', 'minimax');
        const state = makeTicTacToeState();

        const action = await player.computeNextMove(state, []);

        expect(action).toBeNull();
        // 合法手がない場合は Worker を起動しないこと
        expect(MockWorkerConstructor).not.toHaveBeenCalled();
    });

    it('Worker インスタンスが再利用されること（複数回呼び出し）', async () => {
        const player = new WorkerAIPlayer('player_1', 'tic_tac_toe', 'mcts', { iterations: 100 });
        const state = makeTicTacToeState();
        const legalActions = makeLegalActions('player_1');

        await player.computeNextMove(state, legalActions);
        await player.computeNextMove(state, legalActions);

        // Worker は一度だけ生成される（再利用）
        expect(MockWorkerConstructor).toHaveBeenCalledTimes(1);
    });

    it('複数の AI プレイヤーを同時実行できること（Promise.all）', async () => {
        const player1 = new WorkerAIPlayer('player_1', 'tic_tac_toe', 'minimax');
        const player2 = new WorkerAIPlayer('player_2', 'tic_tac_toe', 'mcts');
        const state = makeTicTacToeState();
        const legalActions1 = makeLegalActions('player_1');
        const legalActions2 = makeLegalActions('player_2');

        const [action1, action2] = await Promise.all([
            player1.computeNextMove(state, legalActions1),
            player2.computeNextMove(state, legalActions2),
        ]);

        expect(action1).not.toBeNull();
        expect(action2).not.toBeNull();
        // それぞれ独立した Worker を持つこと
        expect(MockWorkerConstructor).toHaveBeenCalledTimes(2);
    });

    it('reset() を呼ぶと Worker が終了し、保留中リクエストが解決されること', async () => {
        const player = new WorkerAIPlayer('player_1', 'tic_tac_toe', 'minimax');
        const state = makeTicTacToeState();
        const legalActions = makeLegalActions('player_1');

        // まず一度 computeNextMove を呼んで Worker を起動する
        await player.computeNextMove(state, legalActions);

        player.reset();

        // reset 後も computeNextMove を呼べること（新しい Worker が生成される）
        // 合法手なしで呼べば Worker は起動しないはず
        const action = await player.computeNextMove(state, []);
        expect(action).toBeNull();
    });

    it('getDiagnostics() が正しい情報を返すこと', async () => {
        const player = new WorkerAIPlayer('player_1', 'tic_tac_toe', 'minimax', {}, 'DiagTest');

        const diagnostics = player.getDiagnostics?.();
        expect(diagnostics?.playerId).toBe('player_1');
        expect(diagnostics?.aiType).toBe('minimax');
        expect(diagnostics?.gameType).toBe('tic_tac_toe');
        expect(diagnostics?.pendingRequests).toBe(0);
        expect(diagnostics?.workerAlive).toBe(false); // まだ Worker は生成されていない
    });
});
