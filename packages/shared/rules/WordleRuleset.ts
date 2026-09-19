import { requireRng } from "@engine/shared/utils/requireRng";
import type { BaseGameState, BaseGameAction, GameRuleset } from "@engine/shared/GameRules";
import { createSecret, type Secret } from "@engine/shared/GameRules";
import type { IGameRNG } from "@engine/shared/utils/IGameRNG";

// --- 型定義 ---
/** 1 文字の判定。correct = 位置も一致、present = 別の位置にある、absent = 含まれない */
export type WordleTileResult = "correct" | "present" | "absent";

export interface WordleState extends BaseGameState {
  secretWord: Secret<string>; // 正解（終局まで誰にも見えない）
  guesses: string[];
  results: WordleTileResult[][]; // guesses[i] の各文字の判定（サーバーが計算する。クライアントは正解を知らない）
  maxGuesses: number;
  currentRow: number;
}

export type WordleActionType = "GUESS" | "START";

export interface WordleAction extends BaseGameAction {
  type: WordleActionType;
  word?: string;
}

const WORDS = [
  "APPLE",
  "BEACH",
  "BRAIN",
  "BREAD",
  "BRUSH",
  "CHAIR",
  "CHEST",
  "CHORD",
  "CLICK",
  "CLOCK",
  "CLOUD",
  "DANCE",
  "DIARY",
  "DRINK",
  "EARTH",
  "FEAST",
  "FIELD",
  "FRUIT",
  "GLASS",
  "GRAPE",
  "GREEN",
  "GUITAR",
  "HEART",
  "HOUSE",
  "JUICE",
  "LIGHT",
  "LEMON",
  "MELON",
  "MONEY",
  "MUSIC",
  "NIGHT",
  "OCEAN",
  "PARTY",
  "PIANO",
  "PILOT",
  "PLANE",
  "PLANT",
  "RADIO",
  "RIVER",
  "ROBOT",
  "SHIRT",
  "SHOES",
  "SMILE",
  "SNAKE",
  "SPACE",
  "SPOON",
  "STORM",
  "TABLE",
  "TIGER",
  "TOAST",
  "TOUCH",
  "TRAIN",
  "TRUCK",
  "VOICE",
  "WATER",
  "WATCH",
  "WHALE",
  "WORLD",
  "WRITE",
  "YACHT",
];

/** 正解を Secret に包む（終局まで誰にも見えない） */
function secretWordOf(word: string): Secret<string> {
  return createSecret(word, [], "");
}

/**
 * 推測を正解と照合する（同じ文字が複数あるときは正解側の残り数だけ present にする、標準の Wordle 判定）
 */
export function evaluateGuess(guess: string, secret: string): WordleTileResult[] {
  const result: WordleTileResult[] = Array(guess.length).fill("absent");
  const remaining: Record<string, number> = {};
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === secret[i]) {
      result[i] = "correct";
    } else {
      remaining[secret[i]] = (remaining[secret[i]] ?? 0) + 1;
    }
  }
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === "correct") continue;
    if ((remaining[guess[i]] ?? 0) > 0) {
      result[i] = "present";
      remaining[guess[i]]--;
    }
  }
  return result;
}

export const WordleRuleset: GameRuleset<WordleState, WordleAction> = {
  getInitialState: (_options?: unknown, rng?: IGameRNG): WordleState => {
    const secretWord = WORDS[requireRng(rng, "Wordle").nextInt(0, WORDS.length - 1)];
    return {
      status: "WAITING",
      secretWord: secretWordOf(secretWord),
      guesses: [],
      results: [],
      maxGuesses: 6,
      currentRow: 0,
      players: {
        1: null,
      },
      activePlayers: [],
    };
  },

  isValidAction: (state, action) => {
    if (action.type === "START") return true;

    if (state.status !== "PLAYING") return false;
    if (action.type !== "GUESS") return false;

    if (!action.word || action.word.length !== 5) return false;

    // 手番プレイヤーチェック
    if (state.players) {
      const currentPlayerId = state.players[1];
      if (currentPlayerId && action.playerId !== currentPlayerId) {
        return false;
      }
    }

    if (state.currentRow >= state.maxGuesses) return false;

    return true;
  },

  reduce: (state, action, rng?: IGameRNG) => {
    if (action.type === "START") {
      const newState = WordleRuleset.getInitialState(undefined, rng);
      newState.status = "PLAYING";
      if (state.players) {
        newState.players = { ...state.players };
        const player1 = state.players[1];
        newState.activePlayers = player1 ? [player1] : [];
      }
      return newState;
    }

    const newState = structuredClone(state);

    switch (action.type) {
      case "GUESS": {
        if (!action.word) break;

        const guess = action.word.toUpperCase();
        newState.guesses.push(guess);
        newState.results.push(evaluateGuess(guess, state.secretWord.value));
        newState.currentRow++;

        break;
      }
    }

    return newState;
  },

  checkWinCondition: (state) => {
    if (state.guesses.length === 0) return { isFinished: false };

    const lastGuess = state.guesses[state.guesses.length - 1];
    const secretWord = state.secretWord.value;
    if (lastGuess === secretWord) {
      const winnerId = state.players?.[1] || Object.values(state.players || {})[0];
      return {
        isFinished: true,
        winnerIds: winnerId ? [winnerId] : [],
        message: "Correct! The word was " + secretWord,
      };
    }

    if (state.currentRow >= state.maxGuesses) {
      return {
        isFinished: true,
        winnerIds: [],
        message: "Game Over. The word was " + secretWord,
      };
    }

    return { isFinished: false };
  },

  // 終局したら正解を開示する
  applyWinResult: (state, winResult) => ({
    ...state,
    status: "FINISHED",
    message: winResult.message,
    activePlayers: [],
    secretWord: createSecret(state.secretWord.value, ["*"]),
  }),

  getLegalActions: (state, playerId) => {
    const actions: WordleAction[] = [];

    if (state.status === "FINISHED") {
      actions.push({ type: "START", playerId });
    }

    if (state.status === "PLAYING") {
      // 手番チェック
      let isMyTurn = true;
      if (state.players) {
        const current = state.players[1];
        if (current && current !== playerId) isMyTurn = false;
      }

      if (isMyTurn) {
        actions.push({ type: "GUESS", playerId });
        actions.push({ type: "START", playerId }); // 途中でリセットも許可
      }
    }

    return actions;
  },
};
