import type { GameRecord, BaseGameState, BaseGameAction } from "../GameRules";
import type { EngineReplayData } from "../UniversalEngine";

/** セッションに参加している AI ボットの定義（復元時に同じボットを再生成するための情報） */
export interface BotSpec {
  playerId: string;
  aiType: string;
  name?: string;
}

/**
 * ステートレス復元用のセッション記録。どのインスタンスでも
 * この記録だけから SocketGameServer を再構築できることが要件。
 */
export interface SessionRecord<TState extends BaseGameState> {
  type: string;
  state: TState;
  bots?: BotSpec[];
  /**
   * リプレイ用のエンジン内部情報（初期状態・アクション履歴・ハッシュ履歴）。
   * これが無いと、別インスタンスで復元した対局の GameRecord は途中からの履歴しか持てない。
   */
  replay?: EngineReplayData<TState, BaseGameAction>;
}

export interface IGameRepository<TState extends BaseGameState> {
  save(gameId: string, state: TState, isFinished?: boolean): Promise<void>;
  load(gameId: string): Promise<TState | null>;
  delete(gameId: string): Promise<void>;

  // Game History (Replay) persistence
  saveGameRecord(gameId: string, record: GameRecord<TState, BaseGameAction>): Promise<void>;
  appendGameRecord(
    gameId: string,
    record: Partial<GameRecord<TState, BaseGameAction>>,
  ): Promise<void>;
  loadGameRecord(gameId: string): Promise<GameRecord<TState, BaseGameAction> | null>;

  // --- セッション（複数インスタンスで共有する真実の状態） ---
  saveSession(gameId: string, record: SessionRecord<TState>, isFinished?: boolean): Promise<void>;
  loadSession(gameId: string): Promise<SessionRecord<TState> | null>;
  deleteSession(gameId: string): Promise<void>;
  /** 存在するセッションの一覧（ルーム一覧 API 用） */
  listSessions(): Promise<{ gameId: string; type: string }[]>;

  /**
   * gameId 単位の排他ロック。複数インスタンスから同じ対局へ同時にアクションが届いても
   * 「読込 → dispatch → 保存」が直列化されるようにする。
   */
  withSessionLock<T>(gameId: string, fn: () => Promise<T>): Promise<T>;

  // --- 空室クリーンアップのスケジュール（プロセス内の setTimeout の代わり） ---
  /** at（epoch ms）に掃除するよう予約する。既に予約があれば何もしない */
  scheduleCleanup(gameId: string, at: number): Promise<void>;
  cancelCleanup(gameId: string): Promise<void>;
  /**
   * 期限（now 以前）を迎えた予約を取り出す。取り出せた gameId は他のインスタンスには返らない
   * （＝呼び出したインスタンスが掃除の責任を持つ）。
   */
  claimDueCleanups(now: number): Promise<string[]>;
}
