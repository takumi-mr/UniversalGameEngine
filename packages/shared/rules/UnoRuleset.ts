import { requireRng } from "@engine/shared/utils/requireRng";
import { createSecret, type Secret } from "@engine/shared/GameRules";
import type { BaseGameState, BaseGameAction, GameRuleset } from "@engine/shared/GameRules";
import type { IGameRNG } from "@engine/shared/utils/IGameRNG";

export interface UnoState extends BaseGameState {
  hands: Record<string, Secret<number[]>>; // playerId -> 手札（本人のみ。他人には枚数分の "?"）
  deck: Secret<number[]>; // 山札（誰にも見えない。枚数分の "?"）
  discard: number[];

  turnIndex: number;
  direction: 1 | -1;

  currentColor: number;

  drawStack: number;

  playerOrder: string[];
}

export type UnoActionType = "PLAY" | "DRAW" | "PASS" | "START";

export interface UnoAction extends BaseGameAction {
  type: UnoActionType;
  card?: number;
  color?: number;
}

export interface UnoOptions {
  // エンジンのシード（serverSeed / clientSeed）などもこのオブジェクトで渡される
  [key: string]: unknown;
  players?: string[];
}

const MIN_PLAYERS = 2;
const HAND_SIZE = 7;

/** 手札を Secret に包む（本人だけが見える。他人には枚数分の "?"） */
function secretHand(cards: number[], playerId: string): Secret<number[]> {
  return createSecret(
    cards,
    [playerId],
    cards.map(() => "?"),
  );
}

/** 山札を Secret に包む（誰にも見えない。枚数だけ公開） */
function secretDeck(cards: number[]): Secret<number[]> {
  return createSecret(
    cards,
    [],
    cards.map(() => "?"),
  );
}

/** 山札をシャッフルして配り、場札を 1 枚めくる */
function deal(state: UnoState, players: string[], rng?: IGameRNG): UnoState {
  const deck = createDeck();
  shuffle(deck, rng);

  const hands: Record<string, Secret<number[]>> = {};
  for (const p of players) {
    hands[p] = secretHand(deck.splice(0, HAND_SIZE), p);
  }
  const first = deck.pop()!;

  return {
    ...state,
    hands,
    deck: secretDeck(deck),
    discard: [first],
    turnIndex: 0,
    direction: 1,
    currentColor: cardColor(first),
    drawStack: 0,
    playerOrder: players,
  };
}

