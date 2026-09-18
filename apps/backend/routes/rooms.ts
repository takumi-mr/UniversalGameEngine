import { Router } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "@engine/backend/config";
import { repo } from "@engine/backend/store/sessionStore";
import { countRoomSockets } from "@engine/backend/network/io";
import type { BotSpec } from "@engine/shared/stores/repository";

const router = Router();

interface RoomSummary {
  id: string;
  type: string;
  playerCount: number;
  /** 着席している AI ボット（外部の gRPC ボットが自分の席を見つけるために使う） */
  bots: BotSpec[];
}

/**
 * ルーム一覧はリポジトリ（全インスタンス共通）から取り、在室数はアダプタ越しにクラスタ全体で数える。
 * このインスタンスのメモリにあるセッションだけを返すと、別インスタンスで作られた部屋が見えない。
 */
const listRooms = async (filter?: (type: string) => boolean): Promise<RoomSummary[]> => {
  const all = await repo.listSessions();
  const matched = filter ? all.filter((s) => filter(s.type)) : all;
  return Promise.all(
    matched.map(async ({ gameId, type }) => {
      const [playerCount, record] = await Promise.all([
        countRoomSockets(gameId),
        repo.loadSession(gameId),
      ]);
      return { id: gameId, type, playerCount, bots: record?.bots ?? [] };
    }),
  );
};

// アクティブなルーム一覧の取得
router.get("/", async (_req, res) => {
  try {
    res.json({ rooms: await listRooms() });
  } catch (err) {
    console.error("[/rooms] Error:", err);
    res.status(500).json({ error: "Failed to list rooms" });
  }
});

// ログインユーザーが参加しているルーム一覧
router.get("/my", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token" });

  let userId: string;
  try {
    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    userId = decoded.userId;
  } catch (err) {
    console.error("[/rooms/my] Error:", err);
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    const all = await repo.listSessions();
    const mine: RoomSummary[] = [];
    for (const { gameId, type } of all) {
      const record = await repo.loadSession(gameId);
      const players = record?.state?.players ? Object.values(record.state.players) : [];
      // Case-insensitive comparison
      const isMember = players.some(
        (p) => typeof p === "string" && p.toLowerCase() === userId.toLowerCase(),
      );
      if (isMember) {
        mine.push({
          id: gameId,
          type,
          playerCount: await countRoomSockets(gameId),
          bots: record?.bots ?? [],
        });
      }
    }
    res.json({ rooms: mine });
  } catch (err) {
    console.error("[/rooms/my] Error:", err);
    res.status(500).json({ error: "Failed to list rooms" });
  }
});

// ゲーム種別ごとのルーム一覧
router.get("/:gameType", async (req, res) => {
  const gameType = req.params.gameType.toLowerCase();
  try {
    res.json({ rooms: await listRooms((type) => type.toLowerCase() === gameType) });
  } catch (err) {
    console.error(`[/rooms/${gameType}] Error:`, err);
    res.status(500).json({ error: "Failed to list rooms" });
  }
});

export default router;
