// apps/backend/store/sessionStore.ts
//
// セッション（対局）の管理。
//
// 真実の状態はリポジトリ（Redis / インメモリ）にある SessionRecord で、
// sessions Map はこのインスタンス内のキャッシュにすぎない。どのインスタンスも
//   withSession(gameId): ロック → キャッシュ（なければ復元） → ストアより古ければ再読込 → 処理 → commit（配信 + 保存）
// の手順で対局を進めるので、クライアントがどのインスタンスに接続していても同じ結果になる。
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { InMemoryDummyRepository } from "@engine/backend/infra/InMemoryDummyRepository";
import { HybridGameRepository } from "@engine/backend/infra/HybridGameRepository";
import { GenericGameServer } from "@engine/shared/network/GenericGameServer";
import { compare, type Operation } from "fast-json-patch";
import { calculateStateHash } from "@engine/shared";
import { streamManager } from "@engine/backend/network/StreamManager";
import type { IAIPlayer } from "@engine/shared/ai/IAIPlayer";
import { gameRegistry } from "@engine/shared/GameRegistry";
import type { IGameRepository, BotSpec, SessionRecord } from "@engine/shared/stores/repository";
import { useInMemoryStore, REDIS_URL, MONGO_URL, REPLAY_FLUSH_SIZE } from "@engine/backend/config";
import { createBotPlayer } from "@engine/backend/ai/botFactory";
import { fetchLocalSockets, publishClusterEvent } from "@engine/backend/network/io";

export const normalizeGameType = (type: string) => type.toLowerCase().replace(/-/g, "_");

/** broadcastLocal で targetId（プレイヤー / SPECTATOR）ごとに 1 回だけ用意する配信用データ */
interface PreparedState {
  targetId: string;
  /** マスク済み状態（version / hash 付与済み） */
  maskedState: any;
  /** maskedState の JSON */
  json: string;
  /** クライアントが受け取る形（JSON 経由）の状態。lastSentState に共有で保持する */
  sent: any;
  /** 基準バージョン → その版からの差分（同じ targetId のソケットで共有） */
  patches: Map<number, { patch: Operation[]; payload: string }>;
}

export class SocketGameServer extends GenericGameServer<any, any> {
  // ソケットごとに最後に送信した「マスク済み状態」を記録する（差分送信用。インスタンスローカル）
  private lastSentState: Map<string, any> = new Map();

  // ゲームタイプ（正規化済み）
  public gameType: string;

  // AI プレイヤー。bots が永続化される定義、aiPlayers はそこから生成した実行時オブジェクト
  public bots: BotSpec[] = [];
  public aiPlayers: Map<string, IAIPlayer<any, any>> = new Map();
  private computingAIPlayers: Set<string> = new Set();

  // 終局時のリプレイ記録の追記が済んだか（重複追記を避けるためのフラグ）
  private isRecordSaved: boolean = false;

  /** 何手溜まったらリプレイ記録へ追記して履歴を切り詰めるか（テストで差し替え可能） */
  public static replayFlushSize = REPLAY_FLUSH_SIZE;

  constructor(roomId: string, engine: UniversalEngine<any, any>, gameType: string) {
    super(roomId, engine);
    this.gameType = normalizeGameType(gameType);
  }

  /** ボットを追加する（定義と実行時オブジェクトの両方） */
  public addBot(spec: BotSpec): IAIPlayer<any, any> | null {
    const player = createBotPlayer(spec, this.roomId, this.gameType);
    if (!player) return null;
    this.bots.push(spec);
    this.aiPlayers.set(spec.playerId, player);
    return player;
  }

  /** 永続化されたボット定義から実行時オブジェクトを作り直す（復元時） */
  public restoreBots(bots: BotSpec[]): void {
    this.bots = [];
    this.aiPlayers.clear();
    for (const spec of bots) this.addBot(spec);
  }

