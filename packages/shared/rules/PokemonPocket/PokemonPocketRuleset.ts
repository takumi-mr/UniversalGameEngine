import { BaseGameState, GameRuleset } from '../../GameRules';
import type { IGameRNG } from '../../utils/IGameRNG';
import { EnergyType, PokemonPocketRegistry } from './PokemonPocketRegistry';

// ==========================================
// 1. 状態とアクションの定義
// ==========================================

export interface PokemonInstance {
    instanceId: string;
    evolutionStack: string[];
    damageTaken: number;
    attachedEnergy: EnergyType[];
}

export interface PocketPlayer {
    id: string;
    deck: string[];
    hand: string[];
    discard: string[];
    points: number; // サイドカードの代わりにポイント (3ポイントで勝利)
    active: PokemonInstance | null; // バトル場 (1体)
    bench: PokemonInstance[];       // ベンチ (最大3体)
    hasAttachedEnergyThisTurn: boolean;
    energyZoneType: EnergyType; // このデッキが毎ターン発生させるエネルギのタイプ(簡易化)
}

export interface PokemonPocketState extends BaseGameState {
    turnCount: number;
    effectStack: any[];
    playerData: Record<string, PocketPlayer>;
}

export type PokemonPocketAction =
    | { type: 'PLAY_BASIC'; playerId: string; cardDefId: string; targetZone: 'ACTIVE' | 'BENCH' }
    | { type: 'ATTACH_ENERGY'; playerId: string; energyType: EnergyType; targetInstanceId: string }
    | { type: 'PLAY_TRAINER'; playerId: string; cardDefId: string; targetInstanceId?: string }
    | { type: 'EVOLVE'; playerId: string; cardDefId: string; targetInstanceId: string }
    | { type: 'ATTACK'; playerId: string; attackIndex: number }
    | { type: 'END_TURN'; playerId: string };

// ==========================================
// 2. ルールセット本体
// ==========================================

export class PokemonPocketRuleset implements GameRuleset<PokemonPocketState, PokemonPocketAction> {

    public getInitialState(options?: { playerIds?: string[] }, _rng?: IGameRNG): PokemonPocketState {
        const playerData: Record<string, PocketPlayer> = {};
        const playerIds = options?.playerIds || [];

        // 簡易的な初期化: お互いにバトル場にポケモンが1体いて、手札5枚、デッキ14枚
        // 後攻プレイヤーは1ターン目から攻撃可能。先攻は不可。エネルギー添付は先攻1ターン目は不可にする。
        playerIds.forEach((id, idx) => {
            const isP1 = idx === 0;
            const initialCardId = isP1 ? 'p_pikachu' : 'p_charmander';
            const deck = isP1
                ? Array(14).fill('p_pikachu').concat(['t_potion', 't_pokeball'])
                : Array(14).fill('p_charmander').concat(['t_potion', 't_pokeball']);

            playerData[id] = {
                id,
                deck,
                hand: ['t_professor_research', 't_potion', initialCardId, isP1 ? 'p_pikachu_ex' : 'p_charizard_ex', isP1 ? 'p_pikachu' : 'p_charmeleon'],
                discard: [],
                points: 0,
                active: {
                    instanceId: `inst_${id}_active`,
                    evolutionStack: [initialCardId],
                    damageTaken: 0,
                    attachedEnergy: []
                },
                bench: [],
                hasAttachedEnergyThisTurn: isP1, // Pocketルール：先攻1ターン目はエネルギーをつけられない
                energyZoneType: isP1 ? 'LIGHTNING' : 'FIRE'
            };
        });

        return {
            status: 'PLAYING',
            players: Object.fromEntries(playerIds.map(id => [id, id])),
            activePlayers: playerIds.length > 0 ? [playerIds[0]] : [],
            turnCount: 1,
            effectStack: [],
            playerData
        };
    }

