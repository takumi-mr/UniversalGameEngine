// packages/shared/rules/CaveDiveRuleset.ts
//
// 『掘るか、逃げるか』— 欲張るか降りるかを全員同時に秘密で決めるプッシュ・ユア・ラック。
//
// 進行（全 TOTAL_ROUNDS ラウンド）:
//   1. ラウンド開始: 山札を作り直し、全員が洞窟に入る。1 枚めくる
//   2. 洞窟に残っている全員が「残る / 逃げる」を秘密裏に同時選択（activePlayers = 未回答者）
//   3. 全員分が揃ったら一斉公開して精算
//        - 逃げた人: このラウンドの取り分（roundStash）を確定（bank）。
//          逃げたのが 1 人だけなら「道端」に溜まった端数（pathLeftover）も独り占め
//   4. 誰か残っていれば次の 1 枚をめくる
//        - 宝: 残っている人で山分け（端数は道端へ）
//        - 罠: このラウンド 2 枚目の同じ罠なら崩落 → 残っていた人はこのラウンドの取り分を全部失う
//   5. 全員が逃げる or 崩落でラウンド終了。TOTAL_ROUNDS 終了時に bank 最大の人が勝ち（同点は同時勝利）
//
// 松明（TORCH）: 1 ゲームに 1 回だけ、次にめくられるカードを自分だけ覗ける。使ったこと自体は全員に見える。
//
// エンジンの組み込み JOIN で着席し、ルールセットの START（2 人以上）で開始する。
// 制限時間は設けない（全員の選択が揃った時点で進む）。
import { requireRng } from "@engine/shared/utils/requireRng";
import { createSecret, type Secret } from "@engine/shared/GameRules";
import type { BaseGameState, BaseGameAction, GameRuleset } from "@engine/shared/GameRules";
import type { IGameRNG } from "@engine/shared/utils/IGameRNG";

// --- 1. 型定義 ---

export type TrapType = "SNAKE" | "SPIDER" | "ROCKFALL" | "FLOOD" | "FIRE";

export type CaveCard = { kind: "TREASURE"; value: number } | { kind: "TRAP"; trapType: TrapType };

export type CaveChoice = "STAY" | "LEAVE";

export interface CaveDiveState extends BaseGameState {
  playerIds: string[]; // 参加者（START 時点で確定）
  round: number; // 1 始まり。0 は未開始
  totalRounds: number;
  decisionTimeMs: number; // 分岐点ごとの制限時間（0 なら無制限）。締切は turnDeadline に入る

  deck: Secret<CaveCard[]>; // このラウンドの残り山札（誰にも見えない）
  path: CaveCard[]; // このラウンドでめくられたカード（公開）
  trapsSeenThisRound: TrapType[]; // このラウンドで既に出た罠の種類
  inCave: string[]; // このラウンドでまだ洞窟に残っている人
  roundStash: Record<string, number>; // 今ラウンドの、まだ確定していない取り分
  pathLeftover: number; // 山分けの端数が溜まった「道端」の宝（ラウンドをまたいで持ち越す）
  bank: Record<string, number>; // 確定済みの総取り分（スコア）

  choices: Record<string, Secret<CaveChoice>>; // 今回の分岐点での秘密の選択（未回答者は欠番）
  revealedChoices: Record<string, CaveChoice> | null; // 直前に公開された選択（ログ用）
  lastEvent: string | null; // 直前に起きたこと（ログ用）

  torchUsed: Record<string, boolean>; // 松明を使い切ったか（1 ゲーム 1 回）
  peek: Record<string, Secret<CaveCard>>; // 松明で覗いた次のカード（本人のみ。分岐点ごとにクリア）
}

export interface CaveDiveAction extends BaseGameAction {
  type: "JOIN" | "START" | "CHOOSE" | "TORCH" | "TIMEOUT"; // JOIN / TIMEOUT はエンジンの組み込み
  choice?: CaveChoice;
}

