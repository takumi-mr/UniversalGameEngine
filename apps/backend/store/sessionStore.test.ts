// apps/backend/store/sessionStore.test.ts
// 「真実はストア、メモリはキャッシュ」の契約を検証する。
// 別インスタンスの動作は「ストアを直接書き換える」ことで模す。
import { describe, it, expect, beforeEach } from "bun:test";
import {
  sessions,
  repo,
  createSession,
  ensureSession,
  withSession,
  destroySession,
  onRemoteStateChanged,
} from "./sessionStore";
import { setIoInstance } from "../network/io";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { TicTacToeRuleset } from "@engine/shared/rules/TicTacToeRuleset";

// このインスタンスに接続しているソケット（テストごとに差し替える）
let localSockets: { id: string; data: { userId: string }; emit: (ev: string, p: any) => void }[] =
  [];
const mockIo = {
  in: () => ({ fetchSockets: async () => localSockets }),
  local: { in: () => ({ fetchSockets: async () => localSockets }) },
  to: () => ({ emit: () => {} }),
} as any;

const newTicTacToe = () => {
  const engine = new UniversalEngine(TicTacToeRuleset, {});
  engine.dispatch({ type: "JOIN", playerId: "p1" } as any);
  engine.dispatch({ type: "JOIN", playerId: "p2" } as any);
  engine.dispatch({ type: "START", playerId: "p1" } as any);
  return engine;
};

describe("sessionStore", () => {
  beforeEach(async () => {
    setIoInstance(mockIo);
    sessions.clear();
    localSockets = [];
    for (const { gameId } of await repo.listSessions()) await repo.deleteSession(gameId);
  });

  it("dispatchAction は保存してから配信し、ストアの状態が進む", async () => {
    const { server } = createSession("g1", newTicTacToe(), "tictactoe");
    await server.commit();
    const before = (await repo.loadSession("g1"))!.state.version;

    expect(await server.dispatchAction("p1", { type: "PLACE", index: 4 })).toBe(true);
    const saved = (await repo.loadSession("g1"))!;
    expect(saved.state.version).toBe(before + 1);
    expect(saved.state.board[4]).toBe(1);
  });

  it("別インスタンスが進めた局面をロック内で読み直してから dispatch する", async () => {
    const { server } = createSession("g2", newTicTacToe(), "tictactoe");
    await server.commit();

    // 別インスタンスが p1 の手を進めた（ストアだけが更新され、このインスタンスのキャッシュは古い）
    const other = new UniversalEngine(TicTacToeRuleset, {});
    other.loadState(structuredClone((await repo.loadSession("g2"))!.state));
    expect(other.dispatch({ type: "PLACE", index: 0, playerId: "p1" } as any)).toBe(true);
    await repo.saveSession("g2", { type: "tictactoe", state: other.getState() });

    // 古いキャッシュのままなら p1 の手番だが、最新では p2 の手番
    expect(await server.dispatchAction("p1", { type: "PLACE", index: 1 })).toBe(false);
    expect(await server.dispatchAction("p2", { type: "PLACE", index: 1 })).toBe(true);
    const saved = (await repo.loadSession("g2"))!.state;
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
    other.loadState(structuredClone((await repo.loadSession("g5"))!.state));
    other.dispatch({ type: "PLACE", index: 8, playerId: "p1" } as any);
    await repo.saveSession("g5", { type: "tictactoe", state: other.getState() });

    // 誰も居ない → キャッシュを捨てる
    await onRemoteStateChanged("g5");
    expect(sessions.has("g5")).toBe(false);

    // ソケットが居る → 復元して配信する
    const received: any[] = [];
    localSockets = [{ id: "s1", data: { userId: "p1" }, emit: (_ev, p) => received.push(p) }];
    await onRemoteStateChanged("g5");
    await new Promise((r) => setTimeout(r, 0)); // fetchSockets の then を待つ
    expect(sessions.get("g5")!.server.engine.getState().board[8]).toBe(1);
    expect(received.at(-1)?.board?.[8]).toBe(1);
  });

  it("destroySession はストアとキャッシュの両方から消す", async () => {
    const { server } = createSession("g6", newTicTacToe(), "tictactoe");
    await server.commit();
    await destroySession("g6");
    expect(sessions.has("g6")).toBe(false);
    expect(await repo.loadSession("g6")).toBeNull();
    expect(await repo.listSessions()).toEqual([]);
  });
});
