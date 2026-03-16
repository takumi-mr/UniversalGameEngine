import { BaseGameState, BaseGameAction, GameRuleset } from '../../GameRules';
import { CardCategory, EnergyType, CardDefinition, PokemonTCGRegistry } from './PokemonTCGRegistry';
// ==========================================
// 1. データ定義 (The Card Registry)
// ==========================================

export interface AttackDef {
    name: string;
    cost: Partial<Record<EnergyType, number>>; // ワザのエネルギー要求 (例: { LIGHTNING: 1, COLORLESS: 1 })
    damage: number;
    // ワザの追加効果などがあればここにフックを定義
}


// ==========================================
// 2. 状態とアクションの定義
// ==========================================

// 盤面にいるポケモンの実体（インスタンス）
export interface PokemonInstance {
    instanceId: string;

    evolutionStack: string[];
    damageTaken: number;

    attachedEnergy: EnergyType[];
}

export interface PTCGPlayer {
    id: string;
    deck: string[];
    hand: string[];
    discard: string[];
    prizes: string[]; // サイドカード
    active: PokemonInstance | null; // バトル場 (1体)
    bench: PokemonInstance[];       // ベンチ (最大5体)
    hasAttachedEnergyThisTurn: boolean; // 1ターンに1枚の制限用フラグ
}

export interface PokemonTCGState extends BaseGameState {
    turnCount: number;
    effectStack: any[];
    playerData: Record<string, PTCGPlayer>;
}

export type PokemonTCGAction =
    | { type: 'PLAY_BASIC'; playerId: string; cardDefId: string; targetZone: 'ACTIVE' | 'BENCH' }
    | { type: 'ATTACH_ENERGY'; playerId: string; cardDefId: string; targetInstanceId: string }
    | { type: 'PLAY_TRAINER'; playerId: string; cardDefId: string; targetInstanceId?: string }
    | { type: 'EVOLVE'; playerId: string; cardDefId: string; targetInstanceId: string }
    | { type: 'ATTACK'; playerId: string; attackIndex: number } // ワザを使うとターン終了
    | { type: 'END_TURN'; playerId: string };

// ==========================================
// 3. ルールセット本体
// ==========================================

export class PokemonTCGRuleset implements GameRuleset<PokemonTCGState, PokemonTCGAction> {

    // (初期化処理は簡略化: お互いにバトル場にポケモンが1体いて、サイドが3枚ある状態からスタートとします)
    public getInitialState(options: { playerIds: string[] }): PokemonTCGState {
        const playerData: Record<string, PTCGPlayer> = {};
        options.playerIds.forEach((id, idx) => {
            const isP1 = idx === 0;
            const initialCardId = isP1 ? 'p_pikachu' : 'p_charmander';
            playerData[id] = {
                id,
                deck: [], hand: [isP1 ? 'e_lightning' : 'e_fire', 't_potion', initialCardId],
                discard: [],
                prizes: ['prize1', 'prize2', 'prize3'], // 本来は山札から裏向きに置く
                active: {
                    instanceId: `inst_${id}_active`,
                    evolutionStack: [initialCardId],
                    damageTaken: 0,
                    attachedEnergy: []
                },
                bench: [],
                hasAttachedEnergyThisTurn: false
            };
        });

        return {
            status: 'PLAYING',
            players: Object.fromEntries(options.playerIds.map(id => [id, id])),
            activePlayers: [options.playerIds[0]],
            turnCount: 1,
            effectStack: [],
            playerData
        };
    }

