import type { GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";
import {
  BoardSpace,
  Board,
  BaseBoardState,
  BaseBoardPlayer,
  movePlayer,
  nextTurn,
} from "./SugorokuGameEngine";

// --- Types ---

export interface LifePlayer extends BaseBoardPlayer {
  money: number;
  job: string | null;
  isMarried: boolean;
  children: number;
}

export interface LifeState extends BaseBoardState {
  boardPlayers: Record<string, LifePlayer>; // Override with LifePlayer
  logs: string[];
  lastSpin: number | null;
}

export type LifeAction =
  | { type: "SPIN"; playerId: string }
  | { type: "CHOOSE_JOB"; playerId: string; job: string };

// --- Jobs ---

const JOBS: Record<string, { name: string; salary: number }> = {
  SALARYMAN: { name: "サラリーマン", salary: 200000 },
  DOCTOR: { name: "医者", salary: 500000 },
  ARTIST: { name: "芸術家", salary: 100000 },
  PILOT: { name: "パイロット", salary: 600000 },
};

// --- Board Definition ---

const createMoneySpace = (id: string, text: string, amount: number): BoardSpace<LifeState> => ({
  id,
  type: "MONEY",
  text,
  onStop: (state, playerId) => {
    const newState = { ...state };
    const player = newState.boardPlayers[playerId];
    player.money += amount;
    newState.logs.push(`${player.id}: ${text} (${amount >= 0 ? "+" : ""}${amount}円)`);
    return newState;
  },
});

const createPaydaySpace = (id: string, text: string): BoardSpace<LifeState> => ({
  id,
  type: "PAYDAY",
  text,
  onPass: (state, playerId) => {
    const newState = { ...state };
    const player = newState.boardPlayers[playerId];
    const salary = player.job ? JOBS[player.job].salary : 100000;
    player.money += salary;
    newState.logs.push(`${player.id}: 給料日！ (${salary}円)`);
    return newState;
  },
  onStop: (state, playerId) => {
    const newState = { ...state };
    const player = newState.boardPlayers[playerId];
    const salary = player.job ? JOBS[player.job].salary : 100000;
    player.money += salary;
    newState.logs.push(`${player.id}: ちょうど給料日に止まった！ (${salary}円)`);
    return newState;
  },
});

const SPACES: BoardSpace<LifeState>[] = [
  { id: "START", type: "START", text: "卒業" },
  createMoneySpace("S1", "バイトで稼いだ", 50000),
  createMoneySpace("S2", "宝くじに当たった！", 100000),
  {
    id: "JOB_HUNT",
    type: "JOB",
    text: "就職活動",
    mustStop: true,
    onStop: (state, playerId) => {
      const newState = { ...state };
      newState.logs.push(`${playerId}: 仕事を探している...`);
      // In a real game, this might trigger a sub-state or UI interaction.
      // For now, let's just assign a random job if they don't have one.
      const player = newState.boardPlayers[playerId];
      if (!player.job) {
        const jobKeys = Object.keys(JOBS);
        player.job = jobKeys[Math.floor(Math.random() * jobKeys.length)];
        newState.logs.push(`${playerId}: ${JOBS[player.job].name}になった！`);
      }
      return newState;
    },
  },
  createMoneySpace("S4", "高い服を買った", -30000),
  createPaydaySpace("P1", "給料日"),
  createMoneySpace("S6", "海外旅行に行った", -150000),
  {
    id: "MARRIAGE",
    type: "MARRIAGE",
    text: "結婚",
    mustStop: true,
    onStop: (state, playerId) => {
      const newState = { ...state };
      const player = newState.boardPlayers[playerId];
      if (!player.isMarried) {
        player.isMarried = true;
        player.money -= 50000; // Wedding costs
        newState.logs.push(`${playerId}: 結婚した！ (-50000円)`);
      }
      return newState;
    },
  },
  createMoneySpace("S8", "お祝いをもらった", 30000),
  createPaydaySpace("P2", "給料日"),
  createMoneySpace("S10", "家を買った", -500000),
  createMoneySpace("S11", "子供が生まれた", -20000),
  {
    id: "GOAL",
    type: "GOAL",
    text: "引退",
    onStop: (state, playerId) => {
      const newState = { ...state };
      newState.logs.push(`${playerId}: ゴール！引退します。`);
      return newState;
    },
  },
];

const LIFE_BOARD: Board<LifeState> = {
  spaces: SPACES,
  getNextSpaceId: (currentId) => {
    const idx = SPACES.findIndex((s) => s.id === currentId);
    if (idx >= 0 && idx < SPACES.length - 1) {
      return SPACES[idx + 1].id;
    }
    return null;
  },
};

// --- Ruleset ---

export const TheGameOfLifeRuleset: GameRuleset<LifeState, LifeAction> = {
  getInitialState: (options?: any, _rng?: IGameRNG): LifeState => {
    const playerIds = options?.playerIds || ["P1", "P2"];
    const boardPlayers: Record<string, LifePlayer> = {};

    playerIds.forEach((id: string) => {
      boardPlayers[id] = {
        id,
        position: "START",
        isFinished: false,
        money: 100000, // Initial money
        job: null,
        isMarried: false,
        children: 0,
      };
    });

    return {
      status: "WAITING",
      players: Object.fromEntries(playerIds.map((id: string) => [id, id])),
      activePlayers: playerIds.length > 0 ? [playerIds[0]] : [],
      boardPlayers,
      turnOrder: playerIds,
      currentPlayerIndex: 0,
      logs: ["ゲーム開始！"],
      lastSpin: null,
    };
  },

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;
    if (!state.activePlayers?.includes(action.playerId)) return false;

    if (action.type === "SPIN") {
      return !state.boardPlayers[action.playerId].isFinished;
    }

    return true;
  },

  reduce: (state, action, rng?: IGameRNG) => {
    let newState = JSON.parse(JSON.stringify(state)) as LifeState;

    if (action.type === "SPIN") {
      const spin = rng ? Math.floor(rng.nextFloat() * 10) + 1 : Math.floor(Math.random() * 10) + 1;
      newState.lastSpin = spin;
      newState.logs.push(`${action.playerId}: ルーレットの結果は ${spin}！`);

      newState = movePlayer(newState, action.playerId, spin, LIFE_BOARD);

      // Check if game should end
      const allFinished = Object.values(newState.boardPlayers).every((p) => p.isFinished);
      if (allFinished) {
        newState.status = "FINISHED";
        newState.activePlayers = [];
      } else {
        newState = nextTurn(newState);
      }
    }

    return newState;
  },

  checkWinCondition: (state) => {
    if (state.status === "FINISHED") {
      const players = Object.values(state.boardPlayers);
      // Sort by money descending
      players.sort((a, b) => b.money - a.money);
      const winner = players[0];
      return {
        isFinished: true,
        winnerIds: [winner.id],
        message: `ゲーム終了！優勝は ${winner.id} です。最終資産: ${winner.money}円`,
      };
    }
    return { isFinished: false };
  },

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") return [];
    if (!state.activePlayers?.includes(playerId)) return [];

    return [{ type: "SPIN", playerId }];
  },
};