    public isValidAction(state: PokemonPocketState, action: PokemonPocketAction): boolean {
        if (!state.activePlayers?.includes(action.playerId)) return false;
        const player = state.playerData[action.playerId];

        const isFirstTurnFirstPlayer = state.turnCount === 1;

        if (action.type === 'ATTACH_ENERGY') {
            if (player.hasAttachedEnergyThisTurn) return false;
            return true; // Pocketはエナジーゾーンから毎ターン1枚つけられる
        }
        if (action.type === 'ATTACK') {
            // Pocketルール：先攻の最初のターンはワザが使えない
            if (isFirstTurnFirstPlayer) return false;

            const active = player.active;
            if (!active) return false;
            const topCardId = active.evolutionStack[active.evolutionStack.length - 1];
            const def = PokemonPocketRegistry[topCardId];

            const attack = def.attacks?.[action.attackIndex];
            if (!attack) return false;
            return this.hasEnoughEnergy(active.attachedEnergy, attack.cost);
        }
        if (action.type === 'EVOLVE') {
            const def = PokemonPocketRegistry[action.cardDefId];
            if (!player.hand.includes(action.cardDefId) || def.stage === 'BASIC' || !def.stage) return false;

            const target = [player.active, ...player.bench].find(p => p?.instanceId === action.targetInstanceId);
            if (!target) return false;

            const currentTopCard = target.evolutionStack[target.evolutionStack.length - 1];
            return def.evolvesFrom === currentTopCard;
        }
        if (action.type === 'PLAY_BASIC') {
            const def = PokemonPocketRegistry[action.cardDefId];
            if (!player.hand.includes(action.cardDefId) || def.category !== 'POKEMON' || def.stage === 'STAGE1' || def.stage === 'STAGE2') return false;
            if (action.targetZone === 'ACTIVE' && player.active) return false;
            if (action.targetZone === 'BENCH' && player.bench.length >= 3) return false; // Pocketルール：ベンチは3体まで
            return true;
        }
        if (action.type === 'PLAY_TRAINER') {
            return player.hand.includes(action.cardDefId) && PokemonPocketRegistry[action.cardDefId].category === 'TRAINER';
        }
        return true;
    }

    public reduce(state: PokemonPocketState, action: PokemonPocketAction, rng?: IGameRNG): PokemonPocketState {
        const nextState = JSON.parse(JSON.stringify(state)) as PokemonPocketState;
        const player = nextState.playerData[action.playerId];

        if (action.type === 'PLAY_BASIC') {
            const handIdx = player.hand.indexOf(action.cardDefId);
            if (handIdx > -1) {
                player.hand.splice(handIdx, 1);
                const newPokemon: PokemonInstance = {
                    instanceId: rng ? Math.floor(rng.nextFloat() * 1000000).toString() : Math.random().toString(),
                    evolutionStack: [action.cardDefId],
                    damageTaken: 0,
                    attachedEnergy: []
                };

                if (action.targetZone === 'ACTIVE' && !player.active) player.active = newPokemon;
                else if (action.targetZone === 'BENCH' && player.bench.length < 3) player.bench.push(newPokemon);
            }
        }
        else if (action.type === 'EVOLVE') {
            const target = [player.active, ...player.bench].find(p => p?.instanceId === action.targetInstanceId);
            if (target) {
                const handIdx = player.hand.indexOf(action.cardDefId);
                player.hand.splice(handIdx, 1);
                target.evolutionStack.push(action.cardDefId);

                const def = PokemonPocketRegistry[action.cardDefId];
                if (def.onPlay) {
                    nextState.effectStack.push({ type: 'RESOLVE_ABILITY', cardDefId: def.id, targetInstanceId: target.instanceId });
                }
            }
        }
        else if (action.type === 'ATTACH_ENERGY') {
            const target = [player.active, ...player.bench].find(p => p?.instanceId === action.targetInstanceId);
            if (target) {
                target.attachedEnergy.push(action.energyType);
                player.hasAttachedEnergyThisTurn = true;
            }
        }
        else if (action.type === 'PLAY_TRAINER') {
            const handIdx = player.hand.indexOf(action.cardDefId);
            if (handIdx > -1) {
                player.hand.splice(handIdx, 1);
                player.discard.push(action.cardDefId);
                const def = PokemonPocketRegistry[action.cardDefId];
                if (def.onPlay) {
                    def.onPlay(nextState, action.playerId, action.targetInstanceId);
                }
            }
        }
        else if (action.type === 'ATTACK') {
            const active = player.active!;
            const topCardId = active.evolutionStack[active.evolutionStack.length - 1];
            const def = PokemonPocketRegistry[topCardId];
            const attack = def.attacks![action.attackIndex];

            const opponentId = Object.keys(nextState.playerData).find(id => id !== action.playerId)!;
            const opponent = nextState.playerData[opponentId];

            if (opponent.active) {
                // Weakness logic could be inserted here
                nextState.effectStack.push({
                    type: 'DEAL_DAMAGE',
                    sourceId: action.playerId,
                    targetInstanceId: opponent.active.instanceId,
                    amount: attack.damage
                });
            }

            nextState.effectStack.push({ type: 'RESOLVE_END_TURN', playerId: action.playerId });
        }
        else if (action.type === 'END_TURN') {
            this.endTurn(nextState, action.playerId);
        }

        // スタックの解決
        while (nextState.effectStack.length > 0) {
            const event = nextState.effectStack.shift()!;
            this.processEvent(nextState, event);
        }

        return nextState;
    }