    public isValidAction(state: PokemonTCGState, action: PokemonTCGAction): boolean {
        if (!state.activePlayers?.includes(action.playerId)) return false;
        const player = state.playerData[action.playerId];

        if (action.type === 'ATTACH_ENERGY') {
            // ★ポケカ特有のルール: エネルギーは1ターンに1枚まで
            if (player.hasAttachedEnergyThisTurn) return false;
            return player.hand.includes(action.cardDefId);
        }
        if (action.type === 'ATTACK') {
            // アクティブポケモンがいて、必要なエネルギーが貼られているかチェック
            const active = player.active;
            if (!active) return false;
            const topCardId = active.evolutionStack[active.evolutionStack.length - 1];
            const def = PokemonTCGRegistry[topCardId];

            const attack = def.attacks?.[action.attackIndex];
            if (!attack) return false;
            return this.hasEnoughEnergy(active.attachedEnergy, attack.cost);
        }
        if (action.type === 'EVOLVE') {
            const player = state.playerData[action.playerId];
            const def = PokemonTCGRegistry[action.cardDefId];

            // 手札にあるか？ 1進化以上か？
            if (!player.hand.includes(action.cardDefId) || def.stage === 'BASIC') return false;

            const target = [player.active, ...player.bench].find(p => p?.instanceId === action.targetInstanceId);
            if (!target) return false;

            // 進化元のチェック: 現在の一番上のカードが、evolvesFrom と一致しているか？
            const currentTopCard = target.evolutionStack[target.evolutionStack.length - 1];
            return def.evolvesFrom === currentTopCard;

            // 本来は「場に出たばかりのターンは進化できない」という判定もここに入ります
        }
        return true;
    }

    public reduce(state: PokemonTCGState, action: PokemonTCGAction): PokemonTCGState {
        const nextState = JSON.parse(JSON.stringify(state)) as PokemonTCGState;
        const player = nextState.playerData[action.playerId];

        if (action.type === 'PLAY_BASIC') {
            const handIdx = player.hand.indexOf(action.cardDefId);
            if (handIdx > -1) {
                player.hand.splice(handIdx, 1);
                const def = PokemonTCGRegistry[action.cardDefId];

                const newPokemon: PokemonInstance = {
                    instanceId: Math.random().toString(),
                    evolutionStack: [action.cardDefId],
                    damageTaken: 0,
                    attachedEnergy: []
                };

                if (action.targetZone === 'ACTIVE' && !player.active) player.active = newPokemon;
                else if (action.targetZone === 'BENCH' && player.bench.length < 5) player.bench.push(newPokemon);
            }
        }
        else if (action.type === 'EVOLVE') {
            const player = nextState.playerData[action.playerId];
            const target = [player.active, ...player.bench].find(p => p?.instanceId === action.targetInstanceId);

            if (target) {
                // 手札から消費
                const handIdx = player.hand.indexOf(action.cardDefId);
                player.hand.splice(handIdx, 1);

                // ★ 進化スタックの一番上にカードを重ねるだけ！
                // エネルギーもダメカン（damageTaken）もそのまま引き継がれる
                target.evolutionStack.push(action.cardDefId);

                // 進化時特性があればスタックに積む
                const def = PokemonTCGRegistry[action.cardDefId];
                if (def.onPlay) {
                    nextState.effectStack.push({ type: 'RESOLVE_ABILITY', cardDefId: def.id, targetInstanceId: target.instanceId });
                }
            }
        }
        else if (action.type === 'ATTACH_ENERGY') {
            const handIdx = player.hand.indexOf(action.cardDefId);
            if (handIdx > -1) {
                player.hand.splice(handIdx, 1);
                const energyDef = PokemonTCGRegistry[action.cardDefId];
                const target = [player.active, ...player.bench].find(p => p?.instanceId === action.targetInstanceId);

                if (target && energyDef.providesEnergy) {
                    target.attachedEnergy.push(energyDef.providesEnergy);
                    player.hasAttachedEnergyThisTurn = true; // 権利消費
                }
            }
        }
        else if (action.type === 'ATTACK') {
            const active = player.active!;

            const topCardId = active.evolutionStack[active.evolutionStack.length - 1];
            const def = PokemonTCGRegistry[topCardId];
            const attack = def.attacks![action.attackIndex];

            const opponentId = Object.keys(nextState.playerData).find(id => id !== action.playerId)!;
            const opponent = nextState.playerData[opponentId];

            if (opponent.active) {
                // スタックにダメージイベントを積む
                nextState.effectStack.push({
                    type: 'DEAL_DAMAGE',
                    sourceId: action.playerId,
                    targetInstanceId: opponent.active.instanceId,
                    amount: attack.damage
                });
            }

            // ワザを使うとターン終了のフラグを立てる処理（スタック解決後に発動）
            nextState.effectStack.push({ type: 'RESOLVE_END_TURN', playerId: action.playerId });
        }
        else if (action.type === 'END_TURN') {
            this.endTurn(nextState, action.playerId);
        }

        // ★スタックの解決 (きぜつ・サイド取得の処理)
        while (nextState.effectStack.length > 0) {
            const event = nextState.effectStack.shift()!;
            this.processEvent(nextState, event);
        }

        return nextState;
    }

