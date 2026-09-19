// apps/backend/store/sessionStore.test.ts
// 「真実はストア、メモリはキャッシュ」の契約を検証する。
// 別インスタンスの動作は「ストアを直接書き換える」ことで模す。
import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import {
  sessions,
  repo,
  SocketGameServer,
  createSession,
  ensureSession,
  withSession,
  destroySession,
  onRemoteStateChanged,
} from "@engine/backend/store/sessionStore";
import { setIoInstance } from "@engine/backend/network/io";
import { UniversalEngine, type EngineReplayData } from "@engine/shared/UniversalEngine";
import {
  TicTacToeRuleset,
  type TicTacToeAction,
  type TicTacToeState,
} from "@engine/shared/rules/TicTacToeRuleset";
import { ReplayEngine } from "@engine/shared/ReplayEngine";
import type { BaseGameAction, BaseGameState, GameRecord } from "@engine/shared/GameRules";
import type { Server } from "socket.io";

// このインスタンスに接続しているソケット（テストごとに差し替える）
let localSockets: {
  id: string;
  data: { userId: string };
  emit: (ev: string, p: unknown) => void;
}[] = [];
const mockIo = {
  in: () => ({ fetchSockets: async () => localSockets }),
  local: { in: () => ({ fetchSockets: async () => localSockets }) },
  to: () => ({ emit: () => {} }),
} as unknown as Server;

// ストアはゲーム共通の BaseGameState で保存しているので、テストでは TicTacToe の型に戻して読む
const asTTT = (state: BaseGameState) => state as TicTacToeState;
const asTTTRecord = (record: GameRecord<BaseGameState, BaseGameAction>) =>
  record as GameRecord<TicTacToeState, TicTacToeAction>;

const newTicTacToe = () => {
  const engine = new UniversalEngine(TicTacToeRuleset, {});
  engine.dispatch({ type: "JOIN", playerId: "p1" });
  engine.dispatch({ type: "JOIN", playerId: "p2" });
  engine.dispatch({ type: "START", playerId: "p1" });
  return engine;
};

