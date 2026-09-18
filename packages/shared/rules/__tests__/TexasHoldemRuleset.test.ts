// packages/shared/rules/__tests__/TexasHoldemRuleset.test.ts
import { describe, it, expect } from "bun:test";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { createSecret, type Masked } from "@engine/shared/GameRules";
import {
  TexasHoldemRuleset,
  type TexasHoldemState,
  type TexasHoldemAction,
  type TexasHoldemOptions,
} from "@engine/shared/rules/TexasHoldemRuleset";

type Engine = UniversalEngine<TexasHoldemState, TexasHoldemAction>;
/** playerId から見えるマスク済み状態（Secret は展開されているので Masked 型で扱う） */
const masked = (e: Engine, playerId: string) =>
  e.getMaskedState(playerId) as unknown as Masked<TexasHoldemState>;
const P = ["p1", "p2", "p3"];

/** JOIN → START 済みのエンジン。dealer は p1（index 0）、SB = p2、BB = p3 */
function started(players = P, options: TexasHoldemOptions = {}, seed = "holdem"): Engine {
  const engine = new UniversalEngine<TexasHoldemState, TexasHoldemAction>(TexasHoldemRuleset, {
    clientSeed: seed,
    serverSeed: seed,
    ...options,
  });
  for (const id of players) expect(engine.dispatch({ type: "JOIN", playerId: id })).toBe(true);
  expect(engine.dispatch({ type: "START", playerId: players[0] })).toBe(true);
  return engine;
}

const S = (e: Engine) => e.getState();

const act = (e: Engine, playerId: string, type: TexasHoldemAction["type"], amount?: number) =>
  e.dispatch(amount === undefined ? { type, playerId } : { type, playerId, amount });

const must = (e: Engine, playerId: string, type: TexasHoldemAction["type"], amount?: number) =>
  expect(act(e, playerId, type, amount), `${playerId} ${type} ${amount ?? ""}`).toBe(true);

/**
 * 展開を固定するために手札・山札・チップを差し替える。
 * deck は末尾から配られる（フロップは末尾 3 枚を逆順、ターン・リバーは末尾 1 枚ずつ）
 */
function patch(
  e: Engine,
  fix: { hands?: Record<string, string[]>; board?: string[]; chips?: Record<string, number> },
) {
  const s = structuredClone(S(e));
  for (const [p, cards] of Object.entries(fix.hands ?? {})) {
    s.hands[p] = createSecret(cards, [p], ["?", "?"]);
  }
  if (fix.board) {
    const [f1, f2, f3, turn, river] = fix.board;
    s.deck = createSecret([river, turn, f3, f2, f1], [], ["?", "?", "?", "?", "?"]);
  }
  for (const [p, chips] of Object.entries(fix.chips ?? {})) s.playerChips[p] = chips;
  e.loadState(s, e.getReplayData());
}

const totalChips = (s: TexasHoldemState) =>
  Object.values(s.playerChips).reduce((a, b) => a + b, 0) + s.pot;

/** 全員チェックで 1 ラウンド進める（seatOrder はディーラーの左隣から） */
function checkAround(e: Engine, order: string[]) {
  for (const p of order) must(e, p, "CHECK");
}