  public toRecord(): SessionRecord<any> {
    return {
      type: this.gameType,
      state: this.engine.getState(),
      bots: this.bots,
      replay: this.engine.getReplayData(),
    };
  }

  /**
   * ストアの方が新しければエンジンの状態を差し替える。
   * 別インスタンスが対局を進めた後に、このインスタンスへアクションが届いたときのため。
   */
  public async refreshFromStore(): Promise<void> {
    const saved = await repo.loadSession(this.roomId);
    if (!saved) return;
    const localVersion = this.engine.getState().version ?? 0;
    const savedVersion = saved.state.version ?? 0;
    if (savedVersion !== localVersion) {
      this.engine.loadState(saved.state, saved.replay);
    }
    const savedBots = JSON.stringify(saved.bots ?? []);
    if (savedBots !== JSON.stringify(this.bots)) {
      this.restoreBots(saved.bots ?? []);
    }
  }

  /**
   * 配信してから保存する（write-behind）。エンジンを直接進めた後（JOIN / START / 離席など）は必ずこれを呼ぶ。
   * withSession の中で呼ぶこと（ロック外で呼ぶと他インスタンスの更新を上書きしうる）。
   *
   * このインスタンスのクライアントには保存を待たせずに配る。保存はロック内で完了させ、
   * 他インスタンスへの通知（ストアを読み直させる）は保存が終わってから行うので、
   * 「真実はストア」の契約は変わらない。
   */
  public async commit(): Promise<void> {
    const state = this.engine.getState();
    const finished = state.status === "FINISHED";

    // 1. まずこのインスタンスに接続しているクライアントへ配る
    this.broadcastLocal();

    // 2. 溜まった履歴をリプレイ記録へ追記し、メモリから切り詰める（セッション記録が手数に比例して肥大しないように）
    await this.persistReplay(finished);

    // 3. 保存と締切予約（期限が来たら deadlineSweeper が TIMEOUT を dispatch する）
    await Promise.all([
      repo.saveSession(this.roomId, this.toRecord(), finished),
      state.status === "PLAYING" && state.turnDeadline !== undefined
        ? repo.scheduleDeadline(this.roomId, state.turnDeadline)
        : repo.cancelDeadline(this.roomId),
    ]);

    // 4. 保存済みになったので他インスタンスへ知らせ、AI の手番があれば進める
    this.notifySaved();
  }

  /**
   * エンジンに溜まった履歴をリプレイ記録（完全な履歴を持つ永続ログ）へ追記する。
   * 対局中は REPLAY_FLUSH_SIZE 手ごとに追記して、追記できた分はエンジン（＝セッション記録）から切り詰める。
   * 終局時は残りをすべて追記し、サーバーシードを開示する。
   * 追記に失敗しても対局は止めない。履歴はメモリ / セッション記録に残るので次の機会に再試行される
   * （記録済みの分はリポジトリ側が version で重複排除する）。
   */
  private async persistReplay(finished: boolean): Promise<void> {
    if (this.isRecordSaved) return;
    if (!finished && this.engine.history.length < SocketGameServer.replayFlushSize) return;

    const record = this.engine.getGameRecord(this.roomId);
    const fromVersion = (this.engine.getState().version ?? 0) - record.actions.length;
    try {
      await repo.appendGameRecord(this.roomId, {
        initialState: record.initialState,
        serverSeedHash: record.serverSeedHash,
        clientSeed: record.clientSeed,
        fromVersion,
        actions: record.actions,
        stateHashes: record.stateHashes ?? [],
        finalServerSeed: record.finalServerSeed,
      });
    } catch (err) {
      console.error(`[Replay] Failed to append game record for ${this.roomId}:`, err);
      return;
    }

    if (finished) {
      this.isRecordSaved = true;
    } else {
      this.engine.flushHistory();
    }
  }

