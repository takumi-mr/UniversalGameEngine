// apps/backend/gameOptions.ts
//
// 部屋作成時にクライアントから受け取る options の検疫。
// options は UniversalEngine（シード・ハッシュ設定）とルールセットの getInitialState にそのまま渡るので、
// 無検査で通すと作成者が serverSeed を固定して以後の乱数を知る、initialScores / playerIds で
// 点数や席を決める、盤サイズに巨大な値を入れてメモリを食い潰す、といったことができてしまう。
// ここではゲームごとに公開しているキーだけを、型と範囲を確かめて通す（許可リスト方式）。
// 新しいゲームに作成時オプションを持たせるときは GAME_OPTION_SCHEMAS に追加する。
import { ENGINE_RESERVED_OPTION_KEYS } from "@engine/shared/UniversalEngine";
import { gameRegistry } from "@engine/shared/GameRegistry";
import { BOT_TYPES } from "@engine/backend/ai/botFactory";
import {
  MIN_SIZE as OTHELLO_MIN_SIZE,
  MAX_SIZE as OTHELLO_MAX_SIZE,
} from "@engine/shared/rules/OthelloRuleset";

/** 値を検証して通す値を返す。undefined なら捨てる */
type OptionValidator = (value: unknown) => unknown;

type OptionSchema = Record<string, OptionValidator>;

const isInteger = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const integer =
  (min: number, max: number): OptionValidator =>
  (v) =>
    isInteger(v) && v >= min && v <= max ? v : undefined;

const number =
  (min: number, max: number): OptionValidator =>
  (v) =>
    isFiniteNumber(v) && v >= min && v <= max ? v : undefined;

const boolean: OptionValidator = (v) => (typeof v === "boolean" ? v : undefined);

const oneOf =
  (choices: readonly string[]): OptionValidator =>
  (v) =>
    typeof v === "string" && choices.includes(v) ? v : undefined;

const stringOf =
  (maxLength: number): OptionValidator =>
  (v) =>
    typeof v === "string" && v.length > 0 && v.length <= maxLength ? v : undefined;

/** 9×9 の整数（0〜9）の盤面 */
const sudokuBoard: OptionValidator = (v) => {
  if (!Array.isArray(v) || v.length !== 9) return undefined;
  const ok = v.every(
    (row) =>
      Array.isArray(row) &&
      row.length === 9 &&
      row.every((cell) => isInteger(cell) && cell >= 0 && cell <= 9),
  );
  return ok ? v : undefined;
};

/** 登録済みゲームタイプの配列（Decathlon の種目プール） */
const gameTypeList: OptionValidator = (v) => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) return undefined;
  const ok = v.every((t) => typeof t === "string" && gameRegistry.getDefinition(t) !== undefined);
  return ok ? v : undefined;
};

/** スロットごとの種別（"human" かボット種別） */
const playersConfig: OptionValidator = (v) => {
  if (!Array.isArray(v) || v.length > 16) return undefined;
  const allowed: readonly string[] = ["human", ...BOT_TYPES];
  return v.every((t) => typeof t === "string" && allowed.includes(t)) ? v : undefined;
};

/**
 * どのゲームでも受け付ける、サーバーが解釈するキー。
 * clientSeed は Provably Fair の「クライアント側シード」なので受け取ってよい（serverSeed は不可）
 */
const COMMON_SCHEMA: OptionSchema = {
  clientSeed: stringOf(128),
  playersConfig,
  addAi: oneOf(BOT_TYPES),
};

/** ゲームごとに公開している作成時オプション */
const GAME_OPTION_SCHEMAS: Record<string, OptionSchema> = {
  othello: { size: integer(OTHELLO_MIN_SIZE, OTHELLO_MAX_SIZE) },
  othello_3d: { size: integer(2, 8) },
  go: { size: integer(5, 19), komi: number(0, 100) },
  minesweeper: { rows: integer(2, 50), cols: integer(2, 50), mineCount: integer(1, 2499) },
  sudoku: { initialBoard: sudokuBoard },
  tower_of_hanoi: { diskCount: integer(1, 12) },
  logic_lab: { levelId: integer(1, 100) },
  mahjong: { akaDora: boolean },
  mahjong_match: { akaDora: boolean, mode: oneOf(["TONPU", "HANCHAN"]) },
  decathlon: { eventCount: integer(1, 20), gamePool: gameTypeList },
  cave_dive: { decisionTimeMs: integer(0, 10 * 60 * 1000) },
};

/**
 * クライアントから受け取った options を、そのゲームで許可しているキーだけに絞る。
 * 許可外のキー・型や範囲が合わない値は捨ててログに残す（エラーにはしない）。
 * @param gameType 正規化済みのゲームタイプ
 */
export function sanitizeCreateOptions(gameType: string, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const schema: OptionSchema = { ...COMMON_SCHEMA, ...(GAME_OPTION_SCHEMAS[gameType] ?? {}) };
  const result: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const validator = schema[key];
    const accepted = validator ? validator(value) : undefined;
    if (accepted === undefined) {
      dropped.push(key);
      continue;
    }
    result[key] = accepted;
  }

  // Minesweeper: 地雷は盤面より少なくないと初期化が終わらない
  if (gameType === "minesweeper" && isInteger(result.mineCount)) {
    const rows = isInteger(result.rows) ? result.rows : 10;
    const cols = isInteger(result.cols) ? result.cols : 10;
    if (result.mineCount >= rows * cols) {
      dropped.push("mineCount");
      delete result.mineCount;
    }
  }

  if (dropped.length > 0) {
    const reserved = dropped.filter((k) =>
      (ENGINE_RESERVED_OPTION_KEYS as readonly string[]).includes(k),
    );
    console.warn(
      `[gameOptions] Dropped options for ${gameType}: ${dropped.join(", ")}` +
        (reserved.length > 0 ? ` (engine-reserved: ${reserved.join(", ")})` : ""),
    );
  }
  return result;
}
