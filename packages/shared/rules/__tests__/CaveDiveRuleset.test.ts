// packages/shared/rules/__tests__/CaveDiveRuleset.test.ts
import { describe, it, expect } from "bun:test";
import { UniversalEngine } from "../../UniversalEngine";
import { ReplayEngine } from "../../ReplayEngine";
import { createSecret } from "../../GameRules";
import {
  CaveDiveRuleset,
  TOTAL_ROUNDS,
  type CaveDiveState,
  type CaveDiveAction,
  type CaveCard,
  type TrapType,
} from "../CaveDiveRuleset";

type Engine = UniversalEngine<CaveDiveState, CaveDiveAction>;
const P = ["a", "b", "c"];
const T = (value: number): CaveCard => ({ kind: "TREASURE", value });
const TRAP = (trapType: TrapType): CaveCard => ({ kind: "TRAP", trapType });

function started(seed = "cave", players = P): Engine {
  const engine = new UniversalEngine<CaveDiveState, CaveDiveAction>(CaveDiveRuleset, {
    clientSeed: seed,
    serverSeed: seed,
  });
  for (const id of players) expect(engine.dispatch({ type: "JOIN", playerId: id })).toBe(true);
  expect(engine.dispatch({ type: "START", playerId: players[0] })).toBe(true);
  return engine;
}

const S = (e: Engine) => e.getState();

/**
 * 残り山札を差し替える（末尾が次にめくられる）。テストで展開を固定するため
 */
function setDeck(e: Engine, cards: CaveCard[]) {
  const s = structuredClone(S(e));
  s.deck = createSecret(cards, [], { remaining: cards.length });
  e.loadState(s, e.getReplayData());
}

function choose(e: Engine, choices: Record<string, "STAY" | "LEAVE">) {
  for (const [playerId, choice] of Object.entries(choices)) {
    expect(e.dispatch({ type: "CHOOSE", playerId, choice }), `${playerId} ${choice}`).toBe(true);
  }
}

