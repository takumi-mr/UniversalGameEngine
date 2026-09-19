// packages/shared/__tests__/hiddenInfo.test.ts
// 手札・山札・正解などの秘匿情報が Secret<T> で包まれ、getMaskedState で他人・観戦者から隠れることを検証する。
import { describe, it, expect } from "bun:test";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { UnoRuleset, type UnoState, type UnoAction } from "@engine/shared/rules/UnoRuleset";
import {
  HighLowRuleset,
  type HighLowState,
  type HighLowAction,
} from "@engine/shared/rules/HighLowRuleset";
import {
  WordleRuleset,
  evaluateGuess,
  type WordleState,
  type WordleAction,
} from "@engine/shared/rules/WordleRuleset";
import type { PokemonPocketState } from "@engine/shared/rules/PokemonPocket/PokemonPocketRuleset";
import { gameRegistry } from "@engine/shared/GameRegistry";
import type { Masked } from "@engine/shared/GameRules";

const seeded = { clientSeed: "hidden-info", serverSeed: "hidden-info-server" };

describe("Uno", () => {
  const start = () => {
    const engine = new UniversalEngine<UnoState, UnoAction>(UnoRuleset, seeded);
    engine.dispatch({ type: "JOIN", playerId: "a" });
    engine.dispatch({ type: "JOIN", playerId: "b" });
    expect(engine.dispatch({ type: "START", playerId: "a" })).toBe(true);
    return engine;
  };

  it("START で着席者に 7 枚ずつ配り、手番を設定すること", () => {
    const engine = start();
    const state = engine.getState();
    expect(state.status).toBe("PLAYING");
    expect(state.playerOrder).toEqual(["a", "b"]);
    expect(state.hands.a.value.length).toBe(7);
    expect(state.hands.b.value.length).toBe(7);
    expect(state.discard.length).toBe(1);
    expect(state.activePlayers).toEqual(["a"]);
    // 人数が足りなければ開始できない
    const waiting = new UniversalEngine<UnoState, UnoAction>(UnoRuleset, seeded);
    waiting.dispatch({ type: "JOIN", playerId: "a" });
    expect(UnoRuleset.isValidAction(waiting.getState(), { type: "START", playerId: "a" })).toBe(
      false,
    );
  });

  it("自分の手札だけ見え、相手の手札と山札は枚数分の伏せ札になること", () => {
    const engine = start();
    const full = engine.getState();
    const forA = engine.getMaskedState("a") as unknown as Masked<UnoState>;
    expect(forA.hands.a).toEqual(full.hands.a.value);
    expect(forA.hands.b).toEqual(Array(7).fill("?"));
    expect(forA.deck).toEqual(Array(full.deck.value.length).fill("?"));

    const forSpectator = engine.getMaskedState("SPECTATOR") as unknown as Masked<UnoState>;
    expect(forSpectator.hands.a).toEqual(Array(7).fill("?"));
    expect(forSpectator.hands.b).toEqual(Array(7).fill("?"));
    expect(JSON.stringify(forSpectator)).not.toContain(JSON.stringify(full.hands.a.value));
  });

  it("DRAW / PLAY 後も手札と山札が Secret のままで、枚数が合うこと", () => {
    const engine = start();
    const before = engine.getState();
    expect(engine.dispatch({ type: "DRAW", playerId: "a" })).toBe(true);
    const after = engine.getState();
    expect(after.hands.a.value.length).toBe(8);
    expect(after.deck.value.length).toBe(before.deck.value.length - 1);
    expect(after.hands.a.visibleTo).toEqual(["a"]);
    expect(after.deck.visibleTo).toEqual([]);

    const legal = engine.getLegalActions("a").filter((x) => x.type === "PLAY");
    if (legal.length > 0) {
      expect(engine.dispatch(legal[0]!)).toBe(true);
      expect(engine.getState().hands.a.value.length).toBe(7);
      expect(engine.getState().hands.a.visibleTo).toEqual(["a"]);
    }
  });

  it("山札が尽きたら捨て札を RNG で切り直して引けること", () => {
    const engine = start();
    // 山札を空にし、捨て札を積んでおく
    const state = engine.getState();
    const drained: UnoState = {
      ...state,
      deck: { ...state.deck, value: [], maskedValue: [] },
      discard: [...state.discard, 5, 105, 205],
    };
    engine.loadState(drained);
    expect(engine.dispatch({ type: "DRAW", playerId: "a" })).toBe(true);
    const after = engine.getState();
    expect(after.hands.a.value.length).toBe(8);
    expect(after.discard.length).toBe(1);
    expect(after.deck.value.length).toBe(2);
  });
});

