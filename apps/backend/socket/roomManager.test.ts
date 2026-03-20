import { expect, test, describe, beforeEach, spyOn, afterEach, mock } from "bun:test";
import { setIoInstance, scheduleRoomCleanup, clearRoomCleanup, updatePresence } from "./roomManager";
import { sessions, cleanupTimers, repo } from "../store/sessionStore";

describe("RoomManager", () => {
    let mockIo: any;

    beforeEach(() => {
        const emitMock = mock(() => {});
        mockIo = {
            to: mock(() => ({ emit: emitMock })),
            sockets: {
                adapter: {
                    rooms: new Map([["room1", { size: 2 }]])
                }
            }
        };
        setIoInstance(mockIo);
        sessions.clear();
        cleanupTimers.clear();
        spyOn(repo, "delete").mockImplementation(() => Promise.resolve());
    });

    test("scheduleRoomCleanup should add a timer", () => {
        scheduleRoomCleanup("room1");
        expect(cleanupTimers.has("room1")).toBe(true);
    });

    test("clearRoomCleanup should remove the timer", () => {
        scheduleRoomCleanup("room1");
        clearRoomCleanup("room1");
        expect(cleanupTimers.has("room1")).toBe(false);
    });

    test("updatePresence should emit metadata-update", () => {
        updatePresence("room1");
        expect(mockIo.to).toHaveBeenCalledWith("room1");
    });

    test("updatePresence should schedule cleanup if room is empty", () => {
        mockIo.sockets.adapter.rooms.set("room1", { size: 0 });
        updatePresence("room1");
        expect(cleanupTimers.has("room1")).toBe(true);
    });
});