describe("CaveDiveRuleset", () => {
  it("JOIN で着席、2 人以上で START。開始時に 1 枚めくられ全員が選択待ちになる", () => {
    const engine = new UniversalEngine<CaveDiveState, CaveDiveAction>(CaveDiveRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: "a" });
    expect(CaveDiveRuleset.isValidAction(S(engine), { type: "START", playerId: "a" })).toBe(false);
    engine.dispatch({ type: "JOIN", playerId: "b" });
    expect(engine.dispatch({ type: "START", playerId: "a" })).toBe(true);

    const s = S(engine);
    expect(s.status).toBe("PLAYING");
    expect(s.round).toBe(1);
    expect(s.playerIds).toEqual(["a", "b"]);
    expect(s.inCave).toEqual(["a", "b"]);
    expect(s.activePlayers).toEqual(["a", "b"]);
    expect(s.path.length).toBe(1);
    expect(s.deck.value.length).toBe(29);
    expect(s.bank).toEqual({ a: 0, b: 0 });
    // 開始後は席が閉じる
    expect(engine.dispatch({ type: "JOIN", playerId: "z" })).toBe(false);
  });

  it("山札と他人の選択は見えない。自分の選択は見える", () => {
    const engine = started();
    engine.dispatch({ type: "CHOOSE", playerId: "a", choice: "LEAVE" });
    const forB = engine.getMaskedState("b") as any;
    const forA = engine.getMaskedState("a") as any;
    expect(forB.deck).toEqual({ remaining: 29 });
    expect(forB.choices.a).toBe("?");
    expect(forA.choices.a).toBe("LEAVE");
    expect((engine.getMaskedState("SPECTATOR") as any).choices.a).toBe("?");
    // 選択済みの人は手番から外れ、二重に選べない
    expect(S(engine).activePlayers).toEqual(["b", "c"]);
    expect(engine.getLegalActions("a")).toEqual([]);
    expect(engine.dispatch({ type: "CHOOSE", playerId: "a", choice: "STAY" })).toBe(false);
  });

  it("宝は残っている人で山分け、端数は道端へ。逃げた人は取り分を確定する", () => {
    const engine = started();
    // 開始時の 1 枚を無視して展開を固定: 次は 7 → 5 → 2
    setDeck(engine, [T(2), T(5), T(7)]);
    const base = structuredClone(S(engine));
    base.path = [];
    base.roundStash = { a: 0, b: 0, c: 0 };
    base.pathLeftover = 0;
    engine.loadState(base, engine.getReplayData());

    choose(engine, { a: "STAY", b: "STAY", c: "STAY" }); // 7 を 3 人で: 2 ずつ、端数 1
    let s = S(engine);
    expect(s.roundStash).toEqual({ a: 2, b: 2, c: 2 });
    expect(s.pathLeftover).toBe(1);
    expect(s.revealedChoices).toEqual({ a: "STAY", b: "STAY", c: "STAY" });

    choose(engine, { a: "LEAVE", b: "STAY", c: "STAY" }); // a だけ逃げる → 2 + 道端 1
    s = S(engine);
    expect(s.bank.a).toBe(3);
    expect(s.inCave).toEqual(["b", "c"]);
    // 同じ手番内で続けて 5 がめくられ、b, c で山分け: 2 ずつ、端数 1（a が持ち去った後なので道端は 1）
    expect(s.roundStash).toEqual({ a: 0, b: 4, c: 4 });
    expect(s.pathLeftover).toBe(1);
    expect(s.activePlayers).toEqual(["b", "c"]);
    expect(engine.getLegalActions("a")).toEqual([]);

    choose(engine, { b: "LEAVE", c: "LEAVE" }); // 2 人同時に逃げる → 道端は誰も取れない
    s = S(engine);
    expect(s.bank).toEqual({ a: 3, b: 4, c: 4 });
    expect(s.pathLeftover).toBe(1); // 次のラウンドへ持ち越し
    expect(s.round).toBe(2);
    expect(s.inCave).toEqual(["a", "b", "c"]);
    expect(s.path.length).toBe(1);
  });

  it("同じ罠が 2 枚出ると崩落し、残っていた人はそのラウンドの取り分を失う", () => {
    const engine = started();
    setDeck(engine, [TRAP("SNAKE"), TRAP("SNAKE"), T(9)]);
    const base = structuredClone(S(engine));
    base.path = [];
    base.trapsSeenThisRound = [];
    base.roundStash = { a: 0, b: 0, c: 0 };
    base.pathLeftover = 0;
    engine.loadState(base, engine.getReplayData());

    choose(engine, { a: "STAY", b: "STAY", c: "STAY" }); // 9 → 3 ずつ
    choose(engine, { a: "LEAVE", b: "STAY", c: "STAY" }); // a 確定 3。次は SNAKE 1 枚目
    let s = S(engine);
    expect(s.trapsSeenThisRound).toEqual(["SNAKE"]);
    expect(s.inCave).toEqual(["b", "c"]);
    expect(s.round).toBe(1);

    choose(engine, { b: "STAY", c: "STAY" }); // SNAKE 2 枚目 → 崩落
    s = S(engine);
    expect(s.bank).toEqual({ a: 3, b: 0, c: 0 });
    expect(s.round).toBe(2); // 次のラウンドが始まっている
    expect(s.lastEvent).toContain("崩落");
    expect(s.trapsSeenThisRound.length).toBeLessThanOrEqual(1); // 新しいラウンドの状態
  });

  it("松明は 1 回だけ次のカードを本人にだけ見せ、使ったことは全員に見える", () => {
    const engine = started();
    setDeck(engine, [T(1), TRAP("FIRE")]);
    expect(engine.dispatch({ type: "TORCH", playerId: "a" })).toBe(true);
    const s = S(engine);
    expect(s.torchUsed.a).toBe(true);
    expect((engine.getMaskedState("a") as any).peek.a).toEqual(TRAP("FIRE"));
    expect((engine.getMaskedState("b") as any).peek.a).toBe("?");
    expect((engine.getMaskedState("b") as any).torchUsed.a).toBe(true);
    // 覗いた後も選択はできる。松明は二度使えない
    expect(engine.getLegalActions("a").map((x) => x.type)).toEqual(["CHOOSE", "CHOOSE"]);
    expect(engine.dispatch({ type: "TORCH", playerId: "a" })).toBe(false);
    expect(engine.getLegalActions("b").map((x) => x.type)).toEqual(["CHOOSE", "CHOOSE", "TORCH"]);

    choose(engine, { a: "LEAVE", b: "STAY", c: "STAY" });
    expect(S(engine).path.at(-1)).toEqual(TRAP("FIRE")); // 覗いた通りのカードがめくられた
    expect(S(engine).peek).toEqual({}); // 次の分岐点では消える
  });

  it("最終ラウンドが終わると bank 最大の人が勝つ（同点は同時勝利）", () => {
    const engine = started();
    const s = structuredClone(S(engine));
    s.round = TOTAL_ROUNDS;
    s.bank = { a: 5, b: 9, c: 9 };
    s.roundStash = { a: 0, b: 0, c: 0 };
    s.pathLeftover = 0;
    s.inCave = ["b"];
    s.activePlayers = ["b"];
    s.choices = {};
    engine.loadState(s, engine.getReplayData());

    expect(engine.dispatch({ type: "CHOOSE", playerId: "b", choice: "LEAVE" })).toBe(true);
    const fin = S(engine);
    expect(fin.status).toBe("FINISHED");
    expect(fin.message).toContain("引き分け");
    expect(CaveDiveRuleset.checkWinCondition(fin).winnerIds).toEqual(["b", "c"]);
  });

  it("合法手だけで 8 人対局を終局まで進められ、記録からハッシュ一致で再現できる", () => {
    const players = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
    const engine = started("walk", players);
    let steps = 0;
    while (S(engine).status !== "FINISHED" && steps < 5000) {
      const s = S(engine);
      expect(s.activePlayers!.length, `step ${steps}`).toBeGreaterThan(0);
      const pid = s.activePlayers![0];
      const legal = engine.getLegalActions(pid);
      expect(legal.length).toBeGreaterThan(0);
      for (const a of legal) expect(CaveDiveRuleset.isValidAction(s, a)).toBe(true);
      expect(engine.dispatch(legal[steps % legal.length])).toBe(true);
      steps++;
    }
    const fin = S(engine);
    expect(fin.status).toBe("FINISHED");
    expect(fin.round).toBe(TOTAL_ROUNDS);
    // 宝は消えも増えもしない: bank + 道端 = めくられた宝の合計 - 崩落で失った分 … は追跡できないので非負だけ確認
    for (const p of players) expect(fin.bank[p]).toBeGreaterThanOrEqual(0);

    const record = engine.getGameRecord("g");
    const replay = new ReplayEngine(CaveDiveRuleset, {
      ...record,
      finalServerSeed: (fin as any).prngSecret,
    });
    expect(replay.verify(record)).toBe(true);
    expect(replay.getState().bank).toEqual(fin.bank);
  });
});