  /**
   * アクションを 1 手適用する。ロック → 最新化 → dispatch → 配信 → 保存 までを行う。
   * Socket.io / HTTP / gRPC / AI のすべての着手はここを通る。
   */
  public async dispatchAction(playerId: string, action: any): Promise<boolean> {
    return repo.withSessionLock(this.roomId, async () => {
      await this.refreshFromStore();
      // セキュリティ: 送信元の playerId をアクションに強制付与（改ざん防止）
      action.playerId = playerId;
      action.timestamp = Date.now();
      const success = this.engine.dispatch(action);
      if (success) await this.commit();
      return success;
    });
  }

  /** @deprecated ロックと保存を伴わないので使わない。dispatchAction を使うこと */
  public override handleAction(_playerId: string, _action: any): boolean {
    throw new Error("SocketGameServer.handleAction is disabled; use dispatchAction()");
  }

  /**
   * 保存済みの状態を配信する。
   * このインスタンスに接続しているクライアントへ送り、他のインスタンスにはクラスタイベントで知らせる。
   */
  public override broadcastState(): void {
    this.broadcastLocal();
    this.notifySaved();
  }

  /** 保存が完了した後の後処理: 他インスタンスへの通知と AI の手番の自動実行 */
  private notifySaved(): void {
    publishClusterEvent("uge:state-changed", {
      gameId: this.roomId,
      version: this.engine.getState().version ?? 0,
    });
    // AI のターンであれば自動実行する（対局を進めたインスタンスだけが行う）
    this.checkAndExecuteAiTurns();
  }

  /**
   * このインスタンスに接続しているソケット・gRPC ストリームへ現在の状態を送る。
   * マスク・ハッシュ・シリアライズは配信先ごとではなく targetId（各プレイヤー / SPECTATOR）ごとに 1 回だけ行い、
   * 差分（パッチ）も同じ targetId・同じ基準バージョンなら使い回す（観戦者が多いときに効く）。
   * @param targetSocketId 指定するとそのソケットにだけフル状態を送る（再同期要求）
   */
  public broadcastLocal(targetSocketId?: string): void {
    const state = this.engine.getState();
    const players = state.players ? (Object.values(state.players).filter(Boolean) as string[]) : [];
    const isForceFull = !!targetSocketId;

    const prepared = new Map<string, PreparedState>();
    const prepare = (userId: string): PreparedState => {
      const targetId = players.includes(userId) ? userId : "SPECTATOR";
      let entry = prepared.get(targetId);
      if (!entry) {
        const maskedState = this.engine.getMaskedState(targetId);
        // version と hash を付与
        maskedState.version = state.version;
        maskedState.hash = calculateStateHash(maskedState);
        const json = JSON.stringify(maskedState);
        // 「最後に送った状態」はクライアントが受け取ったものと同じ（JSON を経由した）形で持つ。
        // 同じ targetId のソケットで共有するので変更しないこと
        entry = { targetId, maskedState, json, sent: JSON.parse(json), patches: new Map() };
        prepared.set(targetId, entry);
      }
      return entry;
    };

    fetchLocalSockets(this.roomId)
      .then((sockets) => {
        for (const socket of sockets) {
          // targetSocketId が指定されている場合はそのソケットのみ処理、そうでなければ全員
          if (targetSocketId && socket.id !== targetSocketId) continue;

          const entry = prepare(socket.data.userId);
          const { maskedState, json: statePayload } = entry;

          const socketId = socket.id;
          const previousState = this.lastSentState.get(socketId);

          // 強制フル更新でない場合、かつ以前の状態がある場合は差分を試みる
          if (
            !isForceFull &&
            previousState &&
            previousState.version !== undefined &&
            previousState.version < maskedState.version
          ) {
            // 差分（パッチ）を生成（同じ基準バージョンのソケット同士では共有）
            let cached = entry.patches.get(previousState.version);
            if (!cached) {
              const patch = compare(previousState, maskedState);
              cached = { patch, payload: JSON.stringify(patch) };
              entry.patches.set(previousState.version, cached);
            }

            // パッチの方が明らかに小さい場合のみ差分送信
            if (cached.patch.length > 0 && cached.payload.length < statePayload.length * 0.8) {
              socket.emit("server-time", Date.now());
              socket.emit("state-patch", {
                patch: cached.patch,
                baseVersion: previousState.version,
                targetVersion: maskedState.version,
                hash: maskedState.hash,
              });
              this.lastSentState.set(socketId, entry.sent);
              continue;
            }
          }

          // 初回送信、パッチの方が大きい場合、または強制フル更新の場合はフルデータを送信
          socket.emit("server-time", Date.now());
          socket.emit("state-update", maskedState);
          this.lastSentState.set(socketId, entry.sent);
        }
      })
      .catch((err) => console.error("Broadcast error:", err));

    if (targetSocketId) return;

    // gRPC ストリームへの通知（ストリームはインスタンスローカル）
    streamManager.notify(this.roomId, (userId) => ({
      stateUpdate: {
        stateJson: prepare(userId).json,
        metadata: {
          playerCount: players.length,
          activePlayers: players,
        },
      },
    }));
  }