describe("TexasHoldemRuleset: 開始とブラインド", () => {
  it("JOIN で着席、2 人以上で START。配札とブラインド投入が行われ UTG から始まる", () => {
    const engine = new UniversalEngine<TexasHoldemState, TexasHoldemAction>(TexasHoldemRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: "p1" });
    expect(TexasHoldemRuleset.isValidAction(S(engine), { type: "START", playerId: "p1" })).toBe(
      false,
    );
    expect(engine.getLegalActions("p1")).toEqual([]);
    engine.dispatch({ type: "JOIN", playerId: "p2" });
    engine.dispatch({ type: "JOIN", playerId: "p3" });
    expect(engine.getLegalActions("p1")).toEqual([{ type: "START", playerId: "p1" }]);
    expect(engine.dispatch({ type: "START", playerId: "p1" })).toBe(true);

    const s = S(engine);
    expect(s.status).toBe("PLAYING");
    expect(s.phase).toBe("PRE_FLOP");
    expect(s.playerIds).toEqual(P);
    expect(s.dealerIndex).toBe(0);
    for (const p of P) expect(s.hands[p].value.length).toBe(2);
    expect(s.deck.value.length).toBe(52 - 6);
    expect(new Set([...s.deck.value, ...P.flatMap((p) => s.hands[p].value)]).size).toBe(52);
    expect(s.communityCards).toEqual([]);

    // ブラインド: SB = p2 (10), BB = p3 (20)
    expect(s.playerChips).toEqual({ p1: 1000, p2: 990, p3: 980 });
    expect(s.playerBets).toEqual({ p1: 0, p2: 10, p3: 20 });
    expect(s.pot).toBe(30);
    expect(s.currentBet).toBe(20);
    expect(s.minRaise).toBe(20);
    // BB の左隣（UTG）から
    expect(s.activePlayers).toEqual(["p1"]);
    // 開始後は席が閉じる
    expect(engine.dispatch({ type: "JOIN", playerId: "z" })).toBe(false);
  });

  it("オプションで初期チップとブラインドを変えられる。playerIds を渡せば着席済み", () => {
    const engine = new UniversalEngine<TexasHoldemState, TexasHoldemAction>(TexasHoldemRuleset, {
      playerIds: ["a", "b"],
      initialChips: 500,
      smallBlind: 5,
      bigBlind: 10,
    });
    expect(engine.dispatch({ type: "START", playerId: "a" })).toBe(true);
    const s = S(engine);
    expect(s.playerChips).toEqual({ a: 495, b: 490 });
    expect(s.currentBet).toBe(10);
    expect(s.minRaise).toBe(10);
  });

  it("ヘッズアップではディーラーが SB でプリフロップは先に行動し、フロップ以降は BB から", () => {
    const e = started(["p1", "p2"]);
    expect(S(e).playerBets).toEqual({ p1: 10, p2: 20 });
    expect(S(e).activePlayers).toEqual(["p1"]);
    must(e, "p1", "CALL");
    expect(S(e).activePlayers).toEqual(["p2"]); // BB にオプション
    must(e, "p2", "CHECK");
    expect(S(e).phase).toBe("FLOP");
    expect(S(e).activePlayers).toEqual(["p2"]);
  });

  it("自分の手札だけ見える。山札と相手の手札は伏せられる", () => {
    const e = started();
    const forP1 = masked(e, "p1");
    expect(forP1.hands.p1).toEqual(S(e).hands.p1.value);
    expect(forP1.hands.p2).toEqual(["?", "?"]);
    expect(forP1.deck).toEqual(S(e).deck.value.map(() => "?"));
    expect(masked(e, "SPECTATOR").hands.p1).toEqual(["?", "?"]);
  });
});

describe("TexasHoldemRuleset: アクションの検証", () => {
  it("手番以外・フォールド済みは行動できない", () => {
    const e = started();
    expect(act(e, "p2", "CALL")).toBe(false);
    expect(e.getLegalActions("p2")).toEqual([]);
    must(e, "p1", "FOLD");
    expect(act(e, "p1", "CALL")).toBe(false);
  });

  it("ベットに直面しているときは CHECK できず、CALL / RAISE / FOLD が合法", () => {
    const e = started();
    const s = S(e);
    expect(TexasHoldemRuleset.isValidAction(s, { type: "CHECK", playerId: "p1" })).toBe(false);
    expect(TexasHoldemRuleset.isValidAction(s, { type: "CALL", playerId: "p1" })).toBe(true);
    expect(TexasHoldemRuleset.isValidAction(s, { type: "FOLD", playerId: "p1" })).toBe(true);
    const legal = e.getLegalActions("p1");
    expect(legal.map((a) => a.type)).toEqual(["FOLD", "CALL", "RAISE", "RAISE", "RAISE"]);
    // ミニマム / ポットサイズ（ポット 30 + コール 20） / オールイン（1000 - 20）
    expect(legal.filter((a) => a.type === "RAISE").map((a) => a.amount)).toEqual([20, 50, 980]);
  });

  it("RAISE はミニマムレイズ以上、かつコール額込みで所持チップ以内", () => {
    const e = started();
    const s = S(e);
    const raise = (amount: number) =>
      TexasHoldemRuleset.isValidAction(s, { type: "RAISE", playerId: "p1", amount });
    expect(raise(19)).toBe(false); // ミニマム（BB = 20）未満
    expect(raise(20)).toBe(true);
    expect(raise(980)).toBe(true); // コール 20 + 980 = 1000 でちょうどオールイン
    expect(raise(981)).toBe(false);
    expect(raise(0)).toBe(false);
    expect(raise(-5)).toBe(false);
    expect(raise(20.5)).toBe(false);
    expect(TexasHoldemRuleset.isValidAction(s, { type: "RAISE", playerId: "p1" })).toBe(false);
  });

  it("RAISE 後はミニマムレイズ幅が更新され、レイズした本人は他の誰かがレイズするまで再レイズできない", () => {
    const e = started();
    must(e, "p1", "RAISE", 40); // 20 → 60
    let s = S(e);
    expect(s.currentBet).toBe(60);
    expect(s.minRaise).toBe(40);
    expect(s.playerChips.p1).toBe(940);
    expect(s.pot).toBe(90);
    expect(s.activePlayers).toEqual(["p2"]);

    // p2 は 40 未満のレイズ不可（オールイン除く）
    expect(act(e, "p2", "RAISE", 30)).toBe(false);
    must(e, "p2", "RAISE", 40); // 60 → 100
    must(e, "p3", "CALL");
    s = S(e);
    expect(s.activePlayers).toEqual(["p1"]);
    // p2 のレイズで p1 に行動権が戻る
    expect(TexasHoldemRuleset.isValidAction(s, { type: "RAISE", playerId: "p1", amount: 40 })).toBe(
      true,
    );
    must(e, "p1", "CALL");
    s = S(e);
    expect(s.phase).toBe("FLOP");
    expect(s.pot).toBe(300);
  });

  it("制限時間切れはチェックできればチェック、できなければフォールド", () => {
    const e = started();
    expect(TexasHoldemRuleset.getTimeoutAction!(S(e), "p1")).toEqual({
      type: "FOLD",
      playerId: "p1",
    });
    must(e, "p1", "CALL");
    must(e, "p2", "CALL");
    expect(TexasHoldemRuleset.getTimeoutAction!(S(e), "p3")).toEqual({
      type: "CHECK",
      playerId: "p3",
    });
  });
});

