import type { BaseGameState, BaseGameAction, GameRuleset } from '../GameRules';
import type { IGameRNG } from '../utils/IGameRNG';

// --- 型定義 ---
export interface WordleState extends BaseGameState {
    secretWord: string;
    guesses: string[];
    maxGuesses: number;
    currentRow: number;
}

export type WordleActionType = 'GUESS' | 'START';

export interface WordleAction extends BaseGameAction {
    type: WordleActionType;
    word?: string;
}

const WORDS = [
    'APPLE', 'BEACH', 'BRAIN', 'BREAD', 'BRUSH',
    'CHAIR', 'CHEST', 'CHORD', 'CLICK', 'CLOCK',
    'CLOUD', 'DANCE', 'DIARY', 'DRINK', 'EARTH',
    'FEAST', 'FIELD', 'FRUIT', 'GLASS', 'GRAPE',
    'GREEN', 'GUITAR', 'HEART', 'HOUSE', 'JUICE',
    'LIGHT', 'LEMON', 'MELON', 'MONEY', 'MUSIC',
    'NIGHT', 'OCEAN', 'PARTY', 'PIANO', 'PILOT',
    'PLANE', 'PLANT', 'RADIO', 'RIVER', 'ROBOT',
    'SHIRT', 'SHOES', 'SMILE', 'SNAKE', 'SPACE',
    'SPOON', 'STORM', 'TABLE', 'TIGER', 'TOAST',
    'TOUCH', 'TRAIN', 'TRUCK', 'VOICE', 'WATER',
    'WATCH', 'WHALE', 'WORLD', 'WRITE', 'YACHT'
];

export const WordleRuleset: GameRuleset<WordleState, WordleAction> = {

    getInitialState: (options?: any, rng?: IGameRNG): WordleState => {
        const secretWord = WORDS[rng ? rng.nextInt(0, WORDS.length - 1) : Math.floor(Math.random() * WORDS.length)];
        return {
            status: 'WAITING',
            secretWord: secretWord,
            guesses: [],
            maxGuesses: 6,
            currentRow: 0,
            players: {
                1: null
            },
            activePlayers: []
        };
    },

    isValidAction: (state, action) => {
        if (action.type === 'START') return true;

        if (state.status !== 'PLAYING') return false;
        if (action.type !== 'GUESS') return false;

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

    reduce: (state, action, _rng?: IGameRNG) => {
        if (action.type === 'START') {
            const newState = WordleRuleset.getInitialState();
            newState.status = 'PLAYING';
            if (state.players) {
                newState.players = { ...state.players };
                const player1 = state.players[1];
                newState.activePlayers = player1 ? [player1] : [];
            }
            return newState;
        }

        const newState = structuredClone(state);

        switch (action.type) {
            case 'GUESS': {
                if (!action.word) break;

                const guess = action.word.toUpperCase();
                newState.guesses.push(guess);
                newState.currentRow++;

                break;
            }
        }

        return newState;
    },

    checkWinCondition: (state) => {
        if (state.guesses.length === 0) return { isFinished: false };

        const lastGuess = state.guesses[state.guesses.length - 1];
        if (lastGuess === state.secretWord) {
            const winnerId = state.players?.[1] || Object.values(state.players || {})[0];
            return {
                isFinished: true,
                winnerIds: winnerId ? [winnerId] : [],
                message: "Correct! The word was " + state.secretWord
            };
        }

        if (state.currentRow >= state.maxGuesses) {
            return {
                isFinished: true,
                winnerIds: [],
                message: "Game Over. The word was " + state.secretWord
            };
        }

        return { isFinished: false };
    },

    applyWinResult: (state, winResult) => ({
        ...state,
        status: 'FINISHED',
        message: winResult.message,
        activePlayers: [],
    }),

    getLegalActions: (state, playerId) => {
        const actions: WordleAction[] = [];

        if (state.status === 'FINISHED') {
            actions.push({ type: 'START', playerId });
        }

        if (state.status === 'PLAYING') {
            // 手番チェック
            let isMyTurn = true;
            if (state.players) {
                const current = state.players[1];
                if (current && current !== playerId) isMyTurn = false;
            }

            if (isMyTurn) {
                actions.push({ type: 'GUESS', playerId });
                actions.push({ type: 'START', playerId }); // 途中でリセットも許可
            }
        }

        return actions;
    }
};
