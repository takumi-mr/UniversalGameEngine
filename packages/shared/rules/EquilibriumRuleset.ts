// EquilibriumRuleset.ts

/**
 *      ______            _ _ _ _          _                     _______ _            _               _      _____             _
 *     |  ____|          (_) (_) |        (_)                _  |__   __| |          | |             | |    / ____|           | |
 *     | |__   __ _ _   _ _| |_| |__  _ __ _ _   _ _ __ ___ (_)    | |  | |__   ___  | |     __ _ ___| |_  | (___   ___  _   _| |
 *     |  __| / _` | | | | | | | '_ \| '__| | | | | '_ ` _ \       | |  | '_ \ / _ \ | |    / _` / __| __|  \___ \ / _ \| | | | |
 *     | |___| (_| | |_| | | | | |_) | |  | | |_| | | | | | |_     | |  | | | |  __/ | |___| (_| \__ \ |_   ____) | (_) | |_| | |
 *     |______\__, |\__,_|_|_|_|_.__/|_|  |_|\__,_|_| |_| |_(_)    |_|  |_| |_|\___| |______\__,_|___/\__| |_____/ \___/ \__,_|_|
 *               | |
 *               |_|
 *
 * The World's Most Interesting Game, According to AI
 *
 * 進行:
 *   JOIN（着席・初期手札と秘密の目標を配る） → START（3人以上で開始）
 *   → [AUCTION: 全員が同時に封印入札 → MAIN: 落札者から順に手番 → 全員 END_TURN] を繰り返す
 *   → 誰かが秘密の目標を達成 / 最後の一人 / MAX_TURNS 超過 で終了
 */

