import { expect, test, describe, beforeEach, mock } from "bun:test";
import {
  setIoInstance,
  scheduleRoomCleanup,
  clearRoomCleanup,
  updatePresence,
  sweepRoomCleanups,
} from "@engine/backend/socket/roomManager";
import {
  sessions,
  repo,
  createSession,
  EMPTY_ROOM_TIMEOUT,
} from "@engine/backend/store/sessionStore";
import { InMemoryDummyRepository } from "@engine/backend/infra/InMemoryDummyRepository";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { TicTacToeRuleset } from "@engine/shared/rules/TicTacToeRuleset";

// bun test では NODE_ENV=test なのでリポジトリはインメモリ実装になる
const memRepo = repo as InMemoryDummyRepository<any>;

describe("RoomManager", () => {
  let mockIo: any;
  let emitMock: ReturnType<typeof mock>;
  // ルームごとの（クラスタ全体の）ソケット一覧を模す
  let roomSockets: Map<string, { id: string }[]>;

  beforeEach(async () => {
    emitMock = mock(() => {});
    roomSockets = new Map([["room1", [{ id: "s1" }, { id: "s2" }]]]);
    mockIo = {
      to: mock(() => ({ emit: emitMock })),
      in: (room: string) => ({ fetchSockets: async () => roomSockets.get(room) ?? [] }),
      local: { in: (room: string) => ({ fetchSockets: async () => roomSockets.get(room) ?? [] }) },
    };
    setIoInstance(mockIo);
    sessions.clear();
    for (const { gameId } of await memRepo.listSessions()) await memRepo.deleteSession(gameId);
    // 他のテストファイルが残した予約を捨てる
    await memRepo.claimDueCleanups(Number.MAX_SAFE_INTEGER);
  });

  test("scheduleRoomCleanup はストアに予約を登録する", async () => {
    await scheduleRoomCleanup("room1");
    expect(memRepo.hasCleanupScheduled("room1")).toBe(true);
    // 期限前は取り出されない
    expect(await memRepo.claimDueCleanups(Date.now())).toEqual([]);
  });

  test("clearRoomCleanup は予約を取り消す", async () => {
    await scheduleRoomCleanup("room1");
    await clearRoomCleanup("room1");
    expect(memRepo.hasCleanupScheduled("room1")).toBe(false);
  });

  test("updatePresence は metadata-update を送る", async () => {
    await updatePresence("room1");
    expect(mockIo.to).toHaveBeenCalledWith("room1");
    expect(emitMock).toHaveBeenCalledWith(
      "metadata-update",
      expect.objectContaining({ playerCount: 2, spectatorCount: 0 }),
    );
  });

  test("updatePresence は部屋が空なら掃除を予約し、人が居れば取り消す", async () => {
    roomSockets.set("room1", []);
    await updatePresence("room1");
    expect(memRepo.hasCleanupScheduled("room1")).toBe(true);

    roomSockets.set("room1", [{ id: "s1" }]);
    await updatePresence("room1");
    expect(memRepo.hasCleanupScheduled("room1")).toBe(false);
  });

  test("sweepRoomCleanups は期限の来た空室だけを削除する", async () => {
    const engine = new UniversalEngine(TicTacToeRuleset, {});
    createSession("empty", engine, "tictactoe");
    await sessions.get("empty")!.server.commit();
    createSession("occupied", new UniversalEngine(TicTacToeRuleset, {}), "tictactoe");
    await sessions.get("occupied")!.server.commit();
    roomSockets.set("occupied", [{ id: "s9" }]);

    await scheduleRoomCleanup("empty");
    await scheduleRoomCleanup("occupied");

    // まだ期限前
    expect(await sweepRoomCleanups(Date.now())).toEqual([]);
    expect(sessions.has("empty")).toBe(true);

    // 期限後: 空室は消え、人が居る部屋は残る
    const deleted = await sweepRoomCleanups(Date.now() + EMPTY_ROOM_TIMEOUT + 1);
    expect(deleted).toEqual(["empty"]);
    expect(sessions.has("empty")).toBe(false);
    expect(await memRepo.loadSession("empty")).toBeNull();
    expect(sessions.has("occupied")).toBe(true);
    expect(await memRepo.loadSession("occupied")).not.toBeNull();
    expect(emitMock).toHaveBeenCalledWith(
      "error-message",
      "Room has been deleted due to inactivity.",
    );
  });
});
