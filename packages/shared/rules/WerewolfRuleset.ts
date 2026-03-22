// packages/shared/rules/WerewolfRuleset.ts
import { createSecret, type Secret } from "../GameRules";
import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";

// --- 型定義 ---

/** 役職 */
export type WerewolfRole = "villager" | "werewolf" | "seer" | "guard" | "medium";

/** 陣営 */
export type WerewolfTeam = "village" | "werewolf";

/** ゲームフェーズ */
export type WerewolfPhase =
  | "NIGHT_ACTION" // 夜：各役職のアクション
  | "DAY_DISCUSSION" // 昼：議論（全員がスキップでVOTEへ）
  | "DAY_VOTE" // 昼：処刑対象の投票
  | "DAY_VOTE_RESULT"; // 昼：投票結果発表→次の夜へ

/** 死亡情報 */
export interface DeadPlayer {
  playerId: string;
  role: WerewolfRole;
  cause: "attacked" | "executed";
  day: number;
}

/** 夜の行動 */
export interface NightAction {
  role: WerewolfRole;
  target: string;
}

/** 前夜の結果（公開情報） */
export interface NightResult {
  attackedPlayerId: string | null; // 襲撃で死亡したプレイヤー（護衛成功なら null）
  guardSuccess: boolean; // 護衛が成功したか
}

/** 占い結果 */
export interface SeerResult {
  day: number;
  target: string;
  team: WerewolfTeam;
}

/** 霊媒結果 */
export interface MediumResult {
  day: number;
  target: string;
  team: WerewolfTeam;
}

/** ゲーム状態 */
export interface WerewolfState extends BaseGameState {
  playerIds: string[];
  roles: Record<string, Secret<WerewolfRole>>;
  phase: WerewolfPhase;
  day: number;
  alivePlayers: string[];
  deadPlayers: DeadPlayer[];

  // 夜のアクション（全員がアクションするまで秘匿）
  nightActions: Secret<Record<string, NightAction>>;

  // 投票
  votes: Record<string, string>;

  // 前夜の結果
  lastNightResult: NightResult | null;

  // 占い師の結果履歴（占い師本人のみ閲覧可）
  seerResults: Record<string, Secret<SeerResult[]>>;

  // 霊媒師の結果履歴（霊媒師本人のみ閲覧可）
  mediumResults: Record<string, Secret<MediumResult[]>>;

  // 直前に処刑されたプレイヤー
  lastExecutedPlayerId: string | null;

  // 前夜の護衛対象（連続護衛禁止用）
  lastGuardTarget: string | null;
}

/** アクション */
export interface WerewolfAction extends BaseGameAction {
  type: "NIGHT_ACTION" | "VOTE" | "SKIP_DISCUSSION";
  target?: string;
}

// --- ヘルパー関数 ---

/** 役職から陣営を取得 */
export function getTeam(role: WerewolfRole): WerewolfTeam {
  return role === "werewolf" ? "werewolf" : "village";
}

