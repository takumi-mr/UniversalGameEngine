// packages/shared/ai/RandomPlayer.test.ts
import { describe, it, expect, spyOn } from "bun:test";
import { RandomPlayer } from "./RandomPlayer";

type DummyState = {
    status: 'WAITING' | 'PLAYING' | 'FINISHED';
    board: number[]
};
type DummyAction = {
    type: string;
    position?: number;
    playerId?: string
};

describe("RandomPlayer", () => {
    describe("コンストラクタ", () => {
        it("デフォルト引数が正しく設定されること", () => {
            const player = new RandomPlayer<DummyState, DummyAction>("player-1");

            expect(player.playerId).toBe("player-1");
            expect(player.name).toBe("RandomBot");
        });

        it("指定した引数が正しく設定されること", () => {
            const player = new RandomPlayer<DummyState, DummyAction>("player-1", "CustomBot", 100);

            expect(player.playerId).toBe("player-1");
            expect(player.name).toBe("CustomBot");
        });
    });

    describe("computeNextMove", () => {
        it("合法手がない(空配列)場合は null を返すこと", async () => {
            const player = new RandomPlayer<DummyState, DummyAction>("bot-1", "Bot", 0);
            // 修正箇所：status を追加
            const state: DummyState = { status: 'PLAYING', board: [] };

            const result = await player.computeNextMove(state, []);
            expect(result).toBeNull();
        });

        it("合法手がない(undefined/null)場合は null を返すこと", async () => {
            const player = new RandomPlayer<DummyState, DummyAction>("bot-1", "Bot", 0);
            // 修正箇所：status を追加
            const state: DummyState = { status: 'PLAYING', board: [] };

            // @ts-expect-error テストのために意図的に不正な値を渡す
            const result = await player.computeNextMove(state, null);
            expect(result).toBeNull();
        });

        it("合法手の中からランダムに手を選び、自身の playerId を付与して返すこと", async () => {
            const player = new RandomPlayer<DummyState, DummyAction>("bot-1", "Bot", 0);
            // 修正箇所：status を追加
            const state: DummyState = { status: 'PLAYING', board: [] };
            const actions: DummyAction[] = [
                { type: "MOVE", position: 1 },
                { type: "MOVE", position: 2 },
                { type: "MOVE", position: 3 },
            ];

            const randomSpy = spyOn(Math, "random").mockReturnValue(0.99);

            const result = await player.computeNextMove(state, actions);

            expect(randomSpy).toHaveBeenCalled();
            expect(result).toEqual({
                type: "MOVE",
                position: 3,
                playerId: "bot-1",
            });

            randomSpy.mockRestore();
        });

        it("Math.randomが0を返した時、配列の最初の要素を選ぶこと", async () => {
            const player = new RandomPlayer<DummyState, DummyAction>("bot-1", "Bot", 0);
            const actions: DummyAction[] = [{ type: "A" }, { type: "B" }];

            const randomSpy = spyOn(Math, "random").mockReturnValue(0);
            // 修正箇所：status を追加
            const result = await player.computeNextMove({ status: 'PLAYING', board: [] }, actions);

            expect(result?.type).toBe("A");
            randomSpy.mockRestore();
        });

        it("指定された thinkDelayMs の時間だけ待機すること", async () => {
            const delayMs = 50;
            const player = new RandomPlayer<DummyState, DummyAction>("bot-1", "Bot", delayMs);
            const actions: DummyAction[] = [{ type: "MOVE" }];

            const startTime = performance.now();
            // 修正箇所：status を追加
            await player.computeNextMove({ status: 'PLAYING', board: [] }, actions);
            const endTime = performance.now();

            const elapsed = endTime - startTime;

            expect(elapsed).toBeGreaterThanOrEqual(delayMs - 5);
        });
    });
});