describe("sessionStore", () => {
  beforeEach(async () => {
    setIoInstance(mockIo);
    sessions.clear();
    localSockets = [];
    for (const { gameId } of await repo.listSessions()) await repo.deleteSession(gameId);
  });

  it("dispatchAction は配信と保存を行い、ストアの状態が進む", async () => {
    const { server } = createSession("g1", newTicTacToe(), "tictactoe");
    await server.commit();
    const before = (await repo.loadSession("g1"))!.state.version!;

    expect(await server.dispatchAction("p1", { type: "PLACE", index: 4 })).toBe(true);
    const saved = (await repo.loadSession("g1"))!;
    expect(saved.state.version).toBe(before + 1);
    expect(asTTT(saved.state).board[4]).toBe(1);
  });

  it("別インスタンスが進めた局面をロック内で読み直してから dispatch する", async () => {
    const { server } = createSession("g2", newTicTacToe(), "tictactoe");
    await server.commit();

    // 別インスタンスが p1 の手を進めた（ストアだけが更新され、このインスタンスのキャッシュは古い）
    const other = new UniversalEngine(TicTacToeRuleset, {});
    other.loadState(asTTT(structuredClone((await repo.loadSession("g2"))!.state)));
    expect(other.dispatch({ type: "PLACE", index: 0, playerId: "p1" })).toBe(true);
    await repo.saveSession("g2", { type: "tictactoe", state: other.getState() });

    // 古いキャッシュのままなら p1 の手番だが、最新では p2 の手番
    expect(await server.dispatchAction("p1", { type: "PLACE", index: 1 })).toBe(false);
    expect(await server.dispatchAction("p2", { type: "PLACE", index: 1 })).toBe(true);
    const saved = asTTT((await repo.loadSession("g2"))!.state);
    expect(saved.board[0]).toBe(1);
    expect(saved.board[1]).toBe(-1);
  });

  it("ensureSession はストアからボット込みで復元する", async () => {
    const { server } = createSession("g3", newTicTacToe(), "tictactoe");
    server.addBot({ playerId: "p2", aiType: "random", name: "R" });
    await server.commit();
    sessions.clear();

    const restored = await ensureSession("g3");
    expect(restored).not.toBeNull();
    expect(restored!.server.bots).toEqual([{ playerId: "p2", aiType: "random", name: "R" }]);
    expect(restored!.server.aiPlayers.has("p2")).toBe(true);
    expect(restored!.server.engine.getState().status).toBe("PLAYING");
  });

  it("別インスタンスで復元した対局でも、終局時のリプレイ記録に開始からの全手が含まれる", async () => {
    const { server } = createSession("g3r", newTicTacToe(), "tictactoe");
    await server.commit();
    const original = server.engine.getGameRecord("g3r");
    expect(original.actions.length).toBe(3); // JOIN, JOIN, START
    sessions.clear();

    // 別インスタンスで復元し、そこで終局まで進める
    const restored = (await ensureSession("g3r"))!;
    const moves: [string, number][] = [
      ["p1", 0],
      ["p2", 3],
      ["p1", 1],
      ["p2", 4],
      ["p1", 2],
    ];
    for (const [player, index] of moves) {
      expect(await restored.server.dispatchAction(player, { type: "PLACE", index })).toBe(true);
    }
    expect(restored.server.engine.getState().status).toBe("FINISHED");

    // 完全な記録はリポジトリ側（エンジンの getGameRecord ではなく loadGameRecord）
    const record = (await repo.loadGameRecord("g3r"))!;
    expect(record.initialState).toEqual(original.initialState);
    expect(record.finalServerSeed).toBeDefined();
    expect(record.actions.map((a) => a.type)).toEqual([
      "JOIN",
      "JOIN",
      "START",
      "PLACE",
      "PLACE",
      "PLACE",
      "PLACE",
      "PLACE",
    ]);
    expect(record.stateHashes?.length).toBe(record.actions.length + 1);
    // 記録から初期状態→終局までを再生・検証できる
    expect(
      new ReplayEngine(TicTacToeRuleset, asTTTRecord(record)).verify(asTTTRecord(record)),
    ).toBe(true);
  });

  it("ensureSession は存在しないゲームには null を返す", async () => {
    expect(await ensureSession("missing")).toBeNull();
  });

  it("withSession は同じゲームへの同時アクセスを直列化する", async () => {
    const { server } = createSession("g4", newTicTacToe(), "tictactoe");
    await server.commit();

    const order: string[] = [];
    const first = withSession("g4", async () => {
      order.push("first-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("first-end");
    });
    const second = withSession("g4", async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("onRemoteStateChanged は接続中のソケットがあれば最新状態を配信し、無ければキャッシュを捨てる", async () => {
    const { server } = createSession("g5", newTicTacToe(), "tictactoe");
    await server.commit();

    // 別インスタンスが 1 手進めた
    const other = new UniversalEngine(TicTacToeRuleset, {});
    other.loadState(asTTT(structuredClone((await repo.loadSession("g5"))!.state)));
    other.dispatch({ type: "PLACE", index: 8, playerId: "p1" });
    await repo.saveSession("g5", { type: "tictactoe", state: other.getState() });

    // 誰も居ない → キャッシュを捨てる
    await onRemoteStateChanged("g5");
    expect(sessions.has("g5")).toBe(false);

    // ソケットが居る → 復元して配信する
    const received: unknown[] = [];
    localSockets = [{ id: "s1", data: { userId: "p1" }, emit: (_ev, p) => received.push(p) }];
    await onRemoteStateChanged("g5");
    await new Promise((r) => setTimeout(r, 0)); // fetchSockets の then を待つ
    expect(asTTT(sessions.get("g5")!.server.engine.getState()).board[8]).toBe(1);
    expect((received.at(-1) as TicTacToeState | undefined)?.board?.[8]).toBe(1);
  });

  it("destroySession はストアとキャッシュの両方から消す", async () => {
    const { server } = createSession("g6", newTicTacToe(), "tictactoe");
    await server.commit();
    await destroySession("g6");
    expect(sessions.has("g6")).toBe(false);
    expect(await repo.loadSession("g6")).toBeNull();
    expect(await repo.listSessions()).toEqual([]);
  });

  it("commit は保存を待たずにローカルのクライアントへ配信し、保存はロック内で完了する", async () => {
    const { server } = createSession("g7", newTicTacToe(), "tictactoe");
    await server.commit();

    const order: string[] = [];
    localSockets = [
      {
        id: "s1",
        data: { userId: "p1" },
        emit: (ev) => ev === "state-update" && order.push("emit"),
      },
    ];
    // 保存を遅くして、配信がそれを待っていないことを確かめる
    const original = repo.saveSession.bind(repo);
    const spy = spyOn(repo, "saveSession").mockImplementation(async (...args) => {
      await new Promise((r) => setTimeout(r, 20));
      await original(...args);
      order.push("save-done");
    });
    try {
      await server.dispatchAction("p1", { type: "PLACE", index: 4 });
    } finally {
      spy.mockRestore();
    }
    expect(order).toEqual(["emit", "save-done"]);
    // dispatchAction が返った（＝ロックを離した）時点で保存は済んでいる
    expect(asTTT((await repo.loadSession("g7"))!.state).board[4]).toBe(1);
  });

  it("broadcastLocal は targetId ごとに 1 回だけマスクし、同じ基準バージョンの差分を共有する", async () => {
    const { server } = createSession("g8", newTicTacToe(), "tictactoe");
    interface PatchPayload {
      baseVersion: number;
      targetVersion: number;
      hash: string;
      patch: unknown[];
    }
    const received = new Map<string, { ev: string; p: PatchPayload }[]>();
    const sock = (id: string, userId: string) => ({
      id,
      data: { userId },
      emit: (ev: string, p: unknown) => {
        if (ev === "state-update" || ev === "state-patch")
          received.set(id, [...(received.get(id) ?? []), { ev, p: p as PatchPayload }]);
      },
    });
    // p1 が 2 接続、観戦者が 3 接続
    localSockets = [
      sock("a", "p1"),
      sock("b", "p1"),
      sock("c", "x"),
      sock("d", "y"),
      sock("e", "z"),
    ];

    const maskSpy = spyOn(server.engine, "getMaskedState");
    await server.commit();
    await new Promise((r) => setTimeout(r, 0));
    // 初回はフル送信。マスクは p1 と SPECTATOR の 2 回だけ
    expect(maskSpy).toHaveBeenCalledTimes(2);
    expect(new Set(maskSpy.mock.calls.map((c) => c[0]))).toEqual(new Set(["p1", "SPECTATOR"]));
    for (const id of ["a", "b", "c", "d", "e"])
      expect(received.get(id)![0].ev).toBe("state-update");

    maskSpy.mockClear();
    await server.dispatchAction("p1", { type: "PLACE", index: 4 });
    await new Promise((r) => setTimeout(r, 0));

    // 2 手目はパッチ送信。マスクは targetId ごとに 1 回
    expect(maskSpy).toHaveBeenCalledTimes(2);
    maskSpy.mockRestore();
    const patches = ["a", "b", "c", "d", "e"].map((id) => received.get(id)![1]);
    for (const { ev, p } of patches) {
      expect(ev).toBe("state-patch");
      expect(p.baseVersion + 1).toBe(p.targetVersion);
    }
    // 観戦者同士は同じパッチオブジェクト（差分計算は基準バージョンごとに 1 回）、
    // プレイヤーと観戦者でハッシュは同じ（TicTacToe は隠匿情報なし）
    expect(patches[2].p.patch).toBe(patches[3].p.patch);
    expect(patches[0].p.patch).toBe(patches[1].p.patch);
    expect(patches[0].p.hash).toBe(patches[2].p.hash);
  });

  it("dispatchAction の配信には適用したアクションが同梱され、JOIN/START の commit や再同期には付かない", async () => {
    const { server } = createSession("g8b", newTicTacToe(), "tictactoe");
    // state-update は (state, meta)、state-patch は payload.action で受け取る
    const received: { ev: string; action?: BaseGameAction }[] = [];
    localSockets = [
      {
        id: "s1",
        data: { userId: "p1" },
        emit: (ev: string, p: unknown, meta?: unknown) => {
          if (ev === "state-update")
            received.push({
              ev,
              action: (meta as { action?: BaseGameAction } | undefined)?.action,
            });
          if (ev === "state-patch")
            received.push({ ev, action: (p as { action?: BaseGameAction }).action });
        },
      },
    ];
    const flush = () => new Promise((r) => setTimeout(r, 0));

    await server.commit(); // JOIN / START のみ: アクションは付かない
    await flush();
    expect(received.at(-1)).toEqual({ ev: "state-update", action: undefined });

    await server.dispatchAction("p1", { type: "PLACE", index: 4 });
    await flush();
    expect(received.at(-1)!.ev).toBe("state-patch");
    expect(received.at(-1)!.action).toMatchObject({ type: "PLACE", index: 4, playerId: "p1" });

    // 再同期（特定ソケットへのフル送信）にはアクションを付けない
    server.broadcastLocal("s1", { type: "PLACE", playerId: "p2" });
    await flush();
    expect(received.at(-1)).toEqual({ ev: "state-update", action: undefined });

    // 別インスタンスから届いたアクションも配信に同梱する
    const other = new UniversalEngine(TicTacToeRuleset, {});
    other.loadState(asTTT(structuredClone((await repo.loadSession("g8b"))!.state)));
    const remoteAction: TicTacToeAction = { type: "PLACE", index: 8, playerId: "p2" };
    other.dispatch(remoteAction);
    await repo.saveSession("g8b", { type: "tictactoe", state: other.getState() });
    await onRemoteStateChanged("g8b", remoteAction);
    await flush();
    expect(received.at(-1)!.action).toMatchObject(remoteAction);
  });

  it("履歴が replayFlushSize に達したら記録へ追記して切り詰め、完全なリプレイは記録側に残る", async () => {
    const prev = SocketGameServer.replayFlushSize;
    SocketGameServer.replayFlushSize = 4;
    try {
      const { server } = createSession("g9", newTicTacToe(), "tictactoe");
      await server.commit(); // JOIN, JOIN, START の 3 手: まだ切り詰めない
      expect(server.engine.history.length).toBe(3);
      expect(await repo.loadGameRecord("g9")).toBeNull();

      await server.dispatchAction("p1", { type: "PLACE", index: 0 }); // 4 手 → 追記して切り詰め
      expect(server.engine.history.length).toBe(0);
      expect((await repo.loadGameRecord("g9"))!.actions.length).toBe(4);
      // Redis 相当のセッション記録も切り詰め後の履歴だけを持つ
      expect((await repo.loadSession("g9"))!.replay!.history.length).toBe(0);
      expect((await repo.loadSession("g9"))!.replay!.snapshotVersion).toBe(4);

      // 別インスタンスで復元して終局まで
      sessions.clear();
      const restored = (await ensureSession("g9"))!;
      for (const [player, index] of [
        ["p2", 3],
        ["p1", 1],
        ["p2", 4],
        ["p1", 2],
      ] as [string, number][]) {
        expect(await restored.server.dispatchAction(player, { type: "PLACE", index })).toBe(true);
      }
      expect(restored.server.engine.getState().status).toBe("FINISHED");

      const record = (await repo.loadGameRecord("g9"))!;
      expect(record.actions.length).toBe(8);
      expect(record.stateHashes?.length).toBe(9);
      expect(record.snapshotState).toBeUndefined();
      expect(
        new ReplayEngine(TicTacToeRuleset, asTTTRecord(record)).verify(asTTTRecord(record)),
      ).toBe(true);
    } finally {
      SocketGameServer.replayFlushSize = prev;
    }
  });

  it("追記に失敗しても対局は進み、履歴は切り詰めずに次回まとめて追記される（重複しない）", async () => {
    const prev = SocketGameServer.replayFlushSize;
    SocketGameServer.replayFlushSize = 2;
    try {
      const { server } = createSession("g10", newTicTacToe(), "tictactoe");
      const spy = spyOn(repo, "appendGameRecord").mockRejectedValueOnce(new Error("mongo down"));
      await server.commit(); // 3 手 ≥ 2 だが追記失敗 → 切り詰めない
      spy.mockRestore();
      expect(server.engine.history.length).toBe(3);
      expect(await repo.loadGameRecord("g10")).toBeNull();

      // 4 手目で追記・切り詰めされる。その直前のセッション記録（未切り詰めの履歴）を取っておく
      const staleSession = (await repo.loadSession("g10"))!;
      await server.dispatchAction("p1", { type: "PLACE", index: 0 });
      expect((await repo.loadGameRecord("g10"))!.actions.length).toBe(4);
      expect(server.engine.history.length).toBe(0);

      // 別インスタンスが（切り詰め前の履歴を持つ）古い記録から復元し、同じ 4 手目を打って進めたとしても
      // 記録側は version で重複排除される
      const staleEngine = new UniversalEngine(TicTacToeRuleset, {});
      staleEngine.loadState(
        asTTT(staleSession.state),
        staleSession.replay as EngineReplayData<TicTacToeState, TicTacToeAction> | undefined,
      );
      staleEngine.dispatch({ type: "PLACE", index: 0, playerId: "p1" });
      await repo.saveSession("g10", {
        type: "tictactoe",
        state: staleEngine.getState(),
        replay: staleEngine.getReplayData(),
      });
      sessions.clear();
      const restored = (await ensureSession("g10"))!;
      expect(restored.server.engine.history.length).toBe(4);
      await restored.server.dispatchAction("p2", { type: "PLACE", index: 3 });
      const record = (await repo.loadGameRecord("g10"))!;
      expect(record.actions.map((a) => a.type)).toEqual([
        "JOIN",
        "JOIN",
        "START",
        "PLACE",
        "PLACE",
      ]);
      expect(record.stateHashes?.length).toBe(6);
      expect(
        new ReplayEngine(TicTacToeRuleset, asTTTRecord(record)).verify(asTTTRecord(record)),
      ).toBe(true);
    } finally {
      SocketGameServer.replayFlushSize = prev;
    }
  });
});
