// packages/shared/rules/__tests__/EquilibriumRuleset.test.ts
// JOIN → START → 封印入札 → メインフェーズ → 勝利条件 までを、エンジン経由で実際に通す。
import { describe, it, expect } from "bun:test";
import { UniversalEngine } from "../../UniversalEngine";
import {
  EquilibriumRuleset,
  cardNeedsTarget,
  MAX_TURNS,
  type EquilibriumState,
  type EquilibriumAction,
  type Card,
} from "../EquilibriumRuleset";

const P = ["alice", "bob", "carol"];

function newEngine(seed = "eq-test") {
  return new UniversalEngine<EquilibriumState, EquilibriumAction>(EquilibriumRuleset, {
    clientSeed: seed,
    serverSeed: seed,
  });
}

/** JOIN × 3 → START 済みのエンジン */
function startedEngine(seed?: string) {
  const engine = newEngine(seed);
  for (const id of P) expect(engine.dispatch({ type: "JOIN", playerId: id })).toBe(true);
  expect(engine.dispatch({ type: "START", playerId: P[0] })).toBe(true);
  return engine;
}

const state = (engine: UniversalEngine<EquilibriumState, EquilibriumAction>) => engine.getState();
const hand = (engine: UniversalEngine<EquilibriumState, EquilibriumAction>, id: string) =>
  state(engine).playerData[id].hand.value;

/** オークションを「全員パス」または「指定の入札」で終わらせる */
function runAuction(
  engine: UniversalEngine<EquilibriumState, EquilibriumAction>,
  bids: Record<string, number | "pass">,
) {
  for (const id of Object.keys(state(engine).playerData)) {
    if (state(engine).playerData[id].hp <= 0) continue;
    const bid = bids[id] ?? "pass";
    const action: EquilibriumAction =
      bid === "pass"
        ? { type: "PASS_AUCTION", playerId: id }
        : { type: "BID", playerId: id, amount: bid };
    expect(engine.dispatch(action), `${id} ${JSON.stringify(action)}`).toBe(true);
  }
  expect(state(engine).phase).toBe("MAIN");
}

/** テスト用に手札を差し替える（エンジンの loadState で状態を丸ごと入れ替える） */
function giveCards(
  engine: UniversalEngine<EquilibriumState, EquilibriumAction>,
  id: string,
  cards: Card[],
) {
  const s = structuredClone(state(engine));
  const p = s.playerData[id];
  p.hand = { ...p.hand, value: cards, maskedValue: cards.map(() => p.hand.maskedValue) };
  engine.loadState(s, engine.getReplayData());
}

