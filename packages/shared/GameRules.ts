// --- 1. エンジンが要求する「ルールの文法（契約）」 ---
// エンジンが状態を扱うための最低限の約束
export interface BaseGameState {
  status: "WAITING" | "PLAYING" | "FINISHED";
  message?: string;
  // { "1": "userIdA", "-1": "userIdB" } のようにロールとユーザーIDをマッピング
  players?: Record<string | number, string | null>;
  // アクティブな（現在手番・アクションを起こす権限がある）プレイヤーのIDリスト
  activePlayers?: string[];
  // ターンの制限時間（タイムスタンプ）。麻雀などの割り込みアクション（ポン・チー）待機時間に有用
  turnDeadline?: number;
  // 状態のバージョン（差分更新の一貫性チェック用）
  version?: number;
  // 状態のハッシュ値（デスキンス検知用）
  hash?: string;
  // 乱数生成器の設定（Provably Fair用）
  prngConfig?: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
  };
  // 過去のアクションによって生成された状態のハッシュ履歴 (リプレイ検証用)
  stateHashes?: string[];
}

// エンジンがアクションを識別するための最低限の約束
export interface BaseGameAction {
  type: string;
  playerId?: string; // サーバー側で検証・付与された送信元のユーザーID
  timestamp?: number; // アクションが発生した時刻
}

/**
 * エンジンが全ゲーム共通で受け付ける組み込みアクション（UniversalEngine.dispatch 参照）。
 * ルールセットの TAction に含まれていなくても dispatch できる。
 * - JOIN   : state.players の空席（slot 指定があればその席）に着席する
 * - START  : 対局を開始する（ルールセットが START を扱わなければ status を PLAYING にする）
 * - TIMEOUT: 制限時間切れ。getTimeoutAction → RESIGN → 強制終了 の順に解決される
 */
export type BuiltinAction =
  | { type: "JOIN"; playerId: string; slot?: string; timestamp?: number }
  | { type: "START"; playerId?: string; timestamp?: number }
  | { type: "TIMEOUT"; playerId: string; timestamp: number };

/**
 * getMaskedState() が返す実際の形。Secret<T> はエンジンによって展開されるため、
 * 閲覧可能なプレイヤーには中身 T が、そうでなければ maskedValue（既定 "?"）が入る。
 * どちらになるかは閲覧者次第なので、Secret だった箇所は unknown として扱う。
 */
export type Masked<T> =
  T extends Secret<unknown>
    ? unknown
    : T extends (infer E)[]
      ? Masked<E>[]
      : T extends object
        ? { [K in keyof T]: Masked<T[K]> }
        : T;

// 勝敗結果を表す専用の型
export interface GameResult {
  isFinished: boolean;
  // 勝利したプレイヤーのIDリスト。
  // undefined: 勝敗未決 (isFinished: false時)
  // []: 引き分け (isFinished: true時)
  // ["playerId"]: 単独勝利
  // ["playerId1", "playerId2"]: 同時勝利（ゲームによる）
  winnerIds?: string[];
  message?: string;
}

/**
 * 閲覧制限のある情報を包むラッパー型
 * エンジンはこの型を見つけると、対象プレイヤー以外に対して自動的にマスク処理を行う。
 */
export interface Secret<T> {
  __isSecret: true;
  value: T;
  // 閲覧可能なプレイヤーIDのリスト。 "*" は全員。
  visibleTo: string[];
  // マスク時の代替値。未指定の場合はデフォルト（"?" など）が使用される
  maskedValue?: unknown;
}

export function createSecret<T>(value: T, visibleTo: string[], maskedValue?: unknown): Secret<T> {
  return { __isSecret: true, value, visibleTo, maskedValue };
}

export function isSecret(obj: unknown): obj is Secret<unknown> {
  return !!(obj && typeof obj === "object" && (obj as Record<string, unknown>).__isSecret === true);
}

import type { IGameRNG } from "@engine/shared/utils/IGameRNG";

export interface GameRuleset<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
  TOptions = Record<string, unknown>,
> {
  // ゲームの初期状態を生成する関数
  getInitialState: (options?: TOptions, rng?: IGameRNG) => TState;

  // そのアクションが現在の状態で「合法手」かどうかを判定する関数
  isValidAction: (state: TState, action: TAction) => boolean;

  // アクションを受け取り、新しい状態を返す関数（Reducer）
  reduce: (state: TState, action: TAction, rng?: IGameRNG) => TState;

  // ゲームが終了したかどうか、誰が勝ったかを判定する関数
  checkWinCondition: (state: TState) => GameResult;

  // ゲームが終了したかどうか、誰が勝ったかを判定する関数
  applyWinResult?: (state: TState, result: GameResult) => TState;

  /**
   * @deprecated Secret<T>に移行
   * 隠匿情報（相手の手牌など）をマスク（伏せた）状態を作成する関数 (オプショナル)
   */
  maskState?: (state: TState, playerId: string) => TState;

  /**
   * 配信メタ（「その更新を生んだアクション」）を閲覧者ごとに隠す (オプショナル)。
   * アクション自体に他人へ見せてはいけない項目があるゲーム（秘密の入札・同時選択・人狼の夜行動など）だけ実装する。
   * 行動した本人（action.playerId === viewerId）には呼ばれず、そのまま届く。
   * 隠したい項目を落としたアクションを返す。null を返すとそのアクションは配信されない
   * （誰が行動したかも隠したい場合）。state はアクション適用後の状態。純粋関数であること
   */
  maskAction?: (state: TState, action: TAction, viewerId: string) => TAction | null;

  /**
   * 制限時間切れ（state.turnDeadline 経過）の際に、playerId の代わりに自動実行するアクションを返す (オプショナル)。
   * エンジンは組み込みの TIMEOUT アクションを受け取るとこれを呼び、null なら RESIGN（受け付けなければ強制終了）にする。
   * 純粋関数であること（時刻は action.timestamp で渡される）
   */
  getTimeoutAction?: (state: TState, playerId: string) => TAction | null;

  // 特定のプレイヤーが現在実行可能な合法手の完全なリストを返す関数（AI用）
  getLegalActions: (state: TState, playerId: string) => TAction[];
}

/**
 * ゲームの全記録を保持するインターフェース。
 * 初期状態（またはシード）とアクションの履歴を保存し、完全な再現を可能にする。
 */
export interface GameRecord<TState extends BaseGameState, TAction extends BaseGameAction> {
  gameId: string;

  // 再現用
  initialState: TState;
  actions: TAction[];

  // RNG検証用
  serverSeedHash: string;
  clientSeed: string;
  finalServerSeed?: string; // ゲーム終了後に開示可能

  // スナップショット（履歴を切り捨てて復旧する場合に使用）
  snapshotState?: TState;
  snapshotVersion?: number;

  // 各ステップでのハッシュ（検証用）
  stateHashes?: string[];
}