/** プレイヤー数に応じた役職配分を決定 */
function assignRoles(playerIds: string[], rng?: IGameRNG): Record<string, WerewolfRole> {
  const n = playerIds.length;
  const roles: WerewolfRole[] = [];

  // 人狼の数を決定（5-7人: 1人、8-11人: 2人、12人以上: 3人）
  let werewolfCount: number;
  if (n <= 7) {
    werewolfCount = 1;
  } else if (n <= 11) {
    werewolfCount = 2;
  } else {
    werewolfCount = 3;
  }

  // 必須役職を追加
  for (let i = 0; i < werewolfCount; i++) {
    roles.push("werewolf");
  }
  roles.push("seer"); // 占い師は必須

  // 人数に余裕があれば追加役職
  if (n >= 6) roles.push("guard"); // 騎士
  if (n >= 7) roles.push("medium"); // 霊媒師

  // 残りは村人で埋める
  while (roles.length < n) {
    roles.push("villager");
  }

  // シャッフル（Fisher-Yates）
  for (let i = roles.length - 1; i > 0; i--) {
    const j = rng ? rng.nextInt(0, i) : Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  // プレイヤーに割り当て
  const assignment: Record<string, WerewolfRole> = {};
  for (let i = 0; i < playerIds.length; i++) {
    assignment[playerIds[i]] = roles[i];
  }
  return assignment;
}

/** 夜のアクションが必要な役職かどうか */
function needsNightAction(role: WerewolfRole, isAlive: boolean): boolean {
  if (!isAlive) return false;
  return role === "werewolf" || role === "seer" || role === "guard";
}

/** 夜のアクションが全て揃ったか判定 */
function allNightActionsCollected(state: WerewolfState): boolean {
  const actions = state.nightActions.value;
  for (const pId of state.alivePlayers) {
    const role = state.roles[pId].value;
    if (needsNightAction(role, true) && !actions[pId]) {
      return false;
    }
  }
  return true;
}

/** 全投票が揃ったか判定 */
function allVotesCollected(state: WerewolfState): boolean {
  for (const pId of state.alivePlayers) {
    if (!state.votes[pId]) return false;
  }
  return true;
}

/** 人狼プレイヤーIDリストを取得 */
function _getWerewolfIds(state: WerewolfState): string[] {
  return state.playerIds.filter((id) => state.roles[id].value === "werewolf");
}

/** 投票結果から最多票のプレイヤーを決定（同率なら先頭を選択） */
function resolveVote(votes: Record<string, string>): string | null {
  const tally: Record<string, number> = {};
  for (const target of Object.values(votes)) {
    tally[target] = (tally[target] || 0) + 1;
  }

  let maxVotes = 0;
  let maxTargets: string[] = [];
  for (const [target, count] of Object.entries(tally)) {
    if (count > maxVotes) {
      maxVotes = count;
      maxTargets = [target];
    } else if (count === maxVotes) {
      maxTargets.push(target);
    }
  }

  // 同数の場合は最初の候補を選択（簡略化）
  return maxTargets.length > 0 ? maxTargets[0] : null;
}

/** 夜のアクションを解決し、結果を返す */
function resolveNightActions(state: WerewolfState): {
  nightResult: NightResult;
  newSeerResults: Record<string, SeerResult>;
  newMediumResults: Record<string, MediumResult>;
} {
  const actions = state.nightActions.value;

  // 人狼の襲撃対象を決定（複数人狼がいる場合は最初の人狼のターゲットを採用）
  let attackTarget: string | null = null;
  for (const pId of state.alivePlayers) {
    if (state.roles[pId].value === "werewolf" && actions[pId]) {
      attackTarget = actions[pId].target;
      break;
    }
  }

  // 騎士の護衛対象
  let guardTarget: string | null = null;
  for (const pId of state.alivePlayers) {
    if (state.roles[pId].value === "guard" && actions[pId]) {
      guardTarget = actions[pId].target;
    }
  }

  // 護衛成功判定
  const guardSuccess = attackTarget !== null && attackTarget === guardTarget;
  const attackedPlayerId = guardSuccess ? null : attackTarget;

  // 占い師の結果
  const newSeerResults: Record<string, SeerResult> = {};
  for (const pId of state.alivePlayers) {
    if (state.roles[pId].value === "seer" && actions[pId]) {
      const target = actions[pId].target;
      newSeerResults[pId] = {
        day: state.day,
        target,
        team: getTeam(state.roles[target].value),
      };
    }
  }

  // 霊媒師の結果（前日に処刑されたプレイヤーの陣営）
  const newMediumResults: Record<string, MediumResult> = {};
  if (state.lastExecutedPlayerId) {
    for (const pId of state.alivePlayers) {
      if (state.roles[pId].value === "medium") {
        newMediumResults[pId] = {
          day: state.day,
          target: state.lastExecutedPlayerId,
          team: getTeam(state.roles[state.lastExecutedPlayerId].value),
        };
      }
    }
  }

  return {
    nightResult: { attackedPlayerId, guardSuccess },
    newSeerResults,
    newMediumResults,
  };
}

// --- ルールセット本体 ---

export const WerewolfRuleset: GameRuleset<WerewolfState, WerewolfAction> = {
  getInitialState: (options: any, rng?: IGameRNG): WerewolfState => {
    const opts = options || {};
    const playerIds: string[] = (opts.playerIds || []).filter((id: any) => !!id);

    // 役職配分
    const rawRoles = playerIds.length > 0 ? assignRoles(playerIds, rng) : {};

    // 人狼同士は互いの役職を見られる
    const werewolfIds = playerIds.filter((id) => rawRoles[id] === "werewolf");

    // Secret化: 各プレイヤーは自分の役職のみ見える。人狼同士は見えるようにする。
    const roles: Record<string, Secret<WerewolfRole>> = {};
    for (const pId of playerIds) {
      const visibleTo = [pId]; // 自分は必ず見える
      if (rawRoles[pId] === "werewolf") {
        // 他の人狼も見える
        for (const wId of werewolfIds) {
          if (wId !== pId && !visibleTo.includes(wId)) {
            visibleTo.push(wId);
          }
        }
      }
      roles[pId] = createSecret(rawRoles[pId], visibleTo, "unknown");
    }

    // プレイヤースロットの設定
    const players: Record<string, string | null> =
      playerIds.length > 0
        ? playerIds.reduce(
            (acc, p, i) => ({ ...acc, [String(i + 1)]: p }),
            {} as Record<string, string | null>,
          )
        : Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i + 1), null]));

    // 夜のアクションを収集する対象
    const nightActionPlayers = playerIds.filter((pId) => needsNightAction(rawRoles[pId], true));

    return {
      status: "WAITING",
      players,
      activePlayers: nightActionPlayers,
      playerIds,
      roles,
      phase: "NIGHT_ACTION",
      day: 1,
      alivePlayers: [...playerIds],
      deadPlayers: [],
      nightActions: createSecret({}, [], {}),
      votes: {},
      lastNightResult: null,
      seerResults: {},
      mediumResults: {},
      lastExecutedPlayerId: null,
      lastGuardTarget: null,
    };
  },

  isValidAction: (state: WerewolfState, action: WerewolfAction): boolean => {
    if (state.status !== "PLAYING") return false;

    const pId = action.playerId;
    if (!pId) return false;

    // 死者は行動できない
    if (!state.alivePlayers.includes(pId)) return false;

    switch (action.type) {
      case "NIGHT_ACTION": {
        if (state.phase !== "NIGHT_ACTION") return false;
        if (!action.target) return false;

        const role = state.roles[pId].value;

        // 夜のアクションが必要な役職のみ
        if (!needsNightAction(role, true)) return false;

        // 既にアクション済み
        if (state.nightActions.value[pId]) return false;

        const target = action.target;

        // ターゲットが生存者であること
        if (!state.alivePlayers.includes(target)) return false;

        // 役職ごとのバリデーション
        if (role === "werewolf") {
          // 人狼は人狼を襲撃できない
          if (state.roles[target].value === "werewolf") return false;
        } else if (role === "seer") {
          // 占い師は自分を占えない
          if (target === pId) return false;
        } else if (role === "guard") {
          // 騎士は自分を護衛できない
          if (target === pId) return false;
          // 連続護衛禁止
          if (state.lastGuardTarget === target) return false;
        }

        return true;
      }

      case "VOTE": {
        if (state.phase !== "DAY_VOTE") return false;
        if (!action.target) return false;

        // 既に投票済み
        if (state.votes[pId]) return false;

        // ターゲットが生存者であること
        if (!state.alivePlayers.includes(action.target)) return false;

        // 自分自身への投票も許可（人狼ゲームでは可能）
        return true;
      }

      case "SKIP_DISCUSSION": {
        if (state.phase !== "DAY_DISCUSSION") return false;
        return true;
      }

      default:
        return false;
    }
  },

  reduce: (state: WerewolfState, action: WerewolfAction, _rng?: IGameRNG): WerewolfState => {
    const newState = structuredClone(state);
    const pId = action.playerId!;

    switch (action.type) {
      case "NIGHT_ACTION": {
        const role = newState.roles[pId].value;

        // アクションを記録
        newState.nightActions.value[pId] = {
          role,
          target: action.target!,
        };

        // アクティブプレイヤーから除外
        newState.activePlayers = newState.activePlayers?.filter((id) => id !== pId) || [];

        // 全員のアクションが揃ったら夜を解決
        if (allNightActionsCollected(newState)) {
          const { nightResult, newSeerResults, newMediumResults } = resolveNightActions(newState);

          // 夜の結果を記録
          newState.lastNightResult = nightResult;

          // 襲撃による死亡処理
          if (nightResult.attackedPlayerId) {
            const deadId = nightResult.attackedPlayerId;
            newState.alivePlayers = newState.alivePlayers.filter((id) => id !== deadId);
            newState.deadPlayers.push({
              playerId: deadId,
              role: newState.roles[deadId].value,
              cause: "attacked",
              day: newState.day,
            });
          }

          // 占い結果を更新
          for (const [seerId, result] of Object.entries(newSeerResults)) {
            if (!newState.seerResults[seerId]) {
              newState.seerResults[seerId] = createSecret([], [seerId], []);
            }
            newState.seerResults[seerId].value.push(result);
          }

          // 霊媒結果を更新
          for (const [mediumId, result] of Object.entries(newMediumResults)) {
            if (!newState.mediumResults[mediumId]) {
              newState.mediumResults[mediumId] = createSecret([], [mediumId], []);
            }
            newState.mediumResults[mediumId].value.push(result);
          }

          // 騎士の護衛対象を記録（連続護衛禁止用）
          for (const id of newState.alivePlayers) {
            if (newState.roles[id].value === "guard" && newState.nightActions.value[id]) {
              newState.lastGuardTarget = newState.nightActions.value[id].target;
            }
          }

          // 昼の議論フェーズへ
          newState.phase = "DAY_DISCUSSION";
          newState.activePlayers = [...newState.alivePlayers];
          newState.nightActions = createSecret({}, [], {});
        }

        break;
      }

      case "SKIP_DISCUSSION": {
        // アクティブプレイヤーから除外
        newState.activePlayers = newState.activePlayers?.filter((id) => id !== pId) || [];

        // 全員がスキップしたら投票フェーズへ
        if (newState.activePlayers.length === 0) {
          newState.phase = "DAY_VOTE";
          newState.activePlayers = [...newState.alivePlayers];
          newState.votes = {};
        }
        break;
      }

      case "VOTE": {
        // 投票を記録
        newState.votes[pId] = action.target!;

        // アクティブプレイヤーから除外
        newState.activePlayers = newState.activePlayers?.filter((id) => id !== pId) || [];

        // 全員の投票が揃ったら処刑実行
        if (allVotesCollected(newState)) {
          const executedId = resolveVote(newState.votes);

          if (executedId) {
            // 処刑
            newState.alivePlayers = newState.alivePlayers.filter((id) => id !== executedId);
            newState.deadPlayers.push({
              playerId: executedId,
              role: newState.roles[executedId].value,
              cause: "executed",
              day: newState.day,
            });
            newState.lastExecutedPlayerId = executedId;
          } else {
            newState.lastExecutedPlayerId = null;
          }

          // 投票結果発表フェーズへ
          newState.phase = "DAY_VOTE_RESULT";
          newState.activePlayers = [];

          // 勝利条件チェックを行うために一旦状態を返す
          // エンジン側が checkWinCondition を呼ぶ。
          // 未決着なら次の夜へ遷移させる
          const winCheck = WerewolfRuleset.checkWinCondition(newState);
          if (!winCheck.isFinished) {
            // 次の夜へ
            newState.day += 1;
            newState.phase = "NIGHT_ACTION";
            newState.votes = {};
            newState.lastNightResult = null;

            // 夜のアクションが必要なプレイヤーをアクティブに
            const nightPlayers = newState.alivePlayers.filter((id) =>
              needsNightAction(newState.roles[id].value, true),
            );
            newState.activePlayers = nightPlayers;
          }
        }

        break;
      }
    }

    return newState;
  },

  checkWinCondition: (state: WerewolfState) => {
    const aliveWerewolves = state.alivePlayers.filter((id) => state.roles[id].value === "werewolf");
    const aliveVillagers = state.alivePlayers.filter((id) => state.roles[id].value !== "werewolf");

    // 人狼が全員処刑されたら村人陣営の勝利
    if (aliveWerewolves.length === 0) {
      return {
        isFinished: true,
        winnerIds: state.playerIds.filter((id) => getTeam(state.roles[id].value) === "village"),
        message: "村人陣営の勝利！全ての人狼が処刑されました。",
      };
    }

    // 人狼の数が村人陣営以上になったら人狼陣営の勝利
    if (aliveWerewolves.length >= aliveVillagers.length) {
      return {
        isFinished: true,
        winnerIds: state.playerIds.filter((id) => getTeam(state.roles[id].value) === "werewolf"),
        message: "人狼陣営の勝利！人狼が村を支配しました。",
      };
    }

    return { isFinished: false };
  },

  applyWinResult: (state, winResult) => {
    const newState = structuredClone(state);
    newState.status = "FINISHED";
    newState.activePlayers = [];
    newState.message = winResult.message ?? "ゲーム終了";

    // ゲーム終了時に全員の役職を公開
    for (const pId of newState.playerIds) {
      newState.roles[pId] = createSecret(
        newState.roles[pId].value,
        ["*"], // 全員に公開
        undefined,
      );
    }

    return newState;
  },

  getLegalActions: (state: WerewolfState, playerId: string): WerewolfAction[] => {
    if (state.status !== "PLAYING") return [];
    if (!state.alivePlayers.includes(playerId)) return [];
    if (!state.activePlayers?.includes(playerId)) return [];

    const actions: WerewolfAction[] = [];

    switch (state.phase) {
      case "NIGHT_ACTION": {
        const role = state.roles[playerId].value;
        if (!needsNightAction(role, true)) break;

        // 各ターゲット候補に対してアクションを生成
        for (const targetId of state.alivePlayers) {
          const action: WerewolfAction = {
            type: "NIGHT_ACTION",
            target: targetId,
            playerId,
          };
          if (WerewolfRuleset.isValidAction(state, action)) {
            actions.push(action);
          }
        }
        break;
      }

      case "DAY_DISCUSSION": {
        actions.push({ type: "SKIP_DISCUSSION", playerId });
        break;
      }

      case "DAY_VOTE": {
        for (const targetId of state.alivePlayers) {
          const action: WerewolfAction = {
            type: "VOTE",
            target: targetId,
            playerId,
          };
          if (WerewolfRuleset.isValidAction(state, action)) {
            actions.push(action);
          }
        }
        break;
      }
    }

    return actions;
  },
};