  private checkAndExecuteAiTurns() {
    const state = this.engine.getState();
    if (state.status !== "PLAYING") return;

    // 手番プレイヤーリストを取得。空の場合は「いずれかのAIに合法手があるか」をチェックして補足する
    const activePlayerIds = [...(state.activePlayers || [])];
    if (activePlayerIds.length === 0) {
      for (const [playerId] of this.aiPlayers) {
        if (this.engine.getLegalActions(playerId).length > 0) {
          activePlayerIds.push(playerId);
        }
      }
    }

    for (const playerId of activePlayerIds) {
      const aiPlayer = this.aiPlayers.get(playerId);
      if (aiPlayer && !this.computingAIPlayers.has(playerId)) {
        this.computingAIPlayers.add(playerId);

        const legalActions = this.engine.getLegalActions(playerId);
        if (legalActions.length === 0) {
          this.computingAIPlayers.delete(playerId);
          continue;
        }

        aiPlayer
          .computeNextMove(state, legalActions)
          .then(async (action) => {
            this.computingAIPlayers.delete(playerId);
            if (!action) return;
            // dispatchAction がロック内で最新状態に対して合法性を検証するので、
            // 思考中に局面が進んでいれば単に拒否される
            await this.dispatchAction(playerId, action);
          })
          .catch((err) => {
            this.computingAIPlayers.delete(playerId);
            console.error(`[AI] Error computing move for player ${playerId}:`, err);
          });
      }
    }
  }

  /** AI が思考中かどうか（思考中はキャッシュを捨てない） */
  public isComputingAi(): boolean {
    return this.computingAIPlayers.size > 0;
  }

  /** インスタンスのキャッシュから外すときに、Worker などの資源を解放する */
  public dispose(): void {
    for (const player of this.aiPlayers.values()) {
      const resettable = player as { reset?: () => void };
      if (typeof resettable.reset === "function") resettable.reset();
    }
    this.aiPlayers.clear();
    this.lastSentState.clear();
  }

  public handleDisconnect(socketId: string): void {
    this.lastSentState.delete(socketId);
  }
}

export interface GameSession {
  server: SocketGameServer;
  type: string;
}

/** このインスタンスのセッションキャッシュ（真実はリポジトリ側） */
export const sessions = new Map<string, GameSession>();

export const EMPTY_ROOM_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// ★ 環境によってリポジトリの実装を切り替えるファクトリ関数
function createRepository(): IGameRepository<any> {
  if (useInMemoryStore()) {
    console.log("🚀 Initializing repository in-memory (RL_MODE / test)");
    return new InMemoryDummyRepository();
  }

  console.log("🌍 Initializing repository in PRODUCTION_MODE (HybridGameRepository)");
  return new HybridGameRepository<any>(REDIS_URL, MONGO_URL);
}

export const repo = createRepository();