export const UnoRuleset: GameRuleset<UnoState, UnoAction, UnoOptions> = {
  getInitialState: (options?: UnoOptions, rng?: IGameRNG): UnoState => {
    const players: string[] = options?.players ?? [];

    const waiting: UnoState = {
      status: "WAITING",
      hands: {},
      deck: secretDeck([]),
      discard: [],
      turnIndex: 0,
      direction: 1,
      currentColor: 0,
      drawStack: 0,
      playerOrder: [],
      players:
        players.length > 0
          ? ({ ...players } as Record<number, string>)
          : { 0: null, 1: null, 2: null, 3: null }, // 4 slots
    };
    // players を渡された（テスト・RL 用）ときは配札まで済ませる。通常は START で配る
    return players.length > 0 ? deal(waiting, players, rng) : waiting;
  },

  isValidAction: (state, action) => {
    if (action.type === "START") {
      const seated = Object.values(state.players ?? {}).filter((p): p is string => p !== null);
      return state.status === "WAITING" && seated.length >= MIN_PLAYERS;
    }

    if (state.status !== "PLAYING") return false;

    const player = state.playerOrder[state.turnIndex];

    if (action.playerId !== player) return false;

    if (action.type === "DRAW") return true;

    if (action.type === "PLAY") {
      const hand = state.hands[player].value;

      if (!hand.includes(action.card!)) return false;

      const top = state.discard[state.discard.length - 1];

      if (
        cardColor(action.card!) === state.currentColor ||
        cardValue(action.card!) === cardValue(top) ||
        cardColor(action.card!) === 4
      ) {
        return true;
      }
      return false;
    }

    if (action.type === "PASS") {
      return true;
    }

    return false;
  },

  reduce: (state, action, rng?: IGameRNG) => {
    if (action.type === "START") {
      const seated = Object.values(state.players ?? {}).filter((p): p is string => p !== null);
      // options.players で配札済みなら配り直さない
      const dealt = state.playerOrder.length > 0 ? state : deal(state, seated, rng);
      return { ...dealt, status: "PLAYING", activePlayers: [dealt.playerOrder[0]] };
    }

    const newState = structuredClone(state);
    const player = newState.playerOrder[newState.turnIndex];

    if (action.type === "DRAW") {
      drawCards(newState, player, 1, rng);
      // In some rules, you can play the drawn card immediately,
      // but for simplicity, we'll just end the turn if they can't play it or choose not to.
      // Actually, after DRAW, typical UNO rules allow you to PLAY that card or PASS.
      // To keep it simple, we'll keep the turn with the same player but they must PASS or PLAY.
      return newState;
    }

    if (action.type === "PLAY") {
      const card = action.card!;
      const hand = newState.hands[player].value;
      const index = hand.indexOf(card);
      if (index === -1) return state; // Should not happen if isValidAction works

      hand.splice(index, 1);
      newState.hands[player] = secretHand(hand, player);
      newState.discard.push(card);

      const value = cardValue(card);
      const color = cardColor(card);

      // Handle Wild cards color change
      if (color === 4) {
        newState.currentColor = action.color ?? 0; // Default to Red if color not provided
      } else {
        newState.currentColor = color;
      }

      let skipNext = false;

      if (value === 10) {
        // Skip
        skipNext = true;
      } else if (value === 11) {
        // Reverse
        if (newState.playerOrder.length === 2) {
          skipNext = true;
        } else {
          newState.direction *= -1;
        }
      } else if (value === 12) {
        // Draw Two
        newState.drawStack += 2;
        skipNext = true;
      } else if (value === 14) {
        // Wild Draw Four
        newState.drawStack += 4;
        skipNext = true;
      }

      if (newState.drawStack > 0 && skipNext) {
        // Apply draw stack immediately to next player
        const nextIndex = getNextTurnIndex(newState);
        const nextPlayer = newState.playerOrder[nextIndex];
        drawCards(newState, nextPlayer, newState.drawStack, rng);
        newState.drawStack = 0;
        // The drawn player is also skipped
        advanceTurn(newState); // skip the one who drew
      } else if (skipNext) {
        advanceTurn(newState);
      }
      advanceTurn(newState);
    }

    if (action.type === "PASS") {
      advanceTurn(newState);
    }

    // 手番プレイヤー（AI の自動実行・UI の手番表示に使う）
    newState.activePlayers = [newState.playerOrder[newState.turnIndex]];
    return newState;
  },

  checkWinCondition: (state) => {
    for (const p of state.playerOrder) {
      if (state.hands[p].value.length === 0) {
        return {
          isFinished: true,
          winnerIds: [p],
          message: `${p} wins`,
        };
      }
    }
    return { isFinished: false };
  },

  getLegalActions: (state, playerId) => {
    if (state.status === "WAITING") {
      const start: UnoAction = { type: "START", playerId };
      return UnoRuleset.isValidAction(state, start) ? [start] : [];
    }
    if (state.status !== "PLAYING") return [];
    const player = state.playerOrder[state.turnIndex];
    if (player !== playerId) return [];

    const actions: UnoAction[] = [];
    const hand = state.hands[player].value;
    const top = state.discard[state.discard.length - 1];

    for (const card of hand) {
      const v = cardValue(card);
      const c = cardColor(card);

      if (c === state.currentColor || v === cardValue(top) || c === 4) {
        if (c === 4) {
          // Wild cards: must choose color
          for (let color = 0; color < 4; color++) {
            actions.push({ type: "PLAY", card, color, playerId });
          }
        } else {
          actions.push({ type: "PLAY", card, playerId });
        }
      }
    }

    actions.push({ type: "DRAW", playerId });

    // Can only PASS if they have already drawn or similar rule?
    // For simplicity, always allow DRAW then PASS if no playable cards.
    actions.push({ type: "PASS", playerId });

    return actions;
  },
};

function cardColor(card: number) {
  // 0: Red, 1: Yellow, 2: Green, 3: Blue, 4: Wild
  return Math.floor(card / 100);
}

function cardValue(card: number) {
  // 0-9: Numbers, 10: Skip, 11: Reverse, 12: Draw2, 13: Wild, 14: WildDraw4
  return card % 100;
}

function createDeck(): number[] {
  const deck: number[] = [];
  // Colors 0-3
  for (let c = 0; c < 4; c++) {
    // One 0
    deck.push(c * 100 + 0);
    // Two of 1-9
    for (let v = 1; v <= 9; v++) {
      deck.push(c * 100 + v);
      deck.push(c * 100 + v);
    }
    // Two of Skip, Reverse, Draw2
    for (let v = 10; v <= 12; v++) {
      deck.push(c * 100 + v);
      deck.push(c * 100 + v);
    }
  }
  // Wild and WildDraw4 (4 of each)
  for (let i = 0; i < 4; i++) {
    deck.push(400 + 13); // Wild
    deck.push(400 + 14); // WildDraw4
  }
  return deck;
}

function shuffle(array: number[], rng?: IGameRNG) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = requireRng(rng).nextInt(0, i);
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function drawCards(state: UnoState, playerId: string, count: number, rng?: IGameRNG) {
  const deck = [...state.deck.value];
  const hand = [...state.hands[playerId].value];
  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      // Reshuffle discard pile except the top card
      const top = state.discard.pop()!;
      deck.push(...state.discard);
      state.discard = [top];
      shuffle(deck, rng);
    }
    const card = deck.pop();
    if (card !== undefined) {
      hand.push(card);
    }
  }
  state.deck = secretDeck(deck);
  state.hands[playerId] = secretHand(hand, playerId);
}

function getNextTurnIndex(state: UnoState): number {
  const n = state.playerOrder.length;
  return (state.turnIndex + state.direction + n) % n;
}

function advanceTurn(state: UnoState) {
  state.turnIndex = getNextTurnIndex(state);
}