    private processEvent(state: PokemonTCGState, event: any) {
        if (event.type === 'DEAL_DAMAGE') {
            // ダメージ適用
            let targetPlayer: PTCGPlayer | undefined;
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
                const maxHp = PokemonTCGRegistry[currentTopCard].hp!;
                const remainingHp = maxHp - targetPokemon.damageTaken;

                console.log(`${currentTopCard} に ${event.amount} ダメージ！ 残りHP: ${remainingHp}`);

                // ★きぜつ (Knock Out) 判定
                if (remainingHp <= 0) {
                    console.log(`${currentTopCard} は きぜつ した！`);
                    // 進化ラインのカードとついているエネルギーをすべてトラッシュに送る
                    targetPlayer.discard.push(...targetPokemon.evolutionStack);
                    targetPlayer.active = null;

                    // サイド取得処理
                    const attacker = state.playerData[event.sourceId];
                    if (attacker.prizes.length > 0) {
                        const prize = attacker.prizes.pop()!;
                        attacker.hand.push(prize);
                    }
                }
            }
        }
        else if (event.type === 'HEAL') {
            // 回復処理（省略）
        }
        else if (event.type === 'RESOLVE_END_TURN') {
            this.endTurn(state, event.playerId);
        }
    }

    private endTurn(state: PokemonTCGState, currentPlayerId: string) {
        const p = state.playerData[currentPlayerId];
        p.hasAttachedEnergyThisTurn = false; // 権利リセット

        const allIds = Object.keys(state.playerData);
        const nextIdx = (allIds.indexOf(currentPlayerId) + 1) % allIds.length;
        state.activePlayers = [allIds[nextIdx]];
        state.turnCount += 1;
        // 本来はここで山札から1枚ドローする
    }

    // --- ワザのエネルギー要求を満たしているかの判定アルゴリズム ---
    private hasEnoughEnergy(attached: EnergyType[], cost: Partial<Record<EnergyType, number>>): boolean {
        const attachedCounts = attached.reduce((acc, type) => {
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {} as Record<EnergyType, number>);

        let colorlessNeeded = cost['COLORLESS'] || 0;

        for (const [type, requiredAmount] of Object.entries(cost)) {
            if (type === 'COLORLESS') continue; // 無色は後回し
            const available = attachedCounts[type as EnergyType] || 0;
            if (available < requiredAmount) return false;
            attachedCounts[type as EnergyType] -= requiredAmount; // 使用分を引く
        }

        // 残ったエネルギーの総数が要求される無色エネルギー分を満たすか？
        const remainingTotal = Object.values(attachedCounts).reduce((a, b) => a + b, 0);
        return remainingTotal >= colorlessNeeded;
    }

    public checkWinCondition(state: PokemonTCGState): { isFinished: boolean; message?: string } {
        const playerIds = Object.keys(state.playerData);

        for (const playerId of playerIds) {
            const player = state.playerData[playerId];

            // 1. サイドカードを取り切ったら勝利
            if (player.prizes.length === 0) {
                return { isFinished: true, message: `Player ${playerId} won by taking all Prize cards!` };
            }

            // 2. バトル場にポケモンがおらず、ベンチにもいない場合は敗北（相手の勝利）
            // processEvent の「きぜつ」処理で active が null になった直後に評価されます。
            if (player.active === null && player.bench.length === 0) {
                // 対戦相手を勝者としてメッセージを作成
                const opponentId = playerIds.find(id => id !== playerId) || 'Opponent';
                return {
                    isFinished: true,
                    message: `Player ${playerId} has no Pokémon left. Player ${opponentId} won!`
                };
            }
        }

        return { isFinished: false };
    }

    public getLegalActions(state: PokemonTCGState): PokemonTCGAction[] {
        return [];
    }
}