describe("EquilibriumRuleset", () => {
  it("JOIN で着席と配札、START で開始（3人未満は開始不可、開始後の JOIN は不可）", () => {
    const engine = newEngine();
    engine.dispatch({ type: "JOIN", playerId: "alice" });
    engine.dispatch({ type: "JOIN", playerId: "bob" });
    // 2 人では開始できない（ルールセットが拒否し、組み込み START も走らない … 状態は WAITING のまま）
    expect(
      EquilibriumRuleset.isValidAction(state(engine), { type: "START", playerId: "alice" }),
    ).toBe(false);

    engine.dispatch({ type: "JOIN", playerId: "carol" });
    const before = state(engine);
    expect(before.status).toBe("WAITING");
    expect(before.activePlayers).toEqual([]);
    for (const id of P) {
      expect(before.playerData[id].hand.value.length).toBe(3);
      expect(before.playerData[id].hiddenGoal.value?.type).toBe("GOAL");
      expect(before.playerData[id].hp).toBe(20);
    }

    expect(engine.dispatch({ type: "START", playerId: "alice" })).toBe(true);
    const s = state(engine);
    expect(s.status).toBe("PLAYING");
    expect(s.phase).toBe("AUCTION");
    expect(s.turnCount).toBe(1);
    expect(s.auctionPool.length).toBe(2); // floor(3/2)+1
    expect([...s.activePlayers!].sort()).toEqual([...P].sort());
    for (const id of P) expect(s.playerData[id].hand.value.length).toBe(4); // ラウンド開始で基本カード +1

    // 開始後は席が閉じているので飛び入りできない
    expect(engine.dispatch({ type: "JOIN", playerId: "dave" })).toBe(false);
    expect(state(engine).playerData["dave"]).toBeUndefined();
    expect(Object.values(state(engine).players!)).not.toContain("dave");
  });

  it("封印入札: 自分の額しか見えず、単独最高額が落札し、同額タイならプールは持ち越す", () => {
    const engine = startedEngine();
    engine.dispatch({ type: "BID", playerId: "alice", amount: 3 });
    // 他人からは額が見えない
    expect((engine.getMaskedState("bob") as any).currentBids.alice).toBe("?");
    expect((engine.getMaskedState("alice") as any).currentBids.alice).toBe(3);

    engine.dispatch({ type: "BID", playerId: "bob", amount: 3 });
    engine.dispatch({ type: "BID", playerId: "carol", amount: 2 });
    let s = state(engine);
    // 3 と 3 はタイ → 単独の 2 を出した carol が落札
    expect(s.phase).toBe("MAIN");
    expect(s.activePlayers).toEqual(["carol"]);
    expect(s.playerData.carol.soulPoints).toBe(10 + 1 - 2);
    expect(s.playerData.alice.soulPoints).toBe(11); // 負けた入札は払わない
    expect(s.playerData.carol.hand.value.length).toBe(4 + 2);
    expect(s.auctionPool).toEqual([]);
    expect(s.passedPlayers).toEqual([]); // オークションの記録はメインに持ち込まない

    // 次のラウンド: 全員同額 → 誰も落札せずプールが持ち越される
    for (const id of ["carol", "alice", "bob"]) engine.dispatch({ type: "END_TURN", playerId: id });
    s = state(engine);
    expect(s.turnCount).toBe(2);
    expect(s.phase).toBe("AUCTION");
    const poolBefore = s.auctionPool.length;
    runAuction(engine, { alice: 1, bob: 1, carol: 1 });
    s = state(engine);
    expect(s.auctionPool.length).toBe(poolBefore);
    expect(s.activePlayers).toEqual(["alice"]); // 落札者なしなら最初の生存者から
    // 誰も払っていない（carol は 1 ラウンド目の落札で 2 払っている）
    expect(P.map((id) => s.playerData[id].soulPoints)).toEqual([12, 12, 10]);
  });

  it("全員パスなら全員 HP -1、プールは持ち越し", () => {
    const engine = startedEngine();
    const pool = state(engine).auctionPool.length;
    runAuction(engine, {});
    const s = state(engine);
    for (const id of P) expect(s.playerData[id].hp).toBe(19);
    expect(s.auctionPool.length).toBe(pool);
  });

  it("メインフェーズ: オークションでパスした人にも手番が回り、全員の END_TURN で次ラウンドへ", () => {
    const engine = startedEngine();
    runAuction(engine, { alice: 2 }); // bob, carol はパス
    expect(state(engine).activePlayers).toEqual(["alice"]);
    engine.dispatch({ type: "END_TURN", playerId: "alice" });
    expect(state(engine).activePlayers).toEqual(["bob"]);
    expect(engine.dispatch({ type: "END_TURN", playerId: "carol" })).toBe(false); // 手番外
    engine.dispatch({ type: "END_TURN", playerId: "bob" });
    expect(state(engine).activePlayers).toEqual(["carol"]);
    engine.dispatch({ type: "END_TURN", playerId: "carol" });
    const s = state(engine);
    expect(s.turnCount).toBe(2);
    expect(s.phase).toBe("AUCTION");
    for (const id of P) expect(s.playerData[id].soulPoints).toBe(id === "alice" ? 10 : 12);
  });

  it("対象を取るカードは targetId が必須で、自分や倒れた相手は選べない。効果は実際に適用される", () => {
    const engine = startedEngine();
    runAuction(engine, { alice: 1 });
    const strike: Card = { id: "strike", type: "ATTACK", name: "Strike", value: 2, cost: 1 };
    const drain: Card = { id: "drain", type: "SYPHON", name: "Soul_Drain", value: 3, cost: 2 };
    const guard: Card = { id: "guard", type: "DEFENSE", name: "Guard", value: 2, cost: 1 };
    giveCards(engine, "alice", [strike, drain, guard]);

    // targetId なし / 自分 / 存在しない相手は不正
    expect(engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "strike" })).toBe(false);
    expect(
      engine.dispatch({
        type: "PLAY_CARD",
        playerId: "alice",
        cardId: "strike",
        targetId: "alice",
      }),
    ).toBe(false);
    expect(
      engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "strike", targetId: "zed" }),
    ).toBe(false);
    expect(state(engine).playerData.alice.soulPoints).toBe(10); // 不正な手ではコストを払わない

    expect(
      engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "strike", targetId: "bob" }),
    ).toBe(true);
    let s = state(engine);
    expect(s.playerData.bob.hp).toBe(18);
    expect(s.playerData.alice.soulPoints).toBe(9);
    expect(s.playerData.alice.board.map((c) => c.id)).toEqual(["strike"]);
    expect(s.lastPlayedCard?.id).toBe("strike");

    expect(
      engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "drain", targetId: "carol" }),
    ).toBe(true);
    s = state(engine);
    expect(s.playerData.carol.soulPoints).toBe(11 - 3);
    expect(s.playerData.alice.soulPoints).toBe(9 - 2 + 3);

    // 対象を取らないカードはそのまま出せる
    expect(engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "guard" })).toBe(true);
    expect(state(engine).playerData.alice.hp).toBe(22);

    // getLegalActions は対象ごとに列挙し、すべて isValidAction を通る
    giveCards(engine, "alice", [{ ...strike, id: "s2" }]);
    const legal = engine.getLegalActions("alice");
    const plays = legal.filter((a) => a.type === "PLAY_CARD") as Extract<
      EquilibriumAction,
      { type: "PLAY_CARD" }
    >[];
    expect(plays.map((a) => a.targetId).sort()).toEqual(["bob", "carol"]);
    for (const a of legal) expect(EquilibriumRuleset.isValidAction(state(engine), a)).toBe(true);
  });

  it("GOAL カードは PLAY できず ALTER_GOAL で秘密の目標を差し替える。Echo は直前のカードを複製する", () => {
    const engine = startedEngine();
    runAuction(engine, { alice: 1 });
    const goal: Card = { id: "sd", type: "GOAL", name: "Sudden_Death", value: 1, cost: 0 };
    const strike: Card = { id: "strike", type: "ATTACK", name: "Strike", value: 2, cost: 1 };
    const echo: Card = { id: "echo", type: "TRICK", name: "Echo_Whisper", value: 0, cost: 3 };
    giveCards(engine, "alice", [goal, strike, echo]);

    expect(engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "sd" })).toBe(false);
    // 複製元がないうちは Echo を出せない
    expect(
      engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "echo", targetId: "bob" }),
    ).toBe(false);

    expect(engine.dispatch({ type: "ALTER_GOAL", playerId: "alice", newGoalCardId: "sd" })).toBe(
      true,
    );
    expect(state(engine).playerData.alice.hiddenGoal.value?.name).toBe("Sudden_Death");
    expect((engine.getMaskedState("bob") as any).playerData.alice.hiddenGoal).toBeNull();

    engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "strike", targetId: "bob" });
    expect(cardNeedsTarget(echo, state(engine).lastPlayedCard)).toBe(true);
    expect(engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "echo" })).toBe(false);
    expect(
      engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "echo", targetId: "bob" }),
    ).toBe(true);
    const s = state(engine);
    expect(s.playerData.bob.hp).toBe(16); // Strike 2 + Echo(Strike) 2
    expect(s.lastPlayedCard?.id).toBe("strike"); // Echo 自身は複製元にならない
  });

  it("Sudden_Death: 自分の攻撃で相手を倒すと勝利。倒れた人は手番から外れる", () => {
    const engine = startedEngine();
    runAuction(engine, { alice: 1 });
    const goal: Card = { id: "sd", type: "GOAL", name: "Sudden_Death", value: 1, cost: 0 };
    const fire: Card = { id: "fire", type: "ATTACK", name: "Hellfire", value: 8, cost: 3 };
    giveCards(engine, "alice", [goal, fire, { ...fire, id: "fire2" }, { ...fire, id: "fire3" }]);
    engine.dispatch({ type: "ALTER_GOAL", playerId: "alice", newGoalCardId: "sd" });

    engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "fire", targetId: "bob" });
    engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "fire2", targetId: "bob" });
    expect(state(engine).playerData.bob.hp).toBe(4);
    expect(state(engine).status).toBe("PLAYING");

    engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "fire3", targetId: "bob" });
    const s = state(engine);
    expect(s.playerData.bob.hp).toBeLessThanOrEqual(0);
    expect(s.playerData.alice.kills).toBe(1);
    expect(s.status).toBe("FINISHED");
    expect(s.message).toContain("Sudden Death");
  });

  it("倒れたプレイヤーは手番・オークションから除外され、残り一人で決着する", () => {
    const engine = startedEngine();
    runAuction(engine, { alice: 1 });
    const fire: Card = { id: "f", type: "ATTACK", name: "Hellfire", value: 8, cost: 3 };
    giveCards(engine, "alice", [fire, { ...fire, id: "f2" }, { ...fire, id: "f3" }]);
    // alice の目標が Annihilator/Sudden_Death でなければ、bob を倒しても続行する
    const s0 = structuredClone(state(engine));
    s0.playerData.alice.hiddenGoal = {
      ...s0.playerData.alice.hiddenGoal,
      value: { id: "c", type: "GOAL", name: "Collector", value: 8, cost: 0 },
    };
    engine.loadState(s0, engine.getReplayData());

    for (const id of ["f", "f2", "f3"]) {
      engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: id, targetId: "bob" });
    }
    expect(state(engine).playerData.bob.hp).toBeLessThanOrEqual(0);
    expect(state(engine).status).toBe("PLAYING");
    expect(engine.getLegalActions("bob")).toEqual([]);

    engine.dispatch({ type: "END_TURN", playerId: "alice" });
    expect(state(engine).activePlayers).toEqual(["carol"]); // bob を飛ばす
    engine.dispatch({ type: "END_TURN", playerId: "carol" });
    let s = state(engine);
    expect(s.phase).toBe("AUCTION");
    expect([...s.activePlayers!].sort()).toEqual(["alice", "carol"]);
    expect(s.auctionPool.length).toBe(2); // 生存 2 人分 floor(2/2)+1

    // 生存者だけで入札が締まる
    engine.dispatch({ type: "PASS_AUCTION", playerId: "alice" });
    engine.dispatch({ type: "PASS_AUCTION", playerId: "carol" });
    expect(state(engine).phase).toBe("MAIN");

    // carol も倒すと最後の一人
    giveCards(engine, "alice", [
      { ...fire, id: "g" },
      { ...fire, id: "g2" },
      { ...fire, id: "g3" },
    ]);
    s = structuredClone(state(engine));
    s.activePlayers = ["alice"];
    s.playerData.alice.soulPoints = 20;
    engine.loadState(s, engine.getReplayData());
    for (const id of ["g", "g2", "g3"]) {
      engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: id, targetId: "carol" });
    }
    expect(state(engine).status).toBe("FINISHED");
    expect(state(engine).message).toContain("Last Man Standing");
  });

  it("BLUFF_REVEAL は実在するカードしか騙れず、他人からは 1 枚目がそのカードに見える", () => {
    const engine = startedEngine();
    runAuction(engine, { alice: 1 });
    const bogus = { id: "x", type: "ATTACK", name: "<script>", value: 9999, cost: 0 } as Card;
    expect(engine.dispatch({ type: "BLUFF_REVEAL", playerId: "alice", fakeCard: bogus })).toBe(
      false,
    );

    const fake: Card = { id: "whatever", type: "ATTACK", name: "Hellfire", value: 1, cost: 1 };
    expect(engine.dispatch({ type: "BLUFF_REVEAL", playerId: "alice", fakeCard: fake })).toBe(true);
    const seen = (engine.getMaskedState("bob") as any).playerData.alice.hand;
    expect(seen[0]).toEqual({ id: "bluff", type: "ATTACK", name: "Hellfire", value: 8, cost: 3 }); // 値はカタログ準拠
    expect(seen[1].id).toBe("hidden");
    expect(state(engine).playerData.alice.soulPoints).toBe(9);
  });

  it("Peep は相手の秘密の目標を自分にだけ見せ、Mind_Control は相手の手札を 1 枚奪う", () => {
    const engine = startedEngine();
    runAuction(engine, { alice: 1 });
    const peep: Card = { id: "peep", type: "TRICK", name: "Peep", value: 0, cost: 2 };
    const mc: Card = { id: "mc", type: "TRICK", name: "Mind_Control", value: 0, cost: 4 };
    giveCards(engine, "alice", [peep, mc]);

    expect((engine.getMaskedState("alice") as any).playerData.bob.hiddenGoal).toBeNull();
    engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "peep", targetId: "bob" });
    expect((engine.getMaskedState("alice") as any).playerData.bob.hiddenGoal?.type).toBe("GOAL");
    expect((engine.getMaskedState("carol") as any).playerData.bob.hiddenGoal).toBeNull();

    const bobBefore = hand(engine, "bob").length;
    engine.dispatch({ type: "PLAY_CARD", playerId: "alice", cardId: "mc", targetId: "bob" });
    expect(hand(engine, "bob").length).toBe(bobBefore - 1);
    expect(hand(engine, "alice").length).toBe(1); // mc を出して 1 枚奪った
  });

  it("MAX_TURNS を超えたら HP（同点なら SP）で決着する", () => {
    const engine = startedEngine();
    const s = structuredClone(state(engine));
    s.turnCount = MAX_TURNS + 1;
    s.playerData.alice.hp = 15;
    s.playerData.bob.hp = 15;
    s.playerData.bob.soulPoints = 30;
    s.playerData.carol.hp = 10;
    const result = EquilibriumRuleset.checkWinCondition(s);
    expect(result.isFinished).toBe(true);
    expect(result.winnerIds).toEqual(["bob"]);
  });

  it("AI 用: 合法手だけで対局を進めても行き詰まらず、いずれ終局する", () => {
    const engine = startedEngine("random-walk");
    let steps = 0;
    while (state(engine).status !== "FINISHED" && steps < 3000) {
      const s = state(engine);
      const active = s.activePlayers ?? [];
      expect(active.length, `step ${steps}: 手番が空`).toBeGreaterThan(0);
      const pid = active[0];
      const legal = engine.getLegalActions(pid);
      expect(legal.length, `step ${steps}: ${pid} に合法手がない`).toBeGreaterThan(0);
      const action = legal[steps % legal.length];
      expect(engine.dispatch(action), `step ${steps}: ${JSON.stringify(action)}`).toBe(true);
      steps++;
    }
    expect(state(engine).status).toBe("FINISHED");
  });
});
