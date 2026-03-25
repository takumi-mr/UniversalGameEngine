// packages/shared/rules/NovelRuleset.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";
import { ScenarioEngine, type ScenarioNode } from "../utils/ScenarioEngine";

/**
 * ノベルゲームの状態
 */
export interface NovelState extends BaseGameState {
  currentNodeId: string;
  flags: Record<string, any>;
  scenario: Record<string, ScenarioNode>;
}

/**
 * ノベルゲームのアクション
 */
export interface NovelAction extends BaseGameAction {
  type: "NEXT" | "SELECT";
  choiceIndex?: number;
}

/**
 * ノベルゲーム用ルールセット
 * シナリオデータを解釈し、状態を遷移させる
 */
export const NovelRuleset: GameRuleset<NovelState, NovelAction, any> = {
  getInitialState: (options?: any, _rng?: IGameRNG): NovelState => {
    const scenario = options?.scenario || {
      start: { type: "text", text: "No scenario provided." },
    };
    const startNodeId = options?.startNodeId || "start";
    const initialFlags = options?.initialFlags || {};

    return {
      status: "PLAYING",
      currentNodeId: startNodeId,
      flags: initialFlags,
      scenario,
      players: options?.players || {},
      activePlayers: Object.values(options?.players || {}).filter((v) => !!v) as string[],
      message: "Novel Game Started",
    };
  },

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;

    const node = state.scenario[state.currentNodeId];
    if (!node) return false;

    if (action.type === "NEXT" && node.type === "text") return true;
    if (action.type === "SELECT" && node.type === "choice") {
      return (
        action.choiceIndex !== undefined &&
        node.choices !== undefined &&
        node.choices[action.choiceIndex] !== undefined
      );
    }

    return false;
  },

  reduce: (state, action, _rng?: IGameRNG) => {
    const newState = structuredClone(state);
    const engine = new ScenarioEngine(newState.scenario);

    let actionValue: string | null = null;
    if (action.type === "SELECT") {
      const node = state.scenario[state.currentNodeId];
      if (node.type === "choice" && action.choiceIndex !== undefined) {
        actionValue = node.choices[action.choiceIndex].text;
      }
    }

    // 次のステップへ
    const { nextNodeId, nextFlags, isFinished } = engine.step(
      state.currentNodeId,
      actionValue,
      state.flags,
    );

    newState.currentNodeId = nextNodeId;
    newState.flags = nextFlags;

    if (isFinished) {
      newState.status = "FINISHED";
      const finalNode = newState.scenario[nextNodeId];
      newState.message = finalNode && finalNode.type === "end" ? finalNode.message : "The End";
    }

    return newState;
  },

  checkWinCondition: (state) => {
    if (state.status === "FINISHED") {
      return {
        isFinished: true,
        winnerIds: Object.values(state.players || {}).filter((v) => !!v) as string[],
        message: state.message,
      };
    }
    return { isFinished: false };
  },

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") return [];

    const node = state.scenario[state.currentNodeId];
    if (!node) return [];

    if (node.type === "text") {
      return [{ type: "NEXT", playerId }];
    }
    if (node.type === "choice") {
      return node.choices.map((_, index) => ({
        type: "SELECT",
        choiceIndex: index,
        playerId,
      }));
    }

    return [];
  },
};