    private processEvent(state: PokemonPocketState, event: any) {
        if (event.type === 'DEAL_DAMAGE') {
            let targetPlayer: PocketPlayer | undefined;
            let targetPokemon: PokemonInstance | undefined;

            for (const p of Object.values(state.playerData)) {
                if (p.active?.instanceId === event.targetInstanceId) {
                    targetPlayer = p;
                    if (targetPlayer.active) targetPokemon = targetPlayer.active;
                }
            }

            if (targetPokemon && targetPlayer) {
                targetPokemon.damageTaken += event.amount;

                const currentTopCard = targetPokemon.evolutionStack[targetPokemon.evolutionStack.length - 1];
                const maxHp = PokemonPocketRegistry[currentTopCard].hp!;
                const remainingHp = maxHp - targetPokemon.damageTaken;

                // きぜつ (Knock Out) 判定
                if (remainingHp <= 0) {
                    targetPlayer.discard.push(...targetPokemon.evolutionStack);
                    targetPlayer.active = null;

                    // Pocketルール：サイド取得の代わりにポイント獲得
                    const attacker = state.playerData[event.sourceId];
                    const pointsGained = PokemonPocketRegistry[currentTopCard].points || 1;
                    attacker.points += pointsGained;
                }
            }
        }
        else if (event.type === 'HEAL') {
            let targetPokemon: PokemonInstance | undefined;
            for (const p of Object.values(state.playerData)) {
                targetPokemon = [p.active, ...p.bench].find(poke => poke?.instanceId === event.targetInstanceId) || undefined;
                if (targetPokemon) break;
            }
            if (targetPokemon) {
                targetPokemon.damageTaken = Math.max(0, targetPokemon.damageTaken - event.amount);
            }
        }
        else if (event.type === 'DRAW_CARDS') {
            const player = state.playerData[event.playerId];
            for (let i = 0; i < event.amount; i++) {
                if (player.deck.length > 0) {
                    player.hand.push(player.deck.pop()!);
                }
            }
        }
        else if (event.type === 'RESOLVE_END_TURN') {
            this.endTurn(state, event.playerId);
        }
    }

    private endTurn(state: PokemonPocketState, currentPlayerId: string) {
        const p = state.playerData[currentPlayerId];
        p.hasAttachedEnergyThisTurn = false;

        const allIds = Object.keys(state.playerData);
        const nextIdx = (allIds.indexOf(currentPlayerId) + 1) % allIds.length;
        const nextPlayerId = allIds[nextIdx];

        state.activePlayers = [nextPlayerId];
        state.turnCount += 1;

        // ターン開始時にワンドロー
        const nextPlayer = state.playerData[nextPlayerId];
        if (nextPlayer.deck.length > 0) {
            nextPlayer.hand.push(nextPlayer.deck.pop()!);
        }
    }

    private hasEnoughEnergy(attached: EnergyType[], cost: Partial<Record<EnergyType, number>>): boolean {
        const attachedCounts = attached.reduce((acc, type) => {
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {} as Record<EnergyType, number>);

        const colorlessNeeded = cost['COLORLESS'] || 0;

        for (const [type, requiredAmount] of Object.entries(cost)) {
            if (type === 'COLORLESS') continue;
            const available = attachedCounts[type as EnergyType] || 0;
            if (available < requiredAmount) return false;
            attachedCounts[type as EnergyType] -= requiredAmount;
        }

        const remainingTotal = Object.values(attachedCounts).reduce((a, b) => a + b, 0);
        return remainingTotal >= colorlessNeeded;
    }

    public checkWinCondition(state: PokemonPocketState): { isFinished: boolean; winnerIds?: string[]; message?: string } {
        const playerIds = Object.keys(state.playerData);

        for (const playerId of playerIds) {
            const player = state.playerData[playerId];

            // 1. 3ポイント以上獲得で勝利
            if (player.points >= 3) {
                return {
                    isFinished: true,
                    winnerIds: [playerId],
                    message: `Player ${playerId} won by getting 3 points!`
                };
            }

            // 2. バトル場にポケモンがおらず、ベンチにもいない場合は敗北
            if (player.active === null && player.bench.length === 0) {
                const opponentId = playerIds.find(id => id !== playerId) || 'Opponent';
                return {
                    isFinished: true,
                    winnerIds: [opponentId],
                    message: `Player ${playerId} has no Pokémon left. Player ${opponentId} won!`
                };
            }

            // 3. 山札切れの場合 (Pocketでは山札が引けないターンが来ると負けだが、ここではシンプルにするか省略)
        }

        return { isFinished: false };
    }

    public getLegalActions(_state: PokemonPocketState, _playerId: string): PokemonPocketAction[] {
        // AI等のための合法手生成ロジックは省略
        return [];
    }
}