// --- 2. 定数 ---

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const TOTAL_ROUNDS = 5;
export const DEFAULT_DECISION_TIME_MS = 30_000;
export const TRAP_TYPES: TrapType[] = ["SNAKE", "SPIDER", "ROCKFALL", "FLOOD", "FIRE"];
const TRAP_COPIES = 3;
export const TREASURE_VALUES = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 7, 7, 9, 11, 14];

// --- 3. ヘルパー ---

function buildRoundDeck(rng?: IGameRNG): CaveCard[] {
  const cards: CaveCard[] = TREASURE_VALUES.map((value) => ({ kind: "TREASURE", value }));
  for (const trapType of TRAP_TYPES) {
    for (let i = 0; i < TRAP_COPIES; i++) cards.push({ kind: "TRAP", trapType });
  }
  // Fisher–Yates
  for (let i = cards.length - 1; i > 0; i--) {
    const j = requireRng(rng, "CaveDive").nextInt(0, i);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

const hiddenDeck = (cards: CaveCard[]) => createSecret(cards, [], { remaining: cards.length });

const seatedPlayers = (state: BaseGameState): string[] =>
  Object.values(state.players ?? {}).filter((p): p is string => typeof p === "string");

/** 分岐点の締切。時刻が分からない（テスト等）か制限時間 0 なら締切なし */
function deadlineFrom(state: CaveDiveState, now?: number): number | undefined {
  return now !== undefined && state.decisionTimeMs > 0 ? now + state.decisionTimeMs : undefined;
}

/** ラウンドを開始し、最初の 1 枚をめくる */
function beginRound(
  state: CaveDiveState,
  round: number,
  rng?: IGameRNG,
  now?: number,
): CaveDiveState {
  const inCave = [...state.playerIds];
  const reset: CaveDiveState = {
    ...state,
    round,
    deck: hiddenDeck(buildRoundDeck(rng)),
    path: [],
    trapsSeenThisRound: [],
    inCave,
    roundStash: Object.fromEntries(inCave.map((p) => [p, 0])),
    choices: {},
    revealedChoices: null,
    peek: {},
    activePlayers: inCave,
    lastEvent: state.lastEvent
      ? `${state.lastEvent} → ラウンド ${round} 開始`
      : `ラウンド ${round} 開始`,
  };
  return drawCard(reset, rng, now);
}

/** 次の 1 枚をめくって精算し、分岐点（全員の選択待ち）に入る。ラウンドが終われば次へ */
function drawCard(state: CaveDiveState, rng?: IGameRNG, now?: number): CaveDiveState {
  if (state.inCave.length === 0) return finishRound(state, rng, now);

  const deck = [...state.deck.value];
  if (deck.length === 0) {
    // 山札切れ（30 枚あるのでまず起きない）: 残っている人の取り分を確定してラウンド終了
    const bank = { ...state.bank };
    for (const p of state.inCave) bank[p] += state.roundStash[p];
    return finishRound(
      {
        ...state,
        bank,
        roundStash: Object.fromEntries(state.playerIds.map((p) => [p, 0])),
        inCave: [],
        lastEvent: "山札が尽きた。残っていた全員が宝を持ち帰った",
      },
      rng,
      now,
    );
  }

  const card = deck.pop()!;
  const next: CaveDiveState = {
    ...state,
    deck: hiddenDeck(deck),
    path: [...state.path, card],
    choices: {},
    peek: {},
  };

  if (card.kind === "TREASURE") {
    const numIn = state.inCave.length;
    const share = Math.floor(card.value / numIn);
    const remainder = card.value % numIn;
    const roundStash = { ...state.roundStash };
    for (const p of state.inCave) roundStash[p] += share;
    return {
      ...next,
      roundStash,
      pathLeftover: state.pathLeftover + remainder,
      activePlayers: state.inCave,
      turnDeadline: deadlineFrom(state, now),
      lastEvent: `宝 ${card.value}: 1 人 ${share}（端数 ${remainder} は道端へ）`,
    };
  }

  if (state.trapsSeenThisRound.includes(card.trapType)) {
    // 崩落: 残っている全員がこのラウンドの取り分を失う
    const roundStash = { ...state.roundStash };
    for (const p of state.inCave) roundStash[p] = 0;
    return finishRound(
      {
        ...next,
        trapsSeenThisRound: [...state.trapsSeenThisRound, card.trapType],
        roundStash,
        inCave: [],
        lastEvent: `${card.trapType} が 2 枚目！ 崩落。残っていた ${state.inCave.length} 人は手ぶらで脱出`,
      },
      rng,
      now,
    );
  }

  return {
    ...next,
    trapsSeenThisRound: [...state.trapsSeenThisRound, card.trapType],
    activePlayers: state.inCave,
    turnDeadline: deadlineFrom(state, now),
    lastEvent: `罠 ${card.trapType}（1 枚目）。次に同じ罠が出たら崩落`,
  };
}

/** 全員の選択が揃った: 一斉公開して逃げた人を精算し、続きをめくる */
function resolveChoices(state: CaveDiveState, rng?: IGameRNG, now?: number): CaveDiveState {
  const revealed: Record<string, CaveChoice> = {};
  for (const p of state.inCave) revealed[p] = state.choices[p].value;

  const leavers = state.inCave.filter((p) => revealed[p] === "LEAVE");
  const bank = { ...state.bank };
  const roundStash = { ...state.roundStash };
  let pathLeftover = state.pathLeftover;

  for (const p of leavers) {
    bank[p] += roundStash[p];
    roundStash[p] = 0;
  }
  let event = leavers.length === 0 ? "全員が残った" : `${leavers.join(", ")} が逃げた`;
  if (leavers.length === 1 && pathLeftover > 0) {
    bank[leavers[0]] += pathLeftover;
    event += `（道端の ${pathLeftover} も独り占め）`;
    pathLeftover = 0;
  }

  const inCave = state.inCave.filter((p) => !leavers.includes(p));
  const resolved: CaveDiveState = {
    ...state,
    bank,
    roundStash,
    pathLeftover,
    inCave,
    choices: {},
    revealedChoices: revealed,
    lastEvent: event,
  };
  return drawCard(resolved, rng, now);
}

/** ラウンド終了。最終ラウンドなら終局（checkWinCondition が拾う）、そうでなければ次のラウンドへ */
function finishRound(state: CaveDiveState, rng?: IGameRNG, now?: number): CaveDiveState {
  if (state.round >= state.totalRounds) {
    return {
      ...state,
      inCave: [],
      activePlayers: [],
      choices: {},
      peek: {},
      turnDeadline: undefined,
    };
  }
  return beginRound(state, state.round + 1, rng, now);
}

// --- 4. ルールセット本体 ---

export const CaveDiveRuleset: GameRuleset<CaveDiveState, CaveDiveAction> = {
  getInitialState: (
    options?: { playerIds?: string[]; decisionTimeMs?: number },
    _rng?: IGameRNG,
  ): CaveDiveState => {
    const playerIds = (options?.playerIds ?? []).filter(Boolean).slice(0, MAX_PLAYERS);
    const players: Record<string, string | null> = {};
    for (let i = 0; i < MAX_PLAYERS; i++) players[String(i)] = playerIds[i] ?? null;

    // playerIds が渡されていれば着席済みとして扱う（開始は START）
    return {
      status: "WAITING",
      players,
      activePlayers: [],
      playerIds: [],
      round: 0,
      totalRounds: TOTAL_ROUNDS,
      decisionTimeMs:
        typeof options?.decisionTimeMs === "number" && options.decisionTimeMs >= 0
          ? options.decisionTimeMs
          : DEFAULT_DECISION_TIME_MS,
      deck: hiddenDeck([]),
      path: [],
      trapsSeenThisRound: [],
      inCave: [],
      roundStash: {},
      pathLeftover: 0,
      bank: {},
      choices: {},
      revealedChoices: null,
      lastEvent: null,
      torchUsed: {},
      peek: {},
    };
  },

  isValidAction: (state, action) => {
    if (action.type === "START") {
      return state.status === "WAITING" && seatedPlayers(state).length >= MIN_PLAYERS;
    }

    if (state.status !== "PLAYING") return false;
    const pId = action.playerId;
    if (!pId || !state.inCave.includes(pId)) return false;
    if (state.choices[pId]) return false; // この分岐点では選択済み

    if (action.type === "TORCH") {
      return !state.torchUsed[pId] && !state.peek[pId] && state.deck.value.length > 0;
    }
    if (action.type === "CHOOSE") {
      return action.choice === "STAY" || action.choice === "LEAVE";
    }
    return false;
  },

  reduce: (state, action, rng) => {
    if (action.type === "START") {
      const playerIds = seatedPlayers(state);
      // 開始後の飛び入りを防ぐため空席は閉じる
      const players: Record<string, string | null> = {};
      for (const [slot, id] of Object.entries(state.players ?? {})) {
        if (id !== null) players[slot] = id;
      }
      return beginRound(
        {
          ...state,
          status: "PLAYING",
          players,
          playerIds,
          bank: Object.fromEntries(playerIds.map((p) => [p, 0])),
          torchUsed: Object.fromEntries(playerIds.map((p) => [p, false])),
          pathLeftover: 0,
        },
        1,
        rng,
        action.timestamp,
      );
    }

    const pId = action.playerId!;

    if (action.type === "TORCH") {
      const deck = state.deck.value;
      const nextCard = deck[deck.length - 1];
      return {
        ...state,
        torchUsed: { ...state.torchUsed, [pId]: true },
        peek: { ...state.peek, [pId]: createSecret(nextCard, [pId], "?") },
        lastEvent: `${pId} が松明で次のカードを覗いた`,
      };
    }

    if (action.type === "CHOOSE") {
      const choices = { ...state.choices, [pId]: createSecret(action.choice!, [pId], "?") };
      const waiting = state.inCave.filter((p) => !choices[p]);
      if (waiting.length > 0) {
        return { ...state, choices, activePlayers: waiting };
      }
      return resolveChoices({ ...state, choices }, rng, action.timestamp);
    }

    return state;
  },

  checkWinCondition: (state) => {
    if (state.status === "WAITING") return { isFinished: false };
    if (state.round < state.totalRounds || state.inCave.length > 0) return { isFinished: false };

    const best = Math.max(...state.playerIds.map((p) => state.bank[p] ?? 0));
    const winnerIds = state.playerIds.filter((p) => (state.bank[p] ?? 0) === best);
    const summary = state.playerIds.map((p) => `${p}: ${state.bank[p] ?? 0}`).join(", ");
    return {
      isFinished: true,
      winnerIds,
      message:
        winnerIds.length > 1
          ? `引き分け！ ${winnerIds.join(", ")}（${summary}）`
          : `${winnerIds[0]} の勝利！（${summary}）`,
    };
  },

  // 制限時間切れ: まだ選んでいない人は「逃げる」扱い（安全側）
  getTimeoutAction: (state, playerId) =>
    state.inCave.includes(playerId) && !state.choices[playerId]
      ? { type: "CHOOSE", playerId, choice: "LEAVE" }
      : null,

  getLegalActions: (state, playerId) => {
    if (state.status === "WAITING") {
      const seated = seatedPlayers(state);
      return seated.length >= MIN_PLAYERS && seated.includes(playerId)
        ? [{ type: "START", playerId }]
        : [];
    }
    if (state.status !== "PLAYING") return [];
    if (!state.inCave.includes(playerId) || state.choices[playerId]) return [];

    const actions: CaveDiveAction[] = [
      { type: "CHOOSE", playerId, choice: "STAY" },
      { type: "CHOOSE", playerId, choice: "LEAVE" },
    ];
    if (!state.torchUsed[playerId] && !state.peek[playerId] && state.deck.value.length > 0) {
      actions.push({ type: "TORCH", playerId });
    }
    return actions;
  },
};
