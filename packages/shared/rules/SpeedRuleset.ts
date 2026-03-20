import type { BaseGameState, BaseGameAction, GameRuleset } from '../GameRules';
import type { IGameRNG } from '../utils/IGameRNG';

export type Card = string; // e.g., 'AS', '2H', 'TD', 'KC'

export interface SpeedState extends BaseGameState {
    playerIds: string[];
    hands: Record<string, Card[]>;
    personalDecks: Record<string, Card[]>;
    centerPiles: [Card, Card];
    sidePiles: [Card[], Card[]];
    isStuck: Record<string, boolean>;
}

export interface SpeedAction extends BaseGameAction {
    type: 'PLAY' | 'FLIP' | 'START';
    card?: Card;
    pileIndex?: number; // 0 or 1
}

// Helper: Card strength (Rank only for Speed)
function getRankValue(card: Card): number {
    const rank = card.charAt(0);
    if (rank === 'A') return 1;
    if (rank === 'T') return 10;
    if (rank === 'J') return 11;
    if (rank === 'Q') return 12;
    if (rank === 'K') return 13;
    const val = parseInt(rank, 10);
    return isNaN(val) ? 0 : val;
}

function isSequential(val1: number, val2: number): boolean {
    const diff = Math.abs(val1 - val2);
    // Standard Speed: A-2, 2-3, ..., Q-K, K-A
    return diff === 1 || diff === 12;
}

function createDeck(rng?: IGameRNG): Card[] {
    const suits = ['S', 'H', 'D', 'C'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
    const deck: Card[] = [];
    for (const s of suits) {
        for (const r of ranks) {
            deck.push(`${r}${s}`);
        }
    }
    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = rng ? rng.nextInt(0, i) : Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export const SpeedRuleset: GameRuleset<SpeedState, SpeedAction> = {
    getInitialState: (options?: any, rng?: IGameRNG): SpeedState => {
        const playerIds = options?.playerIds || [];
        return {
            status: 'WAITING',
            playerIds,
            players: playerIds.length > 0
                ? playerIds.reduce((acc: any, id: string) => ({ ...acc, [id]: id }), {})
                : { 0: null, 1: null },
            hands: {},
            personalDecks: {},
            centerPiles: ['', ''],
            sidePiles: [[], []],
            isStuck: {},
        };
    },

    isValidAction: (state, action) => {
        const pId = action.playerId!;
        if (action.type === 'START') {
            return state.status === 'WAITING' && Object.values(state.players || {}).filter(Boolean).length === 2;
        }

        if (state.status !== 'PLAYING') return false;

        if (action.type === 'PLAY') {
            const { card, pileIndex } = action;
            if (!card || pileIndex === undefined || pileIndex < 0 || pileIndex > 1) return false;

            // Does player have the card?
            if (!state.hands[pId].includes(card)) return false;

            // Is it sequential to the top card of the pile?
            const topCard = state.centerPiles[pileIndex];
            return isSequential(getRankValue(card), getRankValue(topCard));
        }

        if (action.type === 'FLIP') {
            // Can only flip if both players agree they are stuck
            return true;
        }

        return false;
    },

    reduce: (state, action, rng?: IGameRNG) => {
        const newState = structuredClone(state);
        const pId = action.playerId!;

        if (action.type === 'START') {
            const players = Object.values(newState.players || {}).filter(Boolean) as string[];
            newState.playerIds = players;
            const deck = createDeck(rng);

            // Setup Speed
            // Each player: 5 in hand, 15 in personal deck
            // Center: 2 cards
            // Side piles: 5 cards each
            // Total: 20*2 + 2 + 5*2 = 40 + 2 + 10 = 52 cards. Correct.

            newState.hands = {};
            newState.personalDecks = {};
            players.forEach((id, idx) => {
                newState.personalDecks[id] = deck.splice(0, 15);
                newState.hands[id] = deck.splice(0, 5);
                newState.isStuck[id] = false;
            });

            newState.centerPiles = [deck.pop()!, deck.pop()!];
            newState.sidePiles = [deck.splice(0, 5), deck.splice(0, 5)];
            newState.status = 'PLAYING';
            return newState;
        }

        if (action.type === 'PLAY') {
            const { card, pileIndex } = action;
            if (!card || pileIndex === undefined) return state;

            // Remove from hand
            newState.hands[pId] = newState.hands[pId].filter(c => c !== card);
            
            // Update center pile
            newState.centerPiles[pileIndex] = card;

            // Replenish hand from personal deck
            if (newState.personalDecks[pId].length > 0) {
                const nextCard = newState.personalDecks[pId].pop()!;
                newState.hands[pId].push(nextCard);
            }

            // Once someone plays, nobody is stuck anymore
            Object.keys(newState.isStuck).forEach(id => newState.isStuck[id] = false);
        }

        if (action.type === 'FLIP') {
            newState.isStuck[pId] = true;
            const allStuck = newState.playerIds.every(id => newState.isStuck[id]);

            if (allStuck) {
                // If both stuck, flip from side piles
                if (newState.sidePiles[0].length > 0 || newState.sidePiles[1].length > 0) {
                    if (newState.sidePiles[0].length > 0) newState.centerPiles[0] = newState.sidePiles[0].pop()!;
                    if (newState.sidePiles[1].length > 0) newState.centerPiles[1] = newState.sidePiles[1].pop()!;
                } else {
                    // Side piles empty? Reshuffle center piles back into side piles?
                    // In real speed, you might reshuffle or end in a draw.
                    // Let's just say if everything is empty and stuck, it's a draw?
                    // Actually, let's just end it.
                }
                // Reset stuck status after flip
                Object.keys(newState.isStuck).forEach(id => newState.isStuck[id] = false);
            }
        }

        return newState;
    },

    checkWinCondition: (state) => {
        for (const pId of state.playerIds) {
            if (state.hands[pId].length === 0 && state.personalDecks[pId].length === 0) {
                return { isFinished: true, winnerIds: [pId], message: `${pId} wins!` };
            }
        }
        
        // Stuck condition: no side piles left and both stuck
        const allStuck = state.playerIds.length === 2 && state.playerIds.every(id => state.isStuck[id]);
        const sidePilesEmpty = state.sidePiles.every(p => p.length === 0);
        if (allStuck && sidePilesEmpty) {
            return { isFinished: true, winnerIds: [], message: "It's a draw! (No more cards to flip)" };
        }

        return { isFinished: false };
    },

    getLegalActions: (state, playerId) => {
        if (state.status !== 'PLAYING') return [];
        const actions: SpeedAction[] = [];

        const hand = state.hands[playerId];
        if (!hand) return [];

        for (const card of hand) {
            for (let i = 0; i < 2; i++) {
                const topCard = state.centerPiles[i];
                if (isSequential(getRankValue(card), getRankValue(topCard))) {
                    actions.push({ type: 'PLAY', card, pileIndex: i, playerId });
                }
            }
        }

        actions.push({ type: 'FLIP', playerId });
        return actions;
    },

    maskState: (state, playerId) => {
        const masked = structuredClone(state);
        for (const id of state.playerIds) {
            if (id !== playerId) {
                // Hide opponent's hand and personal deck cards (but keep counts)
                masked.hands[id] = state.hands[id].map(() => '?');
                masked.personalDecks[id] = state.personalDecks[id].map(() => '?');
            }
        }
        // Hide side piles
        masked.sidePiles = state.sidePiles.map(p => p.map(() => '?')) as [Card[], Card[]];
        return masked;
    }
};