/**
 * 新しいセッションを作る。エンジンを組み立てた後（ボット着席・自動開始など）に commit するのは呼び出し側。
 */
export function createSession(gameId: string, engine: UniversalEngine<any, any>, type: string) {
  const server = new SocketGameServer(gameId, engine, type);
  const session: GameSession = { server, type: server.gameType };
  sessions.set(gameId, session);
  return session;
}

/**
 * セッションをキャッシュから取得する。なければリポジトリから復元する。
 * どのインスタンスからでも同じ対局を扱えるようにするための入口。
 */
export async function ensureSession(gameId: string): Promise<GameSession | null> {
  const existing = sessions.get(gameId);
  if (existing) return existing;

  let saved: SessionRecord<any> | null = null;
  try {
    saved = await repo.loadSession(gameId);
  } catch (err) {
    console.error(`[ensureSession] Failed to load session ${gameId} from storage:`, err);
  }
  if (!saved || !saved.type) return null;

  const type = normalizeGameType(saved.type);
  const def = gameRegistry.getDefinition(type);
  if (!def) {
    console.warn(`[ensureSession] Unknown game type '${saved.type}' for game ${gameId}`);
    return null;
  }

  // 復元中に別の経路で同じセッションが作られていたらそちらを使う
  const raced = sessions.get(gameId);
  if (raced) return raced;

  const engine = new UniversalEngine(def.ruleset, {});
  // replay（初期状態・履歴）も戻さないと、この後で終局したときのリプレイ記録が不完全になる
  engine.loadState(saved.state, saved.replay);
  const session = createSession(gameId, engine, type);
  session.server.restoreBots(saved.bots ?? []);
  console.log(`[ensureSession] Game ${gameId} restored from storage (type: ${type})`);
  return session;
}

/**
 * セッションをロックした上で最新状態にし、fn を実行する。
 * fn の中でエンジンを進めたら session.server.commit() を呼ぶこと。
 * セッションが存在しなければ fn は呼ばれず null を返す。
 */
export async function withSession<T>(
  gameId: string,
  fn: (session: GameSession) => Promise<T>,
): Promise<T | null> {
  return repo.withSessionLock(gameId, async () => {
    const session = await ensureSession(gameId);
    if (!session) return null;
    await session.server.refreshFromStore();
    return fn(session);
  });
}

/** セッションを削除する（ストア + このインスタンスのキャッシュ）。他インスタンスにも通知する */
export async function destroySession(gameId: string): Promise<void> {
  dropLocalSession(gameId);
  await repo.deleteSession(gameId);
  publishClusterEvent("uge:session-deleted", { gameId });
}

/** このインスタンスのキャッシュからだけ外す（ストアは触らない） */
export function dropLocalSession(gameId: string): void {
  const session = sessions.get(gameId);
  if (!session) return;
  sessions.delete(gameId);
  session.server.dispose();
}

/**
 * 別インスタンスが対局を進めたときの処理。
 * このインスタンスにそのルームのクライアント（ソケット / gRPC ストリーム）が居るなら
 * ストアから最新状態を読み込んで配信し直す。誰も居なければキャッシュだけ捨てる。
 */
export async function onRemoteStateChanged(gameId: string): Promise<void> {
  const cached = sessions.get(gameId);
  const hasLocalSockets = (await fetchLocalSockets(gameId)).length > 0;
  const hasLocalStreams = streamManager.hasStreams(gameId);

  if (!hasLocalSockets && !hasLocalStreams) {
    // 誰も見ていないキャッシュは古くなるだけなので捨てる（次にアクセスされたら復元される）。
    // ただし AI が思考中なら、その着手が dispatchAction で処理されるまで残す
    if (cached && !cached.server.isComputingAi()) dropLocalSession(gameId);
    return;
  }

  const session = cached ?? (await ensureSession(gameId));
  if (!session) return;
  await session.server.refreshFromStore();
  session.server.broadcastLocal();
}