describe("HighLow", () => {
  it("山札は誰にも見えず、枚数だけ分かること", () => {
    const engine = new UniversalEngine<HighLowState, HighLowAction>(HighLowRuleset, seeded);
    engine.dispatch({ type: "JOIN", playerId: "p1" });
    engine.dispatch({ type: "JOIN", playerId: "p2" });
    expect(engine.dispatch({ type: "START", playerId: "p1" })).toBe(true);
    const full = engine.getState();
    expect(full.deck.value.length).toBe(51);

    for (const viewer of ["p1", "p2", "SPECTATOR"]) {
      const masked = engine.getMaskedState(viewer) as unknown as Masked<HighLowState>;
      expect(masked.deck, viewer).toEqual(Array(51).fill("?"));
    }

    // 次のカードを知らなくても GUESS は進み、山札が減る
    expect(engine.dispatch({ type: "GUESS", choice: "HIGH", playerId: "p1" })).toBe(true);
    expect(engine.getState().deck.value.length).toBe(50);
    expect(engine.getState().lastResultCard).not.toBeNull();
  });
});

describe("Wordle", () => {
  it("正解は終局まで見えず、各文字の判定はサーバーが results に入れること", () => {
    const engine = new UniversalEngine<WordleState, WordleAction>(WordleRuleset, seeded);
    engine.dispatch({ type: "JOIN", playerId: "p1" });
    expect(engine.dispatch({ type: "START", playerId: "p1" })).toBe(true);
    const secret = engine.getState().secretWord.value;
    expect(secret.length).toBe(5);

    const masked = engine.getMaskedState("p1") as unknown as Masked<WordleState>;
    expect(masked.secretWord).toBe("");
    expect(JSON.stringify(masked)).not.toContain(secret);

    // 正解と 1 文字だけ違う推測
    const guess = (secret[0] === "A" ? "B" : "A") + secret.slice(1);
    expect(engine.dispatch({ type: "GUESS", word: guess, playerId: "p1" })).toBe(true);
    const after = engine.getMaskedState("p1") as unknown as Masked<WordleState>;
    expect(after.results[0]!.slice(1)).toEqual(["correct", "correct", "correct", "correct"]);
    expect(after.secretWord).toBe("");

    // 正解すると終局し、正解が開示される
    expect(engine.dispatch({ type: "GUESS", word: secret, playerId: "p1" })).toBe(true);
    const finished = engine.getMaskedState("p1") as unknown as Masked<WordleState>;
    expect(finished.status).toBe("FINISHED");
    expect(finished.secretWord).toBe(secret);
  });

  it("evaluateGuess は重複文字を正解側の残り数だけ present にすること", () => {
    expect(evaluateGuess("ALLEY", "LLAMA")).toEqual([
      "present",
      "correct",
      "present",
      "absent",
      "absent",
    ]);
    expect(evaluateGuess("APPLE", "APPLE")).toEqual(Array(5).fill("correct"));
  });
});

describe("PokemonPocket", () => {
  it("相手の手札と山札は枚数分の伏せ札になること", () => {
    // レジストリ経由（クラス実装なので、State / Action の型はここで戻す）
    const def = gameRegistry.getDefinition("pokemon_pocket")!;
    const engine = new UniversalEngine(def.ruleset, { ...seeded, playerIds: ["a", "b"] });
    const full = engine.getState() as PokemonPocketState;
    const forA = engine.getMaskedState("a") as unknown as Masked<PokemonPocketState>;
    expect(forA.playerData.a.hand).toEqual(full.playerData.a.hand.value);
    expect(forA.playerData.b.hand).toEqual(Array(full.playerData.b.hand.value.length).fill("?"));
    expect(forA.playerData.a.deck).toEqual(Array(full.playerData.a.deck.value.length).fill("?"));
    expect(forA.playerData.b.deck).toEqual(Array(full.playerData.b.deck.value.length).fill("?"));
  });
});