import { requireRng } from "../utils/requireRng";
import { createSecret, type Secret } from "../GameRules";
import type { BaseGameState, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";

// ==========================================
// 1. 型定義 (Types & Interfaces)
// ==========================================

export type CardType = "ATTACK" | "DEFENSE" | "TRICK" | "GOAL" | "SYPHON";

export interface Card {
  id: string;
  type: CardType;
  name: string;
  value: number; // 攻撃力や防御力、あるいは目標達成のためのポイント
  cost: number; // 使用または入札に必要なSoul Point
}

export type CardTemplate = Omit<Card, "id">;

// ゲーム固有の状態
export interface EquilibriumState extends BaseGameState {
  turnCount: number;
  phase: "AUCTION" | "MAIN";
  auctionPool: Card[];
  // 封印入札: 自分の額だけ見える（他人には "?"）
  currentBids: Record<string, Secret<number>>;
  // AUCTION 中はパスした人、MAIN 中はターンを終えた人（フェーズ切替時にリセット）
  passedPlayers: string[];

  playerData: Record<string, PlayerState>;
  lastPlayedCard?: Card; // Echo_Whisper が複製する直前のカード（Echo 自身は除く）
}

export interface PlayerState {
  id: string;
  hp: number;
  soulPoints: number; // これが通貨であり、命を削るリソース
  hand: Secret<Card[]>;
  board: Card[]; // 場に出して永続効果を発揮しているカード
  hiddenGoal: Secret<Card | null>; // 現在の秘密の勝利条件
  fakeReveal?: Card; // 相手を騙すために意図的に見せている「嘘のカード」
  kills: number; // 自分の攻撃で倒した相手の数（Sudden_Death 用）
}

// ゲーム固有のアクション
export type EquilibriumAction =
  | { type: "JOIN"; playerId: string; timestamp?: number }
  | { type: "START"; playerId: string; timestamp?: number }
  | { type: "BID"; playerId: string; amount: number; timestamp?: number }
  | { type: "PASS_AUCTION"; playerId: string; timestamp?: number }
  | {
      type: "PLAY_CARD";
      playerId: string;
      cardId: string;
      targetId?: string;
      timestamp?: number;
    }
  | {
      type: "ALTER_GOAL";
      playerId: string;
      newGoalCardId: string;
      timestamp?: number;
    }
  | {
      type: "BLUFF_REVEAL";
      playerId: string;
      fakeCard: Card;
      timestamp?: number;
    }
  | { type: "SACRIFICE"; playerId: string; timestamp?: number }
  | { type: "END_TURN"; playerId: string; timestamp?: number };

// ==========================================
// 2. 定数・カードカタログ
// ==========================================

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
/** これを超えるターンに入ったら HP（同点なら SP）の多い順で決着させる。終わらないゲームを防ぐ */
export const MAX_TURNS = 30;
const INITIAL_HP = 20;
const INITIAL_SP = 10;

const BASIC_CARDS: CardTemplate[] = [
  { type: "ATTACK", name: "Strike", value: 2, cost: 1 },
  { type: "DEFENSE", name: "Guard", value: 2, cost: 1 },
  { type: "TRICK", name: "Peep", value: 0, cost: 2 }, // 相手の秘密の目標を覗く
];

const GOAL_CARDS: CardTemplate[] = [
  { type: "GOAL", name: "Annihilator", value: 0, cost: 0 }, // 最後の一人になる
  { type: "GOAL", name: "Collector", value: 8, cost: 0 }, // 場に 8 枚並べる
  { type: "GOAL", name: "Pacifist", value: 15, cost: 0 }, // 誰も死なずに 15 ターン目
  { type: "GOAL", name: "Soul_Hoarder", value: 25, cost: 0 }, // SP 25 以上
];

const AUCTION_CARDS: CardTemplate[] = [
  { type: "ATTACK", name: "Hellfire", value: 8, cost: 3 },
  { type: "DEFENSE", name: "Aegis_Shield", value: 7, cost: 2 },
  { type: "TRICK", name: "Mind_Control", value: 0, cost: 4 }, // 相手の手札から 1 枚奪う
  { type: "SYPHON", name: "Soul_Drain", value: 3, cost: 2 },
  { type: "TRICK", name: "Echo_Whisper", value: 0, cost: 3 }, // 直前に出たカードを複製
  { type: "TRICK", name: "Corruption", value: 0, cost: 4 }, // 相手の手札を半分捨てさせる
  { type: "GOAL", name: "Sudden_Death", value: 1, cost: 0 }, // 自分の攻撃で誰かを倒す
];

const CARD_CATALOG: CardTemplate[] = [...BASIC_CARDS, ...GOAL_CARDS, ...AUCTION_CARDS];

/** 対象を取るカードか（Echo は複製元に従う） */
export function cardNeedsTarget(card: Card | CardTemplate, lastPlayedCard?: Card): boolean {
  if (card.type === "ATTACK" || card.type === "SYPHON") return true;
  if (card.type === "TRICK") {
    if (card.name === "Echo_Whisper") return !!lastPlayedCard && cardNeedsTarget(lastPlayedCard);
    return card.name === "Peep" || card.name === "Mind_Control" || card.name === "Corruption";
  }
  return false;
}

// ==========================================
// 3. 内部ヘルパー (Internal Helpers)
// ==========================================

function generateId(rng?: IGameRNG): string {
  return Math.floor(requireRng(rng, "Equilibrium").nextFloat() * 100000000).toString(36);
}

function instantiate(template: CardTemplate, rng?: IGameRNG): Card {
  return { ...template, id: generateId(rng) };
}

function pick(pool: CardTemplate[], rng?: IGameRNG): Card {
  const idx = requireRng(rng, "Equilibrium").nextInt(0, pool.length - 1);
  return instantiate(pool[idx], rng);
}

const HIDDEN_CARD: Card = { id: "hidden", type: "TRICK", name: "Unknown", value: 0, cost: 0 };

/** 手札を Secret に包み直す。fakeReveal があれば、他人から見える 1 枚目をそれにすり替える */
function setHand(player: PlayerState, hand: Card[]): void {
  const masked = hand.map(() => HIDDEN_CARD);
  if (player.fakeReveal && masked.length > 0) masked[0] = player.fakeReveal;
  player.hand = createSecret(hand, [player.id], masked);
}

function createPlayer(id: string, rng?: IGameRNG): PlayerState {
  const player: PlayerState = {
    id,
    hp: INITIAL_HP,
    soulPoints: INITIAL_SP,
    hand: createSecret([], [id], []),
    board: [],
    hiddenGoal: createSecret(pick(GOAL_CARDS, rng), [id], null),
    kills: 0,
  };
  setHand(
    player,
    BASIC_CARDS.map((t) => instantiate(t, rng)),
  );
  return player;
}

function alivePlayerIds(state: EquilibriumState): string[] {
  return Object.keys(state.playerData).filter((id) => state.playerData[id].hp > 0);
}

function isValidTarget(state: EquilibriumState, actorId: string, targetId?: string): boolean {
  if (!targetId || targetId === actorId) return false;
  const target = state.playerData[targetId];
  return !!target && target.hp > 0;
}

function findCatalogCard(card: unknown): CardTemplate | undefined {
  if (!card || typeof card !== "object") return undefined;
  const c = card as Partial<Card>;
  return CARD_CATALOG.find((t) => t.name === c.name && t.type === c.type);
}

function auctionPoolSize(playerCount: number): number {
  return Math.floor(playerCount / 2) + 1;
}

/** 手番の次のプレイヤー（生存していて、まだこのラウンドの手番を終えていない人） */
function getNextPlayer(state: EquilibriumState, currentPlayerId: string): string {
  const ids = Object.keys(state.playerData);
  const currentIndex = ids.indexOf(currentPlayerId);
  for (let i = 1; i <= ids.length; i++) {
    const id = ids[(currentIndex + i) % ids.length];
    if (state.playerData[id].hp > 0 && !state.passedPlayers.includes(id)) return id;
  }
  return currentPlayerId;
}

/**
 * 封印入札の決着。最高額かつ単独（他に同額がいない）の入札者が落札する。
 * - 単独最高額がなければ（全員同額など）プールは次のオークションへ持ち越す
 * - 誰も入札しなければ全員 HP -1 の上でプールを持ち越す
 */
function resolveAuction(state: EquilibriumState): void {
  const bids = Object.entries(state.currentBids).map(([id, s]) => [id, s.value] as const);
  const alive = alivePlayerIds(state);
  let winnerId: string | null = null;

  if (bids.length === 0) {
    for (const id of alive) state.playerData[id].hp -= 1;
  } else {
    const counts = new Map<number, number>();
    for (const [, amount] of bids) counts.set(amount, (counts.get(amount) ?? 0) + 1);
    let best = -1;
    for (const [id, amount] of bids) {
      if (counts.get(amount) === 1 && amount > best) {
        best = amount;
        winnerId = id;
      }
    }
    if (winnerId) {
      const winner = state.playerData[winnerId];
      winner.soulPoints -= best;
      setHand(winner, [...winner.hand.value, ...state.auctionPool]);
      state.auctionPool = [];
    }
  }

  state.phase = "MAIN";
  state.currentBids = {};
  state.passedPlayers = [];
  const first = winnerId && state.playerData[winnerId].hp > 0 ? winnerId : alivePlayerIds(state)[0];
  state.activePlayers = first ? [first] : [];
}

/** 新しいラウンド（オークション）を開く。SP 回復と基本カード 1 枚の補充つき */
function startRound(state: EquilibriumState, turnCount: number, rng?: IGameRNG): void {
  const alive = alivePlayerIds(state);
  state.turnCount = turnCount;
  state.phase = "AUCTION";
  state.passedPlayers = [];
  state.currentBids = {};
  state.auctionPool = [
    ...state.auctionPool,
    ...Array.from({ length: auctionPoolSize(alive.length) }, () => pick(AUCTION_CARDS, rng)),
  ];
  state.activePlayers = [...alive];
  for (const id of alive) {
    const p = state.playerData[id];
    p.soulPoints += 1;
    setHand(p, [...p.hand.value, pick(BASIC_CARDS, rng)]);
  }
}

function executeCardEffect(
  state: EquilibriumState,
  actor: PlayerState,
  card: Card,
  targetId: string | undefined,
  rng?: IGameRNG,
): void {
  const target = targetId ? state.playerData[targetId] : undefined;

  if (card.type === "ATTACK") {
    if (!target) return;
    const wasAlive = target.hp > 0;
    target.hp -= card.value;
    if (wasAlive && target.hp <= 0) actor.kills += 1;
    return;
  }
  if (card.type === "DEFENSE") {
    actor.hp += card.value;
    return;
  }
  if (card.type === "SYPHON") {
    if (!target) return;
    const drain = Math.min(target.soulPoints, card.value);
    target.soulPoints -= drain;
    actor.soulPoints += drain;
    return;
  }
  if (card.type !== "TRICK" || !target) return;

  switch (card.name) {
    case "Corruption": {
      const hand = [...target.hand.value];
      const discardCount = Math.floor(hand.length / 2);
      for (let i = 0; i < discardCount; i++) {
        hand.splice(requireRng(rng, "Equilibrium").nextInt(0, hand.length - 1), 1);
      }
      setHand(target, hand);
      break;
    }
    case "Peep": {
      // 相手の秘密の目標を自分にも見えるようにする（相手が目標を変えるまで）
      const goal = target.hiddenGoal;
      if (!goal.visibleTo.includes(actor.id)) {
        target.hiddenGoal = createSecret(goal.value, [...goal.visibleTo, actor.id], null);
      }
      break;
    }
    case "Mind_Control": {
      const hand = [...target.hand.value];
      if (hand.length === 0) break;
      const [stolen] = hand.splice(requireRng(rng, "Equilibrium").nextInt(0, hand.length - 1), 1);
      setHand(target, hand);
      setHand(actor, [...actor.hand.value, stolen]);
      break;
    }
  }
}

/** reduce 用の書き換え可能なコピー。プレイヤーごとのオブジェクトも複製する（元の state は凍結されている） */
function cloneState(state: EquilibriumState): EquilibriumState {
  const playerData: Record<string, PlayerState> = {};
  for (const [id, p] of Object.entries(state.playerData)) {
    playerData[id] = { ...p, board: [...p.board] };
  }
  return {
    ...state,
    playerData,
    auctionPool: [...state.auctionPool],
    currentBids: { ...state.currentBids },
    passedPlayers: [...state.passedPlayers],
    activePlayers: state.activePlayers ? [...state.activePlayers] : [],
  };
}

// ==========================================
// 4. ルールセット本体 (Ruleset Implementation)
// ==========================================

export const EquilibriumRuleset: GameRuleset<EquilibriumState, EquilibriumAction> = {
  getInitialState(options: { playerIds?: string[] } = {}, rng?: IGameRNG): EquilibriumState {
    const playerIds = (options.playerIds || []).filter(Boolean).slice(0, MAX_PLAYERS);
    const playerData: Record<string, PlayerState> = {};
    for (const id of playerIds) playerData[id] = createPlayer(id, rng);

    const players: Record<string, string | null> = {};
    for (let i = 0; i < MAX_PLAYERS; i++) players[String(i)] = playerIds[i] ?? null;

    return {
      status: "WAITING",
      players,
      activePlayers: [],
      turnCount: 1,
      phase: "AUCTION",
      auctionPool: [],
      currentBids: {},
      passedPlayers: [],
      playerData,
    };
  },

  isValidAction(state: EquilibriumState, action: EquilibriumAction): boolean {
    if (action.type === "JOIN") {
      return (
        state.status === "WAITING" &&
        !state.playerData[action.playerId] &&
        Object.keys(state.playerData).length < MAX_PLAYERS
      );
    }
    if (action.type === "START") {
      return (
        state.status === "WAITING" &&
        !!state.playerData[action.playerId] &&
        Object.keys(state.playerData).length >= MIN_PLAYERS
      );
    }

    if (state.status !== "PLAYING") return false;
    const player = state.playerData[action.playerId];
    if (!player || player.hp <= 0) return false;
    if (!state.activePlayers?.includes(action.playerId)) return false;

    switch (action.type) {
      case "BID":
        return (
          state.phase === "AUCTION" &&
          Number.isInteger(action.amount) &&
          action.amount >= 1 &&
          action.amount <= player.soulPoints
        );
      case "PASS_AUCTION":
        return state.phase === "AUCTION";
      case "PLAY_CARD": {
        if (state.phase !== "MAIN") return false;
        const card = player.hand.value.find((c) => c.id === action.cardId);
        if (!card || card.type === "GOAL" || player.soulPoints < card.cost) return false;
        if (card.name === "Echo_Whisper" && !state.lastPlayedCard) return false;
        if (cardNeedsTarget(card, state.lastPlayedCard)) {
          return isValidTarget(state, action.playerId, action.targetId);
        }
        return true;
      }
      case "ALTER_GOAL":
        return (
          state.phase === "MAIN" &&
          player.hand.value.some((c) => c.id === action.newGoalCardId && c.type === "GOAL")
        );
      case "BLUFF_REVEAL":
        // 手番中ならいつでも嘘の情報をセットできるが、コストがかかる。実在するカードしか騙れない
        return player.soulPoints >= 1 && findCatalogCard(action.fakeCard) !== undefined;
      case "SACRIFICE":
        return state.phase === "MAIN" && player.hp > 2;
      case "END_TURN":
        return state.phase === "MAIN";
      default:
        return false;
    }
  },

  reduce(state: EquilibriumState, action: EquilibriumAction, rng?: IGameRNG): EquilibriumState {
    const next = cloneState(state);

    if (action.type === "JOIN") {
      if (!next.playerData[action.playerId]) {
        next.playerData[action.playerId] = createPlayer(action.playerId, rng);
      }
      return next;
    }

    if (action.type === "START") {
      // 開始後の飛び入りを防ぐため、空席は閉じる（組み込み JOIN は空席がなければ着席させない）
      const seated: Record<string, string | null> = {};
      for (const [slot, id] of Object.entries(next.players ?? {})) {
        if (id !== null) seated[slot] = id;
      }
      next.players = seated;
      next.status = "PLAYING";
      startRound(next, 1, rng);
      return next;
    }

    const player = next.playerData[action.playerId];
    if (!player) return next;

    switch (action.type) {
      case "BID":
      case "PASS_AUCTION": {
        if (action.type === "BID") {
          next.currentBids[action.playerId] = createSecret(action.amount, [action.playerId], "?");
        } else if (!next.passedPlayers.includes(action.playerId)) {
          next.passedPlayers.push(action.playerId);
        }
        next.activePlayers = next.activePlayers?.filter((id) => id !== action.playerId);

        const acted = [...Object.keys(next.currentBids), ...next.passedPlayers];
        if (alivePlayerIds(next).every((id) => acted.includes(id))) {
          resolveAuction(next);
        }
        break;
      }

      case "PLAY_CARD": {
        const hand = [...player.hand.value];
        const cardIndex = hand.findIndex((c) => c.id === action.cardId);
        if (cardIndex === -1) break;
        const [card] = hand.splice(cardIndex, 1);
        player.soulPoints -= card.cost;
        setHand(player, hand);

        if (card.name === "Echo_Whisper") {
          if (next.lastPlayedCard) {
            executeCardEffect(next, player, next.lastPlayedCard, action.targetId, rng);
          }
        } else {
          executeCardEffect(next, player, card, action.targetId, rng);
          next.lastPlayedCard = card;
        }
        player.board.push(card);
        break;
      }

      case "ALTER_GOAL": {
        const hand = [...player.hand.value];
        const goalIndex = hand.findIndex((c) => c.id === action.newGoalCardId && c.type === "GOAL");
        if (goalIndex === -1) break;
        const [goal] = hand.splice(goalIndex, 1);
        player.hiddenGoal = createSecret(goal, [player.id], null);
        setHand(player, hand);
        break;
      }

      case "BLUFF_REVEAL": {
        const template = findCatalogCard(action.fakeCard);
        if (!template) break;
        player.soulPoints -= 1;
        player.fakeReveal = { ...template, id: "bluff" };
        setHand(player, player.hand.value);
        break;
      }

      case "SACRIFICE":
        player.hp -= 2;
        player.soulPoints += 1;
        break;

      case "END_TURN": {
        if (!next.passedPlayers.includes(action.playerId)) {
          next.passedPlayers.push(action.playerId);
        }
        if (alivePlayerIds(next).every((id) => next.passedPlayers.includes(id))) {
          startRound(next, next.turnCount + 1, rng);
        } else {
          next.activePlayers = [getNextPlayer(next, action.playerId)];
        }
        break;
      }
    }
    return next;
  },

  checkWinCondition(state: EquilibriumState): {
    isFinished: boolean;
    winnerIds?: string[];
    message?: string;
  } {
    // 待機中は勝敗判定を行わない（初期プレイヤーが1人の時に即終了するのを防ぐ）
    if (state.status === "WAITING") {
      return { isFinished: false };
    }

    const playerIds = Object.keys(state.playerData);
    const alive = alivePlayerIds(state);
    if (alive.length === 1) {
      return {
        isFinished: true,
        winnerIds: [alive[0]],
        message: `Player ${alive[0]} won by Last Man Standing!`,
      };
    } else if (alive.length === 0) {
      return { isFinished: true, winnerIds: [], message: `Draw! All players died.` };
    }

    // 各プレイヤーの秘密の勝利条件（hiddenGoal）を評価
    for (const pId of alive) {
      const player = state.playerData[pId];
      const goal = player.hiddenGoal?.value;
      if (!goal) continue;

      let achieved: string | null = null;
      switch (goal.name) {
        case "Collector":
          if (player.board.length >= goal.value)
            achieved = `Collector (${goal.value}+ cards on board)`;
          break;
        case "Pacifist":
          if (state.turnCount >= goal.value && alive.length === playerIds.length) {
            achieved = `Pacifist (Survived ${goal.value} turns peacefully)`;
          }
          break;
        case "Soul_Hoarder":
          if (player.soulPoints >= goal.value)
            achieved = `Soul Hoarder (${goal.value}+ Soul Points)`;
          break;
        case "Sudden_Death":
          if (player.kills >= goal.value) achieved = `Sudden Death (defeated an opponent)`;
          break;
        // Annihilator は「最後の一人」なので上の共通判定で決着する
      }
      if (achieved) {
        return {
          isFinished: true,
          winnerIds: [pId],
          message: `Player ${pId} achieved GOAL: ${achieved}!`,
        };
      }
    }

    // 長引きすぎたら HP（同点なら SP）で決着
    if (state.turnCount > MAX_TURNS) {
      const score = (id: string) =>
        state.playerData[id].hp * 1000 + state.playerData[id].soulPoints;
      const best = Math.max(...alive.map(score));
      const winnerIds = alive.filter((id) => score(id) === best);
      return {
        isFinished: true,
        winnerIds,
        message: `Turn limit reached. ${winnerIds.join(", ")} won on HP / Soul Points.`,
      };
    }

    return { isFinished: false };
  },

  getLegalActions(state: EquilibriumState, playerId: string): EquilibriumAction[] {
    const player = state.playerData[playerId];
    if (!player) return [];

    if (state.status === "WAITING") {
      return Object.keys(state.playerData).length >= MIN_PLAYERS
        ? [{ type: "START", playerId }]
        : [];
    }
    if (state.status !== "PLAYING" || player.hp <= 0) return [];
    if (!state.activePlayers?.includes(playerId)) return [];

    const actions: EquilibriumAction[] = [];
    if (state.phase === "AUCTION") {
      actions.push({ type: "PASS_AUCTION", playerId });
      for (let i = 1; i <= player.soulPoints; i++) {
        actions.push({ type: "BID", playerId, amount: i });
      }
      return actions;
    }

    const targets = alivePlayerIds(state).filter((id) => id !== playerId);
    for (const card of player.hand.value) {
      if (card.type === "GOAL") {
        actions.push({ type: "ALTER_GOAL", playerId, newGoalCardId: card.id });
        continue;
      }
      if (player.soulPoints < card.cost) continue;
      if (card.name === "Echo_Whisper" && !state.lastPlayedCard) continue;
      if (cardNeedsTarget(card, state.lastPlayedCard)) {
        for (const targetId of targets) {
          actions.push({ type: "PLAY_CARD", playerId, cardId: card.id, targetId });
        }
      } else {
        actions.push({ type: "PLAY_CARD", playerId, cardId: card.id });
      }
    }
    if (player.hp > 2) actions.push({ type: "SACRIFICE", playerId });
    actions.push({ type: "END_TURN", playerId });
    return actions;
  },
};
