// packages/shared/rules/MetaGameRuleset.ts
import type { BaseGameState, BaseGameAction, GameRuleset, GameResult } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";

/**
 * 複数のサブゲームを管理するための状態型
 */
export interface MetaGameState extends BaseGameState {
  subGames: Record<
    string,
    {
      type: string;
      state: BaseGameState;
      // ルールセットそのものはシリアライズ性を保つためStateには保存せず、都度取得する
    }
  >;
  metaScores: Record<string, number>; // playerId -> 勝利数などのスコア
}

/**
 * メタレベルでのアクション
 */
export interface MetaGameAction extends BaseGameAction {
  // 特定のサブゲームに対するアクション
  subGameId?: string;
  subAction?: BaseGameAction;

  // メタゲーム固有のアクションが必要な場合はここに追加
  metaActionType?: "CREATE_SUBGAME" | "FINISH_META";
}

/**
 * メタゲームのルールセット。
 * ゲーム自体が他のゲームエンジン（ルールエンジン）を内包する構造を体現。
 */
export const MetaGameRuleset: GameRuleset<MetaGameState, MetaGameAction, any> = {
  getInitialState: (options?: any, rng?: IGameRNG): MetaGameState => {
    const state: MetaGameState = {
      status: "PLAYING",
      subGames: {},
      metaScores: {},
      players: options?.players || {},
      activePlayers: options?.activePlayers || [],
      message: "Meta-Game Started",
    };

    // 初期サブゲームの生成（オプションで指定された場合）
    if (options?.initialSubGames && options?.rulesetResolver) {
      for (const config of options.initialSubGames) {
        const ruleset = options.rulesetResolver(config.type);
        if (ruleset) {
          const subState = ruleset.getInitialState(config.options, rng);

          // メタゲームのプレイヤー情報をサブゲームに伝搬（必要に応じて）
          if (state.players) {
            subState.players = { ...subState.players, ...state.players };
          }

          state.subGames[config.id] = {
            type: config.type,
            state: subState,
          };
          state.subGames[config.id].state.status = "PLAYING";
        }
      }
    }

    return state;
  },

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;

    // サブゲームへのアクション委譲の場合
    if (action.subGameId && action.subAction) {
      const subGame = state.subGames[action.subGameId];
      if (!subGame) return false;

      // 本来は Registry から取得するが、プロトタイプとして options 等から
      // 解決できるように構成するか、実行時に動的に渡す必要がある
      // ここではプロトタイプ的な処理のため、一旦 true を返すかリゾルバを想定
      return true; // 詳細なバリデーションは reduce 内で行うか、メタ層で完結させる
    }

    return false;
  },

  reduce: (state, action, rng?: IGameRNG) => {
    const newState = structuredClone(state);

    // サブゲームへのアクション委譲
    if (action.subGameId && action.subAction) {
      const subGame = newState.subGames[action.subGameId];
      // 注意: 実際の運用では GameRegistry.getDefinition(subGame.type).ruleset を使用する
      // ここでは、アクションの送信元やエンジンの仕組みをメタ的に利用する

      // 仮のリゾルバ（テストコードなどで注入されることを想定）
      const ruleset = (action as any)._resolvedRuleset;

      if (ruleset) {
        // サブゲームの状態を更新
        subGame.state = ruleset.reduce(subGame.state, action.subAction, rng);

        // サブゲームの結果を確認
        const result: GameResult = ruleset.checkWinCondition(subGame.state);
        if (result.isFinished) {
          // サブゲームを終了状態にする
          if (ruleset.applyWinResult) {
            subGame.state = ruleset.applyWinResult(subGame.state, result);
          } else {
            subGame.state.status = "FINISHED";
          }

          // サブゲームの結果をメタスコアに反映
          if (result.winnerIds) {
            for (const winnerId of result.winnerIds) {
              newState.metaScores[winnerId] = (newState.metaScores[winnerId] || 0) + 1;
            }
          }

          newState.message = `Sub-game ${action.subGameId} finished. ${result.message}`;
        }
      }
    }

    return newState;
  },

  checkWinCondition: (state) => {
    // 例: スコアが一定値に達したら終了
    for (const [playerId, score] of Object.entries(state.metaScores)) {
      if (score >= 3) {
        return {
          isFinished: true,
          winnerIds: [playerId],
          message: `Player ${playerId} won the Meta-Game by reaching score 3!`,
        };
      }
    }

    // または全サブゲーム終了時
    const gameIds = Object.keys(state.subGames);
    const allFinished =
      gameIds.length > 0 && gameIds.every((id) => state.subGames[id].state.status === "FINISHED");

    if (allFinished) {
      // スコアの高い順に勝者を決定
      let maxScore = -1;
      let winners: string[] = [];
      for (const [pid, s] of Object.entries(state.metaScores)) {
        if (s > maxScore) {
          maxScore = s;
          winners = [pid];
        } else if (s === maxScore) {
          winners.push(pid);
        }
      }
      return {
        isFinished: true,
        winnerIds: winners,
        message: "Meta-Game Finished as all sub-games completed.",
      };
    }

    return { isFinished: false };
  },

  getLegalActions: (state, _playerId) => {
    const allActions: MetaGameAction[] = [];

    for (const [_id, subGame] of Object.entries(state.subGames)) {
      if (subGame.state.status !== "PLAYING") continue;

      // ここでも本来は Registry から Ruleset を取得して getLegalActions を呼ぶ
      // [...]
    }

    return allActions;
  },
};