describe("TexasHoldemRuleset: フェーズ進行", () => {
  it("全員がコールし BB がチェックするとフロップ。以降はディーラーの左隣から", () => {
    const e = started();
    must(e, "p1", "CALL");
    must(e, "p2", "CALL");
    // BB にはオプションがある（自動で進まない）
    let s = S(e);
    expect(s.phase).toBe("PRE_FLOP");
    expect(s.activePlayers).toEqual(["p3"]);
    expect(TexasHoldemRuleset.isValidAction(s, { type: "RAISE", playerId: "p3", amount: 20 })).toBe(
      true,
    );
    must(e, "p3", "CHECK");

    s = S(e);
    expect(s.phase).toBe("FLOP");
    expect(s.communityCards.length).toBe(3);
    expect(s.deck.value.length).toBe(52 - 6 - 3);
    expect(s.pot).toBe(60);
    expect(s.currentBet).toBe(0);
    expect(s.minRaise).toBe(20);
    expect(s.playerBets).toEqual({ p1: 0, p2: 0, p3: 0 });
    expect(s.activePlayers).toEqual(["p2"]);
    expect(e.getLegalActions("p2").map((a) => a.type)).toEqual([
      "FOLD",
      "CHECK",
      "RAISE",
      "RAISE",
      "RAISE",
    ]);

    checkAround(e, ["p2", "p3", "p1"]);
    s = S(e);
    expect(s.phase).toBe("TURN");
    expect(s.communityCards.length).toBe(4);

    checkAround(e, ["p2", "p3", "p1"]);
    s = S(e);
    expect(s.phase).toBe("RIVER");
    expect(s.communityCards.length).toBe(5);

    checkAround(e, ["p2", "p3", "p1"]);
    s = S(e);
    expect(s.phase).toBe("SHOWDOWN");
    expect(s.status).toBe("FINISHED");
    expect(s.activePlayers).toEqual([]);
    expect(s.pot).toBe(0);
    expect(totalChips(s)).toBe(3000);
    expect(s.result?.reason).toBe("SHOWDOWN");
    expect(s.result?.showdown?.length).toBe(3);
    expect(s.result?.winnerIds.length).toBeGreaterThan(0);
    // ショーダウンでは残った全員の手札が公開される
    const spectator = masked(e, "SPECTATOR");
    for (const p of P) expect(spectator.hands[p]).toEqual(s.hands[p].value);
  });

  it("BB のオプション: 全員コール後に BB がレイズすればラウンドが続く", () => {
    const e = started();
    must(e, "p1", "CALL");
    must(e, "p2", "CALL");
    must(e, "p3", "RAISE", 20);
    const s = S(e);
    expect(s.phase).toBe("PRE_FLOP");
    expect(s.currentBet).toBe(40);
    expect(s.activePlayers).toEqual(["p1"]);
  });

  it("フロップ以降でフォールドした人は以降スキップされる", () => {
    const e = started();
    must(e, "p1", "CALL");
    must(e, "p2", "CALL");
    must(e, "p3", "CHECK");
    must(e, "p2", "FOLD");
    expect(S(e).activePlayers).toEqual(["p3"]);
    must(e, "p3", "CHECK");
    must(e, "p1", "CHECK");
    expect(S(e).phase).toBe("TURN");
    expect(S(e).activePlayers).toEqual(["p3"]);
  });
});

