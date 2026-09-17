// packages/shared/rules/TexasHoldemRuleset.ts
//
// テキサスホールデム（1 ハンド完結）
// - JOIN で着席し、START で配札・ブラインド投入（プリフロップ）から始まる
// - PRE_FLOP → FLOP(3枚) → TURN(1枚) → RIVER(1枚) → SHOWDOWN の 4 ベッティングラウンド
// - ブラインド、ミニマムレイズ、オールイン（不足分コール / ショートオールインは再オープンしない）、サイドポットに対応
// - ショーダウンでは手札 2 枚 + コミュニティ 5 枚から最強の 5 枚で役を比較する。残り 1 人になれば即終了
import { requireRng } from "../utils/requireRng";
import { createSecret, type Secret } from "../GameRules";
import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";
import { compareHandRanks, evaluateBestHand, type HandRank } from "./PokerHandEvaluator";

// --- 1. 型定義 ---

export type TexasHoldemPhase = "PRE_FLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN";

export interface TexasHoldemShowdownEntry {
  playerId: string;
  handName: string;
  bestCards: string[];
}

export interface TexasHoldemResult {
  reason: "FOLD" | "SHOWDOWN";
  /** 最強の役（フォールド勝ちなら残った 1 人） */
  winnerIds: string[];
  /** 各プレイヤーがポットから受け取った額（サイドポット含む） */
  payouts: Record<string, number>;
  /** ショーダウンに参加したプレイヤーの役 */
  showdown?: TexasHoldemShowdownEntry[];
}

export interface TexasHoldemState extends BaseGameState {
  deck: Secret<string[]>; // 山札
  communityCards: string[]; // コミュニティカード (フロップ、ターン、リバー)
  hands: Record<string, Secret<string[]>>; // 各プレイヤーの手札（ショーダウンで残った人の分は公開される）
  pot: number; // ポット総額（未精算分）
  currentBet: number; // 現在のラウンドでの最高ベット額
  minRaise: number; // 現在のミニマムレイズ幅（直前のフルレイズ幅、初期値はビッグブラインド）
  playerBets: Record<string, number>; // このラウンドで各プレイヤーがベットした額
  totalBets: Record<string, number>; // このハンド全体で各プレイヤーがポットに入れた額（サイドポット計算用）
  playerChips: Record<string, number>; // 各プレイヤーの所持チップ
  foldedPlayers: string[]; // フォールドしたプレイヤー
  allInPlayers: string[]; // オールインしたプレイヤー
  actedPlayers: string[]; // 直前のフルレイズ以降にこのラウンドで行動済みのプレイヤー（ラウンド終了判定・再レイズ可否）
  phase: TexasHoldemPhase;
  dealerIndex: number; // ディーラー（ボタン）の playerIds 上のインデックス
  playerIds: string[]; // 参加プレイヤーの席順
  smallBlind: number;
  bigBlind: number;
  initialChips: number; // 開始時に各プレイヤーへ配るチップ
  result: TexasHoldemResult | null; // ハンド終了時の精算結果
}

export interface TexasHoldemAction extends BaseGameAction {
  type: "JOIN" | "START" | "FOLD" | "CHECK" | "CALL" | "RAISE"; // JOIN はエンジンの組み込み
  /** RAISE: 現在の最高ベット額に上乗せする額（コール分は含まない） */
  amount?: number;
}

export interface TexasHoldemOptions {
  playerIds?: string[];
  initialChips?: number;
  smallBlind?: number;
  bigBlind?: number;
  dealerIndex?: number;
}

// --- 2. 定数 ---

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const DEFAULT_INITIAL_CHIPS = 1000;
export const DEFAULT_SMALL_BLIND = 10;
export const DEFAULT_BIG_BLIND = 20;

const PHASE_ORDER: TexasHoldemPhase[] = ["PRE_FLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"];
const CARDS_DEALT_ON_ENTER: Partial<Record<TexasHoldemPhase, number>> = {
  FLOP: 3,
  TURN: 1,
  RIVER: 1,
};

// --- 3. ヘルパー ---

