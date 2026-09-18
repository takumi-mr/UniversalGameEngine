import type { GameRecord, BaseGameState, BaseGameAction } from "@engine/shared/GameRules";
import type { EngineReplayData } from "@engine/shared/UniversalEngine";

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

/**
 * リプレイ記録（GameRecord）への追記単位。
 * 対局中はエンジンの履歴を N 手ごとにこの形で永続ログへ追記し、追記できた分をメモリ / セッション記録から切り詰める。
 * 完全なリプレイは永続ログ側にだけ存在する。
 */
export interface GameRecordChunk<TState extends BaseGameState, TAction extends BaseGameAction> {
  /** 記録がまだ無いときの作成用（既にあれば無視される） */
  initialState: TState;
  serverSeedHash: string;
  clientSeed: string;
  /** actions[0] を適用する前の version（= 記録済みの末尾と一致するはず） */
  fromVersion: number;
  actions: TAction[];
  /** stateHashes[0] は fromVersion 時点のハッシュ。以降は各アクション後のハッシュ（無ければ [hash0] だけでよい） */
  stateHashes: string[];
  /** 終局時のみ: サーバーシードの開示 */
  finalServerSeed?: string;
}

export interface IGameRepository<TState extends BaseGameState> {
  save(gameId: string, state: TState, isFinished?: boolean): Promise<void>;
  load(gameId: string): Promise<TState | null>;
  delete(gameId: string): Promise<void>;

  // Game History (Replay) persistence
  saveGameRecord(gameId: string, record: GameRecord<TState, BaseGameAction>): Promise<void>;
  /**
   * リプレイ記録に履歴を追記する（無ければ作る）。
   * 既に記録済みの version までのアクションは重複しないよう捨てる（Redis から古い履歴で復元されたときの再送対策）。
   */
  appendGameRecord(gameId: string, chunk: GameRecordChunk<TState, BaseGameAction>): Promise<void>;
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

  // --- 手番の締切（state.turnDeadline）の予約。期限が来たら組み込みの TIMEOUT を dispatch する ---
  /** at（epoch ms）に締切を予約する。既存の予約は上書き */
  scheduleDeadline(gameId: string, at: number): Promise<void>;
  cancelDeadline(gameId: string): Promise<void>;
  /** 期限（now 以前）を迎えた予約を取り出す。取り出した gameId は他のインスタンスには返らない */
  claimDueDeadlines(now: number): Promise<string[]>;
}
