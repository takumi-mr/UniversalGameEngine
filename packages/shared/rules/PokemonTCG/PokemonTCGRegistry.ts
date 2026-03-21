import { PokemonTCGState } from './PokemonTCGRuleset';

export type CardCategory = 'POKEMON' | 'ENERGY' | 'TRAINER';
export type EnergyType = 'FIRE' | 'LIGHTNING' | 'GRASS' | 'COLORLESS';

// カード定義のインターフェース
export interface CardDefinition {
    id: string;
    name: string;
    category: CardCategory;

    hp?: number;
    attacks?: { name: string; cost: Record<string, number>; damage: number }[];

    // 進化用のプロパティ
    stage?: 'BASIC' | 'STAGE1' | 'STAGE2';
    evolvesFrom?: string;

    // エネルギー用
    providesEnergy?: EnergyType;
    // 外部から注入されるイベントフック
    // トレーナーズ（グッズ）用
    // カードがプレイされた瞬間に、エンジン側の Effect Stack に内部イベントを積む
    onPlay?: (state: PokemonTCGState, playerId: string, targetInstanceId?: string) => void;
}

// --------------------------------------------------------
// カード辞書本体（本番ではマスターデータDBからロードする）
// --------------------------------------------------------
export const PokemonTCGRegistry: Record<string, CardDefinition> = {

    // ==========================================
    // 1. 通常のたねポケモン（ワザのみのシンプルなデータ）
    // ==========================================
    'p_pikachu': {
        id: 'p_pikachu', name: 'Pikachu', category: 'POKEMON', hp: 60,
        attacks: [
            { name: 'Thunder Shock', cost: { LIGHTNING: 1 }, damage: 10 },
            { name: 'Electro Ball', cost: { LIGHTNING: 1, COLORLESS: 1 }, damage: 30 }
        ]
    },
    'p_charmander': {
        id: 'p_charmander',
        name: 'Charmander', // ヒトカゲ
        category: 'POKEMON',
        hp: 70,
        attacks: [
            { name: 'Scratch', cost: { COLORLESS: 1 }, damage: 10 },
            { name: 'Ember', cost: { FIRE: 1, COLORLESS: 1 }, damage: 30 }
        ]
    },

    'p_charmeleon': {
        id: 'p_charmeleon', name: 'Charmeleon', category: 'POKEMON',
        stage: 'STAGE1',
        evolvesFrom: 'p_charmander', // ヒトカゲから進化
        hp: 90,
        attacks: [{ name: 'Flamethrower', cost: { FIRE: 2, COLORLESS: 1 }, damage: 80 }],
        onPlay: (_state, _playerId, _targetInstanceId) => {
            // 進化時に発動する特性などもここに書ける
        }
    },

    // ==========================================
    // 2. 「特性（登場時効果）」を持つポケモン
    // ==========================================
    'p_crobat_v': {
        id: 'p_crobat_v',
        name: 'Crobat V', // クロバットV
        category: 'POKEMON',
        hp: 160,
        onPlay: (state, playerId) => {
            // 特性「ナイトアセット」の簡易版：手札からベンチに出た時、山札から3枚引く
            // （直接 state.playerData[playerId].hand を操作するのではなく、イベントを積む）
            state.effectStack.push({
                type: 'DRAW_CARDS',
                playerId: playerId,
                amount: 3
            });
        },
        attacks: [
            { name: 'Venomous Fang', cost: { DARK: 2, COLORLESS: 1 }, damage: 70 }
        ]
    },

    // ==========================================
    // 3. 盤面を操作するグッズ（トレーナーズ）
    // ==========================================
    't_switch': {
        id: 't_switch',
        name: 'Switch', // ポケモンいれかえ
        category: 'TRAINER',
        onPlay: (state, playerId, targetInstanceId) => {
            // 対象のベンチポケモンを、バトル場のポケモンと入れ替えるイベント
            if (targetInstanceId) {
                state.effectStack.push({
                    type: 'SWITCH_ACTIVE_POKEMON',
                    playerId: playerId,
                    targetInstanceId: targetInstanceId
                });
            }
        }
    },

    // ==========================================
    // 4. リソースを操作するサポート（トレーナーズ）
    // ==========================================
    't_professor_research': {
        id: 't_professor_research',
        name: 'Professor\'s Research', // 博士の研究
        category: 'TRAINER',
        onPlay: (state, playerId) => {
            // 手札をすべてトラッシュし、山札から7枚引く
            state.effectStack.push({ type: 'DISCARD_HAND', playerId: playerId });
            state.effectStack.push({ type: 'DRAW_CARDS', playerId: playerId, amount: 7 });
        }
    },

    // ==========================================
    // 5. 基本エネルギー
    // ==========================================
    'e_fire': {
        id: 'e_fire',
        name: 'Fire Energy',
        category: 'ENERGY',
        providesEnergy: 'FIRE'
    },
    'e_lightning': { id: 'e_lightning', name: 'Lightning Energy', category: 'ENERGY', providesEnergy: 'LIGHTNING' },
    't_potion': {
        id: 't_potion', name: 'Potion', category: 'TRAINER',
        onPlay: (state, playerId, targetInstanceId) => {
            // 対象のポケモンのHPを30回復（最大HPは超えない処理が必要だがここでは簡略化）
            state.effectStack.push({ type: 'HEAL', targetInstanceId, amount: 30 });
        }
    }
};