function createDeck(rng?: IGameRNG): string[] {
  const suits = ["H", "D", "C", "S"]; // Hearts, Diamonds, Clubs, Spades
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck: string[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${rank}${suit}`);
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = requireRng(rng, "TexasHoldem").nextInt(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const hiddenDeck = (cards: string[]) =>
  createSecret(
    cards,
    [],
    cards.map(() => "?"),
  );

const seatedPlayers = (state: BaseGameState): string[] =>
  Object.values(state.players ?? {}).filter((p): p is string => typeof p === "string");

/** ポットの権利があるプレイヤー（フォールドしていない） */
const contenders = (state: TexasHoldemState): string[] =>
  state.playerIds.filter((p) => !state.foldedPlayers.includes(p));

/** まだベットの意思決定ができるプレイヤー（フォールドもオールインもしていない） */
const actors = (state: TexasHoldemState): string[] =>
  contenders(state).filter((p) => !state.allInPlayers.includes(p));

const callAmountOf = (state: TexasHoldemState, pId: string): number =>
  Math.max(0, state.currentBet - (state.playerBets[pId] ?? 0));

/** 席順で seatIndex の次から探して、最初に行動できるプレイヤーを返す */
function firstActorAfter(state: TexasHoldemState, seatIndex: number): string | null {
  const n = state.playerIds.length;
  const acting = actors(state);
  for (let k = 1; k <= n; k++) {
    const p = state.playerIds[(seatIndex + k) % n];
    if (acting.includes(p)) return p;
  }
  return null;
}

/** ブラインドの席。ヘッズアップではディーラーが SB */
function blindSeats(state: TexasHoldemState): { sb: number; bb: number } {
  const n = state.playerIds.length;
  const d = state.dealerIndex % n;
  return n === 2 ? { sb: d, bb: (d + 1) % n } : { sb: (d + 1) % n, bb: (d + 2) % n };
}

/** チップをポットに入れる（不足していれば持っている分だけ = オールイン）。state は破壊的に更新する */
function commitChips(state: TexasHoldemState, pId: string, amount: number): number {
  const pay = Math.min(amount, state.playerChips[pId]);
  state.playerChips[pId] -= pay;
  state.playerBets[pId] += pay;
  state.totalBets[pId] += pay;
  state.pot += pay;
  if (state.playerChips[pId] === 0 && !state.allInPlayers.includes(pId)) {
    state.allInPlayers.push(pId);
  }
  return pay;
}

/**
 * ベッティングラウンドが終了したか:
 * 行動できる全員が最高ベット額に揃っていて、かつ全員が（直前のフルレイズ以降に）行動済み。
 * 行動できる人が 1 人以下なら、揃った時点で終了（相手がいないので賭けようがない）
 */
function isBettingRoundComplete(state: TexasHoldemState): boolean {
  const acting = actors(state);
  if (!acting.every((p) => state.playerBets[p] === state.currentBet)) return false;
  if (acting.length <= 1) return true;
  return acting.every((p) => state.actedPlayers.includes(p));
}

/** 残り 1 人: ポットを総取りして終了（手札は公開しない） */
function settleByFold(state: TexasHoldemState): TexasHoldemState {
  const winner = contenders(state)[0];
  const amount = state.pot;
  const playerChips = { ...state.playerChips, [winner]: state.playerChips[winner] + amount };
  return {
    ...state,
    playerChips,
    pot: 0,
    activePlayers: [],
    result: { reason: "FOLD", winnerIds: [winner], payouts: { [winner]: amount } },
  };
}

/**
 * ショーダウン: 役を比較し、サイドポットを含めて分配する。
 * 各プレイヤーの総投入額を閾値として、低い順に「その閾値まで」の分を、
 * その閾値以上を投入している未フォールド者の中で最強の役に配る（同点は山分け、端数はディーラーの左隣から）
 */
function settleByShowdown(state: TexasHoldemState): TexasHoldemState {
  const inShowdown = contenders(state);
  const ranks: Record<string, HandRank> = {};
  for (const p of inShowdown) {
    ranks[p] = evaluateBestHand([...state.hands[p].value, ...state.communityCards]);
  }

  // 席順（ディーラーの左隣から）: 端数チップの配り先を決めるため
  const n = state.playerIds.length;
  const seatOrder = Array.from(
    { length: n },
    (_, k) => state.playerIds[(state.dealerIndex + 1 + k) % n],
  );
  const bestOf = (players: string[]): string[] => {
    let best: string[] = [];
    for (const p of players) {
      if (best.length === 0) best = [p];
      else {
        const cmp = compareHandRanks(ranks[p], ranks[best[0]]);
        if (cmp > 0) best = [p];
        else if (cmp === 0) best.push(p);
      }
    }
    return seatOrder.filter((p) => best.includes(p));
  };

  const payouts: Record<string, number> = {};
  const playerChips = { ...state.playerChips };
  let remaining = state.pot;
  const levels = [...new Set(inShowdown.map((p) => state.totalBets[p]))].sort((a, b) => a - b);
  let prev = 0;
  for (const level of levels) {
    // この閾値帯のポット: 全員（フォールド済み含む）の投入額のうち prev〜level の部分
    let amount = 0;
    for (const p of state.playerIds) {
      amount += Math.max(0, Math.min(state.totalBets[p], level) - prev);
    }
    prev = level;
    if (amount === 0) continue;
    const eligible = inShowdown.filter((p) => state.totalBets[p] >= level);
    const winners = bestOf(eligible);
    const share = Math.floor(amount / winners.length);
    let odd = amount - share * winners.length;
    for (const w of winners) {
      const gain = share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
      payouts[w] = (payouts[w] ?? 0) + gain;
      playerChips[w] += gain;
      remaining -= gain;
    }
  }
  // 誰の投入額よりも多い分（理論上は発生しない）は最強の役に渡す
  if (remaining > 0) {
    const w = bestOf(inShowdown)[0];
    payouts[w] = (payouts[w] ?? 0) + remaining;
    playerChips[w] += remaining;
  }

  // 残った人の手札を公開する（フォールドした人の手札は伏せたまま）
  const hands = { ...state.hands };
  for (const p of inShowdown) hands[p] = createSecret(state.hands[p].value, ["*"]);

  return {
    ...state,
    phase: "SHOWDOWN",
    hands,
    playerChips,
    pot: 0,
    activePlayers: [],
    result: {
      reason: "SHOWDOWN",
      winnerIds: bestOf(inShowdown),
      payouts,
      showdown: seatOrder
        .filter((p) => inShowdown.includes(p))
        .map((p) => ({ playerId: p, handName: ranks[p].name, bestCards: ranks[p].cards })),
    },
  };
}

/** 次のフェーズへ。コミュニティカードを配り、ベットをリセットして最初の手番を決める */
function advancePhase(state: TexasHoldemState): TexasHoldemState {
  const nextPhase = PHASE_ORDER[PHASE_ORDER.indexOf(state.phase) + 1];
  if (nextPhase === "SHOWDOWN") return settleByShowdown(state);

  const deck = [...state.deck.value];
  const dealt = deck.splice(deck.length - CARDS_DEALT_ON_ENTER[nextPhase]!).reverse();
  const next: TexasHoldemState = {
    ...state,
    phase: nextPhase,
    deck: hiddenDeck(deck),
    communityCards: [...state.communityCards, ...dealt],
    currentBet: 0,
    minRaise: state.bigBlind,
    playerBets: Object.fromEntries(state.playerIds.map((p) => [p, 0])),
    actedPlayers: [],
  };
  return proceed(next, next.dealerIndex);
}

/**
 * アクション後の進行: 残り 1 人なら終了、ラウンドが終わっていれば次のフェーズ、
 * そうでなければ seatIndex の次に行動できるプレイヤーへ手番を移す
 */
function proceed(state: TexasHoldemState, seatIndex: number): TexasHoldemState {
  if (contenders(state).length === 1) return settleByFold(state);
  if (isBettingRoundComplete(state)) return advancePhase(state);
  const next = firstActorAfter(state, seatIndex);
  return { ...state, activePlayers: next ? [next] : [] };
}

/** START: 配札してブラインドを投入し、プリフロップの手番を決める */
function startHand(state: TexasHoldemState, rng?: IGameRNG): TexasHoldemState {
  const playerIds = seatedPlayers(state).slice(0, MAX_PLAYERS);
  // 開始後の飛び入りを防ぐため空席は閉じる
  const players: Record<string, string | null> = {};
  for (const [slot, id] of Object.entries(state.players ?? {})) {
    if (id !== null) players[slot] = id;
  }

  const deck = createDeck(rng);
  const hands: Record<string, Secret<string[]>> = {};
  for (const pId of playerIds) {
    const hand = [deck.pop()!, deck.pop()!];
    hands[pId] = createSecret(hand, [pId], ["?", "?"]);
  }

  const next: TexasHoldemState = {
    ...state,
    status: "PLAYING",
    players,
    playerIds,
    dealerIndex: state.dealerIndex % playerIds.length,
    deck: hiddenDeck(deck),
    communityCards: [],
    hands,
    pot: 0,
    currentBet: state.bigBlind,
    minRaise: state.bigBlind,
    playerBets: Object.fromEntries(playerIds.map((p) => [p, 0])),
    totalBets: Object.fromEntries(playerIds.map((p) => [p, 0])),
    playerChips: Object.fromEntries(playerIds.map((p) => [p, state.initialChips])),
    foldedPlayers: [],
    allInPlayers: [],
    actedPlayers: [],
    phase: "PRE_FLOP",
    result: null,
    message: undefined,
  };

  const { sb, bb } = blindSeats(next);
  commitChips(next, playerIds[sb], next.smallBlind);
  commitChips(next, playerIds[bb], next.bigBlind);
  // ブラインドは強制ベットなので「行動済み」にはしない（BB には最後にオプションがある）
  return proceed(next, bb);
}

// --- 4. ルールセット本体 ---

export const TexasHoldemRuleset: GameRuleset<TexasHoldemState, TexasHoldemAction> = {
  getInitialState: (options?: TexasHoldemOptions, _rng?: IGameRNG): TexasHoldemState => {
    const opts = options ?? {};
    const playerIds = (opts.playerIds ?? []).filter((id) => !!id).slice(0, MAX_PLAYERS);
    const initialChips =
      opts.initialChips && opts.initialChips > 0 ? opts.initialChips : DEFAULT_INITIAL_CHIPS;
    const bigBlind = opts.bigBlind && opts.bigBlind > 0 ? opts.bigBlind : DEFAULT_BIG_BLIND;
    const smallBlind =
      opts.smallBlind && opts.smallBlind > 0
        ? opts.smallBlind
        : Math.max(1, Math.floor(bigBlind / 2));

    // playerIds が渡されていれば着席済みとして扱う（配札・ブラインドは START）
    const players: Record<string, string | null> = {};
    for (let i = 0; i < MAX_PLAYERS; i++) players[String(i + 1)] = playerIds[i] ?? null;

    return {
      status: "WAITING",
      players,
      activePlayers: [],
      playerIds: [],
      deck: hiddenDeck([]),
      communityCards: [],
      hands: {},
      pot: 0,
      currentBet: 0,
      minRaise: bigBlind,
      playerBets: {},
      totalBets: {},
      playerChips: {},
      foldedPlayers: [],
      allInPlayers: [],
      actedPlayers: [],
      phase: "PRE_FLOP",
      dealerIndex: opts.dealerIndex && opts.dealerIndex > 0 ? Math.floor(opts.dealerIndex) : 0,
      smallBlind,
      bigBlind,
      initialChips,
      result: null,
    };
  },

  isValidAction: (state, action) => {
    if (action.type === "START") {
      return state.status === "WAITING" && seatedPlayers(state).length >= MIN_PLAYERS;
    }
    if (state.status !== "PLAYING" || state.result) return false;

    const pId = action.playerId;
    if (!pId || !state.activePlayers?.includes(pId)) return false;
    if (!actors(state).includes(pId)) return false;

    const chips = state.playerChips[pId];
    const callAmount = callAmountOf(state, pId);

    switch (action.type) {
      case "FOLD":
        return true;
      case "CHECK":
        return callAmount === 0;
      case "CALL":
        // チップが足りなければ持っている分だけでコール（オールイン）
        return callAmount > 0 && chips > 0;
      case "RAISE": {
        const amount = action.amount;
        if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return false;
        const total = callAmount + amount;
        if (total > chips) return false;
        // 直前のフルレイズ以降に行動済みなら再レイズ不可
        // （自分のベットへの上乗せや、ショートオールインに対する再レイズを防ぐ）
        if (state.actedPlayers.includes(pId)) return false;
        // ミニマムレイズ未満はオールインの場合のみ許可
        return amount >= state.minRaise || total === chips;
      }
      default:
        return false;
    }
  },

  reduce: (state, action, rng) => {
    if (action.type === "START") return startHand(state, rng);

    // ネストした playerChips / playerBets 等を書き換えるので深いコピーにする（凍結された state 対策）
    const next = structuredClone(state);
    const pId = action.playerId!;
    const callAmount = callAmountOf(next, pId);
    const seatIndex = next.playerIds.indexOf(pId);

    switch (action.type) {
      case "FOLD":
        next.foldedPlayers.push(pId);
        break;
      case "CHECK":
        next.actedPlayers.push(pId);
        break;
      case "CALL":
        commitChips(next, pId, callAmount);
        if (!next.actedPlayers.includes(pId)) next.actedPlayers.push(pId);
        break;
      case "RAISE": {
        const amount = action.amount!;
        commitChips(next, pId, callAmount + amount);
        next.currentBet = next.playerBets[pId];
        if (amount >= next.minRaise) {
          // フルレイズ: 他の全員に行動権が戻る
          next.minRaise = amount;
          next.actedPlayers = [pId];
        } else {
          // ショートオールイン: 行動済みの人の再レイズ権は復活しない
          next.actedPlayers.push(pId);
        }
        break;
      }
    }

    return proceed(next, seatIndex);
  },

  checkWinCondition: (state) => {
    const result = state.result;
    if (!result) return { isFinished: false };

    if (result.reason === "FOLD") {
      const winner = result.winnerIds[0];
      return {
        isFinished: true,
        winnerIds: result.winnerIds,
        message: `${winner} wins ${result.payouts[winner]} chips (everyone else folded)`,
      };
    }
    const showdown = result.showdown ?? [];
    const hands = showdown.map((e) => `${e.playerId}: ${e.handName}`).join(", ");
    const winner = result.winnerIds[0];
    const winnerHand = showdown.find((e) => e.playerId === winner)?.handName;
    return {
      isFinished: true,
      winnerIds: result.winnerIds,
      message:
        result.winnerIds.length > 1
          ? `Showdown! ${result.winnerIds.join(", ")} split the pot with ${winnerHand} (${hands})`
          : `Showdown! ${winner} wins with ${winnerHand} (${hands})`,
    };
  },

  applyWinResult: (state, winResult) => ({
    ...state,
    status: "FINISHED",
    activePlayers: [],
    message: winResult.message,
  }),

  // 制限時間切れ: チェックできるならチェック、できなければフォールド
  getTimeoutAction: (state, playerId) =>
    callAmountOf(state, playerId) === 0 ? { type: "CHECK", playerId } : { type: "FOLD", playerId },

  getLegalActions: (state, playerId) => {
    if (state.status === "WAITING") {
      const seated = seatedPlayers(state);
      return seated.length >= MIN_PLAYERS && seated.includes(playerId)
        ? [{ type: "START", playerId }]
        : [];
    }
    if (state.status !== "PLAYING" || state.result) return [];
    if (!state.activePlayers?.includes(playerId)) return [];

    const actions: TexasHoldemAction[] = [];
    const baseActions: TexasHoldemAction[] = [
      { type: "FOLD", playerId },
      { type: "CHECK", playerId },
      { type: "CALL", playerId },
    ];
    for (const action of baseActions) {
      if (TexasHoldemRuleset.isValidAction(state, action)) actions.push(action);
    }

    // RAISE は代表的な額だけ提示する（AI 用）: ミニマム / ポットサイズ / オールイン
    const chips = state.playerChips[playerId];
    const callAmount = callAmountOf(state, playerId);
    const allIn = chips - callAmount;
    const potSized = state.pot + callAmount;
    const candidates = [...new Set([state.minRaise, potSized, allIn])].sort((a, b) => a - b);
    for (const amount of candidates) {
      const raise: TexasHoldemAction = { type: "RAISE", amount, playerId };
      if (TexasHoldemRuleset.isValidAction(state, raise)) actions.push(raise);
    }

    return actions;
  },
};
