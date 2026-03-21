import { PokemonPocketState } from "./PokemonPocketRuleset";

export type CardCategory = "POKEMON" | "TRAINER";
export type EnergyType =
  | "FIRE"
  | "LIGHTNING"
  | "GRASS"
  | "WATER"
  | "PSYCHIC"
  | "FIGHTING"
  | "DARK"
  | "METAL"
  | "COLORLESS";

// カード定義のインターフェース (Pocket用)
export interface CardDefinition {
  id: string;
  name: string;
  category: CardCategory;

  hp?: number;
  points?: number; // 倒された時に相手に与えるポイント。通常1、exは2。
  attacks?: {
    name: string;
    cost: Partial<Record<EnergyType, number>>;
    damage: number;
  }[];

  // 進化用のプロパティ
  stage?: "BASIC" | "STAGE1" | "STAGE2";
  evolvesFrom?: string;

  // トレーナーズ（グッズ・サポート）等
  onPlay?: (state: PokemonPocketState, playerId: string, targetInstanceId?: string) => void;
}

export const PokemonPocketRegistry: Record<string, CardDefinition> = {
  // 通常のたねポケモン (1ポイント)
  p_pikachu: {
    id: "p_pikachu",
    name: "Pikachu",
    category: "POKEMON",
    hp: 60,
    points: 1,
    attacks: [
      { name: "Thunder Shock", cost: { LIGHTNING: 1 }, damage: 20 },
      {
        name: "Electro Ball",
        cost: { LIGHTNING: 1, COLORLESS: 1 },
        damage: 40,
      },
    ],
  },
  p_charmander: {
    id: "p_charmander",
    name: "Charmander",
    category: "POKEMON",
    hp: 60,
    points: 1,
    attacks: [
      { name: "Scratch", cost: { COLORLESS: 1 }, damage: 10 },
      { name: "Ember", cost: { FIRE: 1, COLORLESS: 1 }, damage: 30 },
    ],
  },

  // 1進化
  p_charmeleon: {
    id: "p_charmeleon",
    name: "Charmeleon",
    category: "POKEMON",
    stage: "STAGE1",
    evolvesFrom: "p_charmander",
    hp: 90,
    points: 1,
    attacks: [{ name: "Flamethrower", cost: { FIRE: 2, COLORLESS: 1 }, damage: 80 }],
  },

  // 2進化 exポケモン (2ポイント)
  p_charizard_ex: {
    id: "p_charizard_ex",
    name: "Charizard ex",
    category: "POKEMON",
    stage: "STAGE2",
    evolvesFrom: "p_charmeleon",
    hp: 180,
    points: 2,
    attacks: [{ name: "Crimson Storm", cost: { FIRE: 2, COLORLESS: 2 }, damage: 200 }],
  },

  // たね exポケモン (2ポイント)
  p_pikachu_ex: {
    id: "p_pikachu_ex",
    name: "Pikachu ex",
    category: "POKEMON",
    hp: 120,
    points: 2,
    attacks: [
      { name: "Circle Circuit", cost: { LIGHTNING: 2 }, damage: 90 }, // 本来はベンチの雷ポケモンの数x30など
    ],
  },

  // グッズ
  t_potion: {
    id: "t_potion",
    name: "Potion",
    category: "TRAINER",
    onPlay: (state, playerId, targetInstanceId) => {
      // HP20回復
      state.effectStack.push({ type: "HEAL", targetInstanceId, amount: 20 });
    },
  },
  t_pokeball: {
    id: "t_pokeball",
    name: "Poke Ball",
    category: "TRAINER",
    onPlay: (state, playerId) => {
      // ランダムにたねポケモンカードを手札に加える (簡易的実装)
      state.effectStack.push({
        type: "DRAW_CARDS",
        playerId: playerId,
        amount: 1,
      });
    },
  },
  t_professor_research: {
    id: "t_professor_research",
    name: "Professor's Research",
    category: "TRAINER",
    onPlay: (state, playerId) => {
      // Pocketではトラッシュせずに2枚引く (博士の研究というよりオーキド博士)
      state.effectStack.push({
        type: "DRAW_CARDS",
        playerId: playerId,
        amount: 2,
      });
    },
  },
};