describe("TexasHoldemRuleset: 精算", () => {
  it("残り 1 人になればポットを総取りして終了。手札は公開されない", () => {
    const e = started();
    must(e, "p1", "RAISE", 40);
    must(e, "p2", "FOLD");
    must(e, "p3", "FOLD");
    const s = S(e);
    expect(s.status).toBe("FINISHED");
    expect(s.phase).toBe("PRE_FLOP");
    expect(s.result).toEqual({ reason: "FOLD", winnerIds: ["p1"], payouts: { p1: 90 } });
    expect(s.playerChips).toEqual({ p1: 1030, p2: 990, p3: 980 });
    expect(s.pot).toBe(0);
    expect(s.message).toContain("p1 wins 90 chips");
    expect(masked(e, "p2").hands.p1).toEqual(["?", "?"]);
    expect(act(e, "p1", "CHECK")).toBe(false);
  });

  it("ショーダウンで最強の役がポットを獲得する", () => {
    const e = started();
    patch(e, {
      hands: { p1: ["AS", "AH"], p2: ["KS", "KH"], p3: ["2C", "7D"] },
      board: ["3D", "8H", "9C", "JD", "QS"],
    });
    must(e, "p1", "CALL");
    must(e, "p2", "CALL");
    must(e, "p3", "CHECK");
    for (let i = 0; i < 3; i++) checkAround(e, ["p2", "p3", "p1"]);

    const s = S(e);
    expect(s.status).toBe("FINISHED");
    expect(s.communityCards).toEqual(["3D", "8H", "9C", "JD", "QS"]);
    expect(s.result?.winnerIds).toEqual(["p1"]);
    expect(s.result?.payouts).toEqual({ p1: 60 });
    expect(s.result?.showdown).toEqual([
      { playerId: "p2", handName: "One Pair", bestCards: expect.arrayContaining(["KS", "KH"]) },
      { playerId: "p3", handName: "High Card", bestCards: expect.any(Array) },
      { playerId: "p1", handName: "One Pair", bestCards: expect.arrayContaining(["AS", "AH"]) },
    ]);
    expect(s.playerChips).toEqual({ p1: 1040, p2: 980, p3: 980 });
    expect(s.message).toContain("p1 wins with One Pair");
  });

  it("チップが足りなくてもコールできる（オールイン）。サイドポットは残りの 2 人で争う", () => {
    const e = started();
    patch(e, {
      hands: { p1: ["AS", "AH"], p2: ["KS", "KH"], p3: ["2C", "7D"] },
      board: ["3D", "8H", "9C", "JD", "QS"],
      chips: { p1: 100 },
    });
    // p1 は 100 でオールイン（コール 20 + 80）
    must(e, "p1", "RAISE", 80);
    expect(S(e).allInPlayers).toEqual(["p1"]);
    expect(S(e).minRaise).toBe(80);
    must(e, "p2", "CALL"); // 100
    must(e, "p3", "RAISE", 200); // 100 → 300
    must(e, "p2", "CALL");
    let s = S(e);
    expect(s.phase).toBe("FLOP");
    expect(s.pot).toBe(700);
    // オールインの p1 は手番に含まれない
    expect(s.activePlayers).toEqual(["p2"]);
    expect(act(e, "p1", "CHECK")).toBe(false);

    for (let i = 0; i < 3; i++) checkAround(e, ["p2", "p3"]);
    s = S(e);
    expect(s.status).toBe("FINISHED");
    // メインポット 300（100 × 3）は p1、サイドポット 400（200 × 2）は p2
    expect(s.result?.payouts).toEqual({ p1: 300, p2: 400 });
    expect(s.result?.winnerIds).toEqual(["p1"]);
    expect(s.playerChips).toEqual({ p1: 300, p2: 1100, p3: 700 });
    expect(totalChips(s)).toBe(2100);
  });

  it("チップ不足の CALL は持っている分だけ投入してオールインになる", () => {
    const e = started();
    patch(e, { chips: { p2: 30 } }); // SB 投入後 30 残っている想定
    must(e, "p1", "RAISE", 80); // 100 にレイズ
    expect(e.getLegalActions("p2").map((a) => a.type)).toEqual(["FOLD", "CALL"]);
    must(e, "p2", "CALL");
    const s = S(e);
    expect(s.playerChips.p2).toBe(0);
    expect(s.playerBets.p2).toBe(40);
    expect(s.totalBets.p2).toBe(40);
    expect(s.allInPlayers).toEqual(["p2"]);
    expect(s.currentBet).toBe(100);
    expect(s.activePlayers).toEqual(["p3"]);
  });

  it("ショートオールイン（ミニマム未満のレイズ）は行動済みの人の再レイズ権を復活させない", () => {
    const e = started();
    patch(e, { chips: { p2: 35 } });
    must(e, "p1", "RAISE", 20); // 40 に。minRaise = 20
    // p2: コール 30 + 5 = 35 でオールイン。5 < 20 だがオールインなので許可
    expect(act(e, "p2", "RAISE", 10)).toBe(false); // 45 > 35
    must(e, "p2", "RAISE", 5);
    let s = S(e);
    expect(s.currentBet).toBe(45);
    expect(s.minRaise).toBe(20); // 更新されない
    expect(s.activePlayers).toEqual(["p3"]);
    // まだ行動していない p3 はレイズできる
    expect(TexasHoldemRuleset.isValidAction(s, { type: "RAISE", playerId: "p3", amount: 20 })).toBe(
      true,
    );
    must(e, "p3", "CALL");
    s = S(e);
    // 行動済みの p1 は差額 5 のコールかフォールドのみ
    expect(s.activePlayers).toEqual(["p1"]);
    expect(e.getLegalActions("p1").map((a) => a.type)).toEqual(["FOLD", "CALL"]);
    must(e, "p1", "CALL");
    s = S(e);
    expect(s.phase).toBe("FLOP");
    expect(s.pot).toBe(45 * 3);
    expect(s.playerChips.p1).toBe(955);
  });

  it("全員オールイン（または残り 1 人）ならボードを最後まで開いてショーダウンする", () => {
    const e = started(["p1", "p2"]);
    patch(e, {
      hands: { p1: ["2C", "7D"], p2: ["AS", "AH"] },
      board: ["3D", "8H", "9C", "JD", "QS"],
    });
    must(e, "p1", "RAISE", 980); // オールイン
    must(e, "p2", "CALL");
    const s = S(e);
    expect(s.status).toBe("FINISHED");
    expect(s.phase).toBe("SHOWDOWN");
    expect(s.communityCards.length).toBe(5);
    expect(s.result?.winnerIds).toEqual(["p2"]);
    expect(s.playerChips).toEqual({ p1: 0, p2: 2000 });
  });

  it("同点は山分け。端数はディーラーの左隣から順に配る", () => {
    const e = started(P, { smallBlind: 7, bigBlind: 20 });
    // ボードでロイヤルフラッシュ（手札は関係なし）
    patch(e, {
      hands: { p1: ["2C", "7D"], p2: ["3C", "8D"], p3: ["4C", "9D"] },
      board: ["TS", "JS", "QS", "KS", "AS"],
    });
    must(e, "p1", "CALL"); // 20
    must(e, "p2", "FOLD"); // SB 7 はポットに残る
    must(e, "p3", "CHECK");
    expect(S(e).pot).toBe(47);
    for (let i = 0; i < 3; i++) checkAround(e, ["p3", "p1"]);

    const s = S(e);
    expect(s.result?.winnerIds).toEqual(["p3", "p1"]);
    expect(s.result?.payouts).toEqual({ p3: 24, p1: 23 });
    expect(s.playerChips).toEqual({ p1: 1003, p2: 993, p3: 1004 });
    expect(s.message).toContain("split the pot");
    // フォールドした p2 の手札は公開されない
    expect(masked(e, "SPECTATOR").hands.p2).toEqual(["?", "?"]);
  });

  it("同じシードなら同じ配札・同じ展開になる", () => {
    const e1 = started(P, {}, "same-seed");
    const e2 = started(P, {}, "same-seed");
    expect(JSON.stringify(S(e1))).toBe(JSON.stringify(S(e2)));
    must(e1, "p1", "CALL");
    must(e2, "p1", "CALL");
    expect(JSON.stringify(S(e1))).toBe(JSON.stringify(S(e2)));
    const e3 = started(P, {}, "other-seed");
    expect(S(e3).hands.p1.value).not.toEqual(S(e1).hands.p1.value);
  });
});
