// packages/shared/rules/__tests__/ShogiRuleset.test.ts
//
// 盤の座標: index = y * 9 + x。x=0 が先手から見て左（9 筋）、y=0 が後手側の最上段（一段目）。
// 駒の値: 1 歩 2 香 3 桂 4 銀 5 金 6 角 7 飛 8 玉 / 9 と 10 成香 11 成桂 12 成銀 13 馬 14 龍。正が先手、負が後手。
import { expect, test, describe } from "bun:test";
import {
  ShogiRuleset,
  isInCheck,
  positionKey,
  REPETITION_LIMIT,
  evaluateDeclaration,
  type ShogiState,
  type ShogiAction,
} from "../ShogiRuleset";
import { UniversalEngine } from "../../UniversalEngine";

const I = (x: number, y: number) => y * 9 + x;
const P1 = "sente";
const P2 = "gote";

/** 駒を並べた対局中の局面を作る（未指定のマスは空） */
function position(
  pieces: Record<number, number>,
  opts: { turn?: 1 | -1; hands?: Partial<ShogiState["hands"]> } = {},
): ShogiState {
  const state = ShogiRuleset.getInitialState();
  state.board = new Array(81).fill(0);
  for (const [i, v] of Object.entries(pieces)) state.board[Number(i)] = v;
  state.turn = opts.turn ?? 1;
  state.hands = { 1: {}, "-1": {}, ...opts.hands };
  state.status = "PLAYING";
  state.players = { 1: P1, "-1": P2 };
  state.activePlayers = [state.turn === 1 ? P1 : P2];
  state.positionHistory = [
    { key: positionKey(state), check: isInCheck(state.board, state.turn as 1 | -1) },
  ];
  return state;
}

const move = (from: number, to: number, promote = false, playerId = P1): ShogiAction => ({
  type: "MOVE",
  from,
  to,
  promote,
  playerId,
});
const drop = (piece: number, to: number, playerId = P1): ShogiAction => ({
  type: "DROP",
  piece,
  to,
  playerId,
});

describe("ShogiRuleset: 初期配置と基本の動き", () => {
  test("初期配置は 9x9 の標準配置", () => {
    const state = ShogiRuleset.getInitialState();
    expect(state.status).toBe("WAITING");
    expect(state.board.length).toBe(81);
    // 後手: 一段目 香桂銀金玉金銀桂香、二段目 飛(8二)・角(2二)
    expect(state.board.slice(0, 9)).toEqual([-2, -3, -4, -5, -8, -5, -4, -3, -2]);
    expect(state.board[I(1, 1)]).toBe(-7);
    expect(state.board[I(7, 1)]).toBe(-6);
    // 先手: 九段目 香桂銀金玉金銀桂香、八段目 角(8八)・飛(2八)
    expect(state.board.slice(72)).toEqual([2, 3, 4, 5, 8, 5, 4, 3, 2]);
    expect(state.board[I(1, 7)]).toBe(6);
    expect(state.board[I(7, 7)]).toBe(7);
    for (let x = 0; x < 9; x++) {
      expect(state.board[I(x, 2)]).toBe(-1);
      expect(state.board[I(x, 6)]).toBe(1);
    }
  });

  test("初期局面の先手の合法手は 30 手", () => {
    const engine = new UniversalEngine(ShogiRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: P1 } as any);
    engine.dispatch({ type: "JOIN", playerId: P2 } as any);
    engine.dispatch({ type: "START", playerId: P1 } as any);
    expect(engine.getState().activePlayers).toEqual([P1]);
    expect(engine.getLegalActions(P1).length).toBe(30);
    expect(engine.getLegalActions(P2)).toEqual([]);
  });

  test("各駒の動き（先手基準）", () => {
    const legalTargets = (piece: number, at: number, extra: Record<number, number> = {}) => {
      // 玉は 5五からの斜め筋・十字筋に掛からない位置に置く
      const state = position({ [at]: piece, [I(0, 7)]: 8, [I(8, 1)]: -8, ...extra });
      const targets = ShogiRuleset.getLegalActions(state, P1)
        .filter((a) => a.type === "MOVE" && a.from === at)
        .map((a) => a.to!);
      return [...new Set(targets)].sort((a, b) => a - b);
    };
    const c = I(4, 4);
    expect(legalTargets(1, c)).toEqual([I(4, 3)]); // 歩
    expect(legalTargets(3, c)).toEqual([I(3, 2), I(5, 2)]); // 桂
    expect(legalTargets(4, c)).toEqual(
      [I(3, 3), I(4, 3), I(5, 3), I(3, 5), I(5, 5)].sort((a, b) => a - b),
    ); // 銀
    expect(legalTargets(5, c)).toEqual(
      [I(3, 3), I(4, 3), I(5, 3), I(3, 4), I(5, 4), I(4, 5)].sort((a, b) => a - b),
    ); // 金
    // 香: 前方に遮られるまで
    expect(legalTargets(2, c, { [I(4, 1)]: -1 })).toEqual(
      [I(4, 3), I(4, 2), I(4, 1)].sort((a, b) => a - b),
    );
    // 飛: 十字に 16 マス、角: 斜めに 16 マス
    expect(legalTargets(7, c).length).toBe(16);
    expect(legalTargets(6, c).length).toBe(16);
    // 馬 = 角 + 十字 1 マス、龍 = 飛 + 斜め 1 マス
    expect(legalTargets(13, c).length).toBe(20);
    expect(legalTargets(14, c).length).toBe(20);
    // と・成香・成桂・成銀は金と同じ
    for (const promoted of [9, 10, 11, 12]) {
      expect(legalTargets(promoted, c)).toEqual(legalTargets(5, c));
    }
  });

  test("後手の駒は逆向きに進む", () => {
    const state = position(
      { [I(4, 4)]: -1, [I(4, 3)]: -3, [I(0, 8)]: 8, [I(8, 0)]: -8 },
      { turn: -1 },
    );
    const targets = ShogiRuleset.getLegalActions(state, P2)
      .filter((a) => a.type === "MOVE")
      .map((a) => `${a.from}->${a.to}`);
    expect(targets).toContain(`${I(4, 4)}->${I(4, 5)}`); // 歩は下へ
    expect(targets).toContain(`${I(4, 3)}->${I(3, 5)}`); // 桂は下へ
    expect(targets).toContain(`${I(4, 3)}->${I(5, 5)}`);
  });

  test("自分の駒があるマスへは動けず、相手の駒は取れて持ち駒になる（成り駒は元に戻る）", () => {
    const state = position({
      [I(4, 4)]: 7,
      [I(4, 2)]: -14,
      [I(4, 6)]: 1,
      [I(0, 8)]: 8,
      [I(8, 0)]: -8,
    });
    expect(ShogiRuleset.isValidAction(state, move(I(4, 4), I(4, 6)))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, move(I(4, 4), I(4, 1)))).toBe(false); // 龍の向こうへは飛べない
    const next = ShogiRuleset.reduce(state, move(I(4, 4), I(4, 2)));
    expect(next.board[I(4, 2)]).toBe(7);
    expect(next.board[I(4, 4)]).toBe(0);
    expect(next.hands[1][7]).toBe(1); // 龍は飛車として持ち駒に
    expect(next.turn).toBe(-1);
    expect(next.activePlayers).toEqual([P2]);
  });

  test("手番でないプレイヤーや相手の駒は動かせない", () => {
    const state = ShogiRuleset.getInitialState();
    state.status = "PLAYING";
    state.players = { 1: P1, "-1": P2 };
    expect(ShogiRuleset.isValidAction(state, move(I(6, 6), I(6, 5)))).toBe(true);
    expect(ShogiRuleset.isValidAction(state, move(I(6, 6), I(6, 5), false, P2))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, move(I(2, 2), I(2, 3)))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, move(I(6, 6), I(6, 5), false, "someone"))).toBe(false);
  });
});

describe("ShogiRuleset: 成り", () => {
  test("敵陣に入る・敵陣から出る手は成れる。敵陣に無関係な手は成れない", () => {
    const state = position({ [I(4, 3)]: 4, [I(2, 2)]: 4, [I(0, 8)]: 8, [I(8, 0)]: -8 });
    expect(ShogiRuleset.isValidAction(state, move(I(4, 3), I(4, 2), true))).toBe(true); // 三段目へ
    expect(ShogiRuleset.isValidAction(state, move(I(4, 3), I(4, 2), false))).toBe(true); // 成らずも可
    expect(ShogiRuleset.isValidAction(state, move(I(2, 2), I(1, 3), true))).toBe(true); // 敵陣から出る（銀の斜め後ろ）
    expect(ShogiRuleset.isValidAction(state, move(I(4, 3), I(3, 4), true))).toBe(false); // 敵陣外
    const promoted = ShogiRuleset.reduce(state, move(I(4, 3), I(4, 2), true));
    expect(promoted.board[I(4, 2)]).toBe(12);
  });

  test("金・玉・成り駒は成れない", () => {
    const state = position({ [I(4, 3)]: 5, [I(3, 3)]: 9, [I(0, 8)]: 8, [I(8, 0)]: -8 });
    expect(ShogiRuleset.isValidAction(state, move(I(4, 3), I(4, 2), true))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, move(I(3, 3), I(3, 2), true))).toBe(false);
  });

  test("行き所のない駒は強制成り（歩・香は一段目、桂は二段目まで）", () => {
    const state = position({
      [I(4, 1)]: 1,
      [I(2, 1)]: 2,
      [I(6, 3)]: 3,
      [I(0, 8)]: 8,
      [I(8, 0)]: -8,
    });
    expect(ShogiRuleset.isValidAction(state, move(I(4, 1), I(4, 0), false))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, move(I(4, 1), I(4, 0), true))).toBe(true);
    expect(ShogiRuleset.isValidAction(state, move(I(2, 1), I(2, 0), false))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, move(I(6, 3), I(5, 1), false))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, move(I(6, 3), I(5, 1), true))).toBe(true);
    // 合法手生成でも「成らず」は出てこない
    const legal = ShogiRuleset.getLegalActions(state, P1).filter(
      (a) => a.type === "MOVE" && a.from === I(4, 1),
    );
    expect(legal).toEqual([
      { type: "MOVE", from: I(4, 1), to: I(4, 0), promote: true, playerId: P1 },
    ]);
  });
});

describe("ShogiRuleset: 持ち駒を打つ", () => {
  test("持っていない駒・駒のあるマスには打てず、打つと持ち駒が減る", () => {
    const state = position(
      { [I(0, 8)]: 8, [I(8, 0)]: -8, [I(4, 4)]: -1 },
      { hands: { 1: { 4: 1 } } },
    );
    expect(ShogiRuleset.isValidAction(state, drop(5, I(4, 5)))).toBe(false); // 金は持っていない
    expect(ShogiRuleset.isValidAction(state, drop(4, I(4, 4)))).toBe(false); // 駒がある
    expect(ShogiRuleset.isValidAction(state, drop(4, I(4, 5)))).toBe(true);
    const next = ShogiRuleset.reduce(state, drop(4, I(4, 5)));
    expect(next.board[I(4, 5)]).toBe(4);
    expect(next.hands[1][4]).toBe(0);
    expect(next.turn).toBe(-1);
  });

  test("二歩は打てない（相手の歩や自分のと金は関係ない）", () => {
    const state = position(
      { [I(0, 8)]: 8, [I(8, 0)]: -8, [I(3, 6)]: 1, [I(5, 2)]: -1, [I(6, 2)]: 9 },
      { hands: { 1: { 1: 1 } } },
    );
    expect(ShogiRuleset.isValidAction(state, drop(1, I(3, 4)))).toBe(false); // 3 筋に自分の歩
    expect(ShogiRuleset.isValidAction(state, drop(1, I(5, 4)))).toBe(true); // 相手の歩は無関係
    expect(ShogiRuleset.isValidAction(state, drop(1, I(6, 4)))).toBe(true); // と金は無関係
  });

  test("行き所のないマスには打てない", () => {
    const state = position({ [I(0, 8)]: 8, [I(8, 0)]: -8 }, { hands: { 1: { 1: 1, 2: 1, 3: 1 } } });
    expect(ShogiRuleset.isValidAction(state, drop(1, I(4, 0)))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, drop(2, I(4, 0)))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, drop(3, I(4, 1)))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, drop(3, I(4, 2)))).toBe(true);
    // 後手は逆
    const gote = position(
      { [I(0, 8)]: 8, [I(8, 0)]: -8 },
      { turn: -1, hands: { "-1": { 1: 1, 3: 1 } } },
    );
    expect(ShogiRuleset.isValidAction(gote, drop(1, I(4, 8), P2))).toBe(false);
    expect(ShogiRuleset.isValidAction(gote, drop(3, I(4, 7), P2))).toBe(false);
    expect(ShogiRuleset.isValidAction(gote, drop(3, I(4, 6), P2))).toBe(true);
  });
});

describe("ShogiRuleset: 王手・詰み", () => {
  test("王手放置・自殺手は指せず、合法手は王手を解消する手だけになる", () => {
    // 後手の飛車が 5 筋から先手玉に王手。先手は歩の持ち駒あり
    const state = position(
      { [I(4, 8)]: 8, [I(4, 0)]: -7, [I(8, 0)]: -8, [I(0, 6)]: 1, [I(3, 7)]: 5 },
      { hands: { 1: { 1: 1 } } },
    );
    expect(isInCheck(state.board, 1)).toBe(true);
    expect(ShogiRuleset.isValidAction(state, move(I(0, 6), I(0, 5)))).toBe(false); // 無関係な手
    expect(ShogiRuleset.isValidAction(state, move(I(4, 8), I(4, 7)))).toBe(false); // 飛車の利きへ
    expect(ShogiRuleset.isValidAction(state, move(I(4, 8), I(5, 8)))).toBe(true); // 逃げる
    expect(ShogiRuleset.isValidAction(state, drop(1, I(4, 4)))).toBe(true); // 合駒
    expect(ShogiRuleset.isValidAction(state, move(I(3, 7), I(4, 7)))).toBe(true); // 金で合駒

    const legal = ShogiRuleset.getLegalActions(state, P1);
    expect(legal.length).toBeGreaterThan(0);
    for (const a of legal) {
      const next = ShogiRuleset.reduce(state, a);
      expect(isInCheck(next.board, 1)).toBe(false);
    }
  });

  test("ピンされた駒は動かせない", () => {
    // 先手玉 5九、先手金 5五、後手飛車 5一 → 金を横に動かすと玉が取られる
    const state = position({ [I(4, 8)]: 8, [I(4, 4)]: 5, [I(4, 0)]: -7, [I(8, 0)]: -8 });
    expect(ShogiRuleset.isValidAction(state, move(I(4, 4), I(3, 4)))).toBe(false);
    expect(ShogiRuleset.isValidAction(state, move(I(4, 4), I(4, 3)))).toBe(true); // 筋上は可
  });

  test("詰み: 手番側に合法手が無ければ相手の勝ち", () => {
    // 後手玉 5一に頭金（5二の金を 5四の飛車が支える）
    const state = position(
      { [I(4, 0)]: -8, [I(4, 1)]: 5, [I(4, 3)]: 7, [I(4, 8)]: 8 },
      { turn: -1 },
    );
    expect(isInCheck(state.board, -1)).toBe(true);
    expect(ShogiRuleset.getLegalActions(state, P2)).toEqual([]);
    const result = ShogiRuleset.checkWinCondition(state);
    expect(result.isFinished).toBe(true);
    expect(result.winnerIds).toEqual([P1]);
    expect(result.message).toContain("Checkmate");
  });

  test("王手でなくても合法手が無ければ負け（将棋ではステイルメイトも負け）", () => {
    // 後手玉 9一。先手の金 7二 が 8一・8二 を、銀 9三 が 9二 を押さえ、王手はかかっていない。後手に他の駒なし
    const state = position(
      { [I(0, 0)]: -8, [I(2, 1)]: 5, [I(0, 2)]: 4, [I(4, 8)]: 8 },
      { turn: -1 },
    );
    expect(isInCheck(state.board, -1)).toBe(false);
    expect(ShogiRuleset.getLegalActions(state, P2)).toEqual([]);
    const result = ShogiRuleset.checkWinCondition(state);
    expect(result.isFinished).toBe(true);
    expect(result.winnerIds).toEqual([P1]);
    expect(result.message).toContain("No legal moves");
  });

  test("エンジン経由で詰ますと FINISHED になり、王を取る手は生成されない", () => {
    const engine = new UniversalEngine(ShogiRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: P1 } as any);
    engine.dispatch({ type: "JOIN", playerId: P2 } as any);
    engine.dispatch({ type: "START", playerId: P1 } as any);
    // 詰み一歩手前の局面を読み込む: 先手が 5二に金を打てば頭金
    const s = position({ [I(4, 0)]: -8, [I(4, 3)]: 7, [I(4, 8)]: 8 }, { hands: { 1: { 5: 1 } } });
    s.prngConfig = engine.getState().prngConfig;
    engine.loadState(s, engine.getReplayData());

    expect(engine.dispatch(drop(5, I(4, 1)))).toBe(true);
    const fin = engine.getState();
    expect(fin.status).toBe("FINISHED");
    expect(fin.message).toContain("Sente Wins");
    expect(fin.board.includes(-8)).toBe(true); // 玉は盤上に残っている
    expect(engine.getLegalActions(P2)).toEqual([]);
  });
});

describe("ShogiRuleset: 打ち歩詰め", () => {
  // 後手玉 5一。先手の金 7二・3二 が 4一/6一/4二/6二 を、銀 6三 が 5二 を支える。後手に他の駒なし
  const base = { [I(4, 0)]: -8, [I(2, 1)]: 5, [I(6, 1)]: 5, [I(3, 2)]: 4, [I(4, 8)]: 8 };

  test("歩を打って詰ますのは反則", () => {
    const state = position(base, { hands: { 1: { 1: 1 } } });
    expect(isInCheck(state.board, -1)).toBe(false);
    expect(ShogiRuleset.isValidAction(state, drop(1, I(4, 1)))).toBe(false);
    expect(
      ShogiRuleset.getLegalActions(state, P1).some((a) => a.type === "DROP" && a.to === I(4, 1)),
    ).toBe(false);
    // 詰まない場所には打てる
    expect(ShogiRuleset.isValidAction(state, drop(1, I(4, 4)))).toBe(true);
  });

  test("歩を突いて詰ますのは合法（突き歩詰め）", () => {
    const state = position({ ...base, [I(4, 2)]: 1 });
    expect(ShogiRuleset.isValidAction(state, move(I(4, 2), I(4, 1)))).toBe(true);
    const next = ShogiRuleset.reduce(state, move(I(4, 2), I(4, 1)));
    expect(ShogiRuleset.checkWinCondition(next).winnerIds).toEqual([P1]);
  });

  test("王手になる歩打ちでも、相手に逃げ場があれば合法", () => {
    const state = position({ ...base, [I(6, 1)]: 0 }, { hands: { 1: { 1: 1 } } }); // 3二の金を外す
    expect(ShogiRuleset.isValidAction(state, drop(1, I(4, 1)))).toBe(true);
  });
});

describe("ShogiRuleset: 千日手", () => {
  /** 手順を順に指して各局面の勝敗判定を返す */
  const play = (state: ShogiState, actions: ShogiAction[]) => {
    let s = state;
    const results = [];
    for (const a of actions) {
      expect(ShogiRuleset.isValidAction(s, a), JSON.stringify(a)).toBe(true);
      s = ShogiRuleset.reduce(s, a);
      results.push(ShogiRuleset.checkWinCondition(s));
    }
    return { state: s, results };
  };

  test("同一局面が 4 回現れたら引き分け（王手が絡まない場合）", () => {
    // 玉と離れた金だけの局面で、両者が玉を往復させる
    const state = position({ [I(4, 8)]: 8, [I(4, 0)]: -8, [I(0, 5)]: 5, [I(8, 3)]: -5 });
    const cycle: ShogiAction[] = [
      move(I(4, 8), I(5, 8)),
      move(I(4, 0), I(5, 0), false, P2),
      move(I(5, 8), I(4, 8)),
      move(I(5, 0), I(4, 0), false, P2),
    ];
    const { state: end, results } = play(state, [...cycle, ...cycle, ...cycle]);
    // 3 周目の最後で初期局面が 4 回目 → 成立。それまでは続行
    expect(results.slice(0, -1).every((r) => !r.isFinished)).toBe(true);
    const last = results[results.length - 1];
    expect(last.isFinished).toBe(true);
    expect(last.winnerIds).toEqual([]);
    expect(last.message).toContain("Sennichite");
    expect(end.positionHistory!.filter((p) => p.key === positionKey(end)).length).toBe(
      REPETITION_LIMIT,
    );
  });

  test("持ち駒が違えば同一局面ではない", () => {
    const a = position({ [I(4, 8)]: 8, [I(4, 0)]: -8 }, { hands: { 1: { 1: 1 } } });
    const b = position({ [I(4, 8)]: 8, [I(4, 0)]: -8 }, { hands: { 1: { 1: 2 } } });
    const c = position({ [I(4, 8)]: 8, [I(4, 0)]: -8 }, { hands: { 1: { 1: 1, 4: 0 } } });
    expect(positionKey(a)).not.toBe(positionKey(b));
    expect(positionKey(a)).toBe(positionKey(c)); // 0 枚の駒は無視
    expect(positionKey(a)).not.toBe(positionKey({ ...a, turn: -1 })); // 手番も含む
  });

  test("連続王手の千日手は王手をかけていた側の負け", () => {
    // 後手玉 1一。先手の飛車が 5一/5二 を往復して横から王手し続け、後手玉は 1一/1二 を往復するしかない
    // （銀 3三 が 2二 を押さえ、飛車が 2一 / 2二 のどちらかを常に押さえる）
    const state = position({ [I(8, 0)]: -8, [I(4, 1)]: 7, [I(6, 2)]: 4, [I(0, 8)]: 8 });
    const cycle: ShogiAction[] = [
      move(I(4, 1), I(4, 0)), // 王手
      move(I(8, 0), I(8, 1), false, P2),
      move(I(4, 0), I(4, 1)), // 王手
      move(I(8, 1), I(8, 0), false, P2),
    ];
    const { results } = play(state, [...cycle, ...cycle, ...cycle]);
    expect(results.slice(0, -1).every((r) => !r.isFinished)).toBe(true);
    const last = results[results.length - 1];
    expect(last.isFinished).toBe(true);
    expect(last.winnerIds).toEqual([P2]); // 王手をかけ続けた先手の負け
    expect(last.message).toContain("perpetual check");
  });

  test("エンジン経由でも千日手で FINISHED になり、記録に残る", () => {
    const engine = new UniversalEngine(ShogiRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: P1 } as any);
    engine.dispatch({ type: "JOIN", playerId: P2 } as any);
    engine.dispatch({ type: "START", playerId: P1 } as any);
    // 初期局面から飛車を往復させる（初期局面が 4 回目で成立）
    const cycle: ShogiAction[] = [
      move(I(7, 7), I(6, 7)),
      move(I(1, 1), I(2, 1), false, P2),
      move(I(6, 7), I(7, 7)),
      move(I(2, 1), I(1, 1), false, P2),
    ];
    for (const a of [...cycle, ...cycle, ...cycle]) expect(engine.dispatch(a)).toBe(true);
    const fin = engine.getState();
    expect(fin.status).toBe("FINISHED");
    expect(fin.message).toContain("Sennichite");
    expect(engine.history.length).toBe(3 + 12);
  });
});

describe("ShogiRuleset: 入玉宣言（持将棋）", () => {
  // 先手玉が 5一に入玉。敵陣に 10 枚（飛・角 + と金 8 枚 = 18 点）+ 持ち駒 で点数を組む
  const entered = (extra: Record<number, number> = {}, hands: Record<number, number> = {}) =>
    position(
      {
        [I(4, 0)]: 8, // 先手玉（敵陣）
        [I(8, 8)]: -8, // 後手玉（遠く）
        [I(0, 1)]: 7, // 飛 5 点
        [I(8, 1)]: 6, // 角 5 点
        [I(0, 2)]: 9,
        [I(1, 2)]: 9,
        [I(2, 2)]: 9,
        [I(3, 2)]: 9,
        [I(5, 2)]: 9,
        [I(6, 2)]: 9,
        [I(7, 2)]: 9,
        [I(8, 2)]: 9, // と金 8 枚 = 8 点
        ...extra,
      },
      { hands: { 1: hands } },
    );

  test("条件を満たせば宣言側の勝ち（先手 28 点）", () => {
    const state = entered({}, { 5: 4, 4: 4, 1: 2 }); // 18 + 10 = 28
    expect(evaluateDeclaration(state, 1)).toEqual({ success: true, points: 28 });
    expect(ShogiRuleset.isValidAction(state, { type: "DECLARE_WIN", playerId: P1 })).toBe(true);
    expect(ShogiRuleset.isValidAction(state, { type: "DECLARE_WIN", playerId: P2 })).toBe(false); // 手番外
    const next = ShogiRuleset.reduce(state, { type: "DECLARE_WIN", playerId: P1 });
    expect(next.status).toBe("FINISHED");
    const result = ShogiRuleset.checkWinCondition(next);
    expect(result.winnerIds).toEqual([P1]);
    expect(result.message).toContain("declaration");
  });

  test("点数不足・枚数不足・玉が敵陣外・王手中 の宣言は宣言側の負け", () => {
    const short = entered({}, { 5: 4, 4: 4, 1: 1 }); // 27 点
    expect(evaluateDeclaration(short, 1).success).toBe(false);
    expect(evaluateDeclaration(short, 1).reason).toContain("27 points");
    const next = ShogiRuleset.reduce(short, { type: "DECLARE_WIN", playerId: P1 });
    expect(ShogiRuleset.checkWinCondition(next).winnerIds).toEqual([P2]);

    const few = entered({ [I(8, 2)]: 0 }, { 5: 4, 4: 4, 1: 3 }); // 敵陣 9 枚（点数は 28）
    expect(evaluateDeclaration(few, 1).reason).toContain("9 pieces");

    const outside = entered({ [I(4, 0)]: 0, [I(4, 3)]: 8 }, { 5: 4, 4: 4, 1: 2 });
    expect(evaluateDeclaration(outside, 1).reason).toContain("not in the enemy camp");

    const checked = entered({ [I(4, 4)]: -7 }, { 5: 4, 4: 4, 1: 2 }); // 後手飛車が 5 筋から王手
    expect(evaluateDeclaration(checked, 1).reason).toContain("in check");
  });

  test("後手は 27 点で成立し、大駒は 5 点で数える", () => {
    // 後手玉 5九に入玉。敵陣（7〜9 段目）に 龍・馬（10 点）+ と金 8 枚 = 18 点、持ち駒 9 点
    const state = position(
      {
        [I(4, 8)]: -8,
        [I(0, 0)]: 8,
        [I(0, 7)]: -14,
        [I(8, 7)]: -13,
        [I(0, 6)]: -9,
        [I(1, 6)]: -9,
        [I(2, 6)]: -9,
        [I(3, 6)]: -9,
        [I(5, 6)]: -9,
        [I(6, 6)]: -9,
        [I(7, 6)]: -9,
        [I(8, 6)]: -9,
      },
      { turn: -1, hands: { "-1": { 1: 9 } } },
    );
    expect(evaluateDeclaration(state, -1)).toEqual({ success: true, points: 27 });
    expect(evaluateDeclaration({ ...state, hands: { 1: {}, "-1": { 1: 8 } } }, -1).success).toBe(
      false,
    );
  });
});

describe("ShogiRuleset: 投了", () => {
  test("投了した側の相手が勝つ（手番でなくても投了できる）", () => {
    const state = position({ [I(4, 8)]: 8, [I(4, 0)]: -8 });
    expect(ShogiRuleset.isValidAction(state, { type: "RESIGN", playerId: P2 })).toBe(true);
    expect(ShogiRuleset.isValidAction(state, { type: "RESIGN", playerId: "stranger" })).toBe(false);
    const next = ShogiRuleset.reduce(state, { type: "RESIGN", playerId: P2 });
    expect(next.status).toBe("FINISHED");
    expect(next.resignedBy).toBe(-1);
    const result = ShogiRuleset.checkWinCondition(next);
    expect(result.isFinished).toBe(true);
    expect(result.winnerIds).toEqual([P1]);
  });
});

describe("ShogiRuleset: 対局", () => {
  test("合法手だけで進めても玉が取られることはなく、記録から再現できる", () => {
    const engine = new UniversalEngine(ShogiRuleset, { clientSeed: "shogi", serverSeed: "shogi" });
    engine.dispatch({ type: "JOIN", playerId: P1 } as any);
    engine.dispatch({ type: "JOIN", playerId: P2 } as any);
    engine.dispatch({ type: "START", playerId: P1 } as any);

    let steps = 0;
    while (engine.getState().status === "PLAYING" && steps < 200) {
      const s = engine.getState();
      const pid = s.activePlayers![0];
      const legal = engine.getLegalActions(pid);
      expect(legal.length).toBeGreaterThan(0);
      // 取れる手を優先して盤面を動かす
      const capture = legal.find((a) => a.type === "MOVE" && s.board[a.to!] !== 0);
      const action = capture ?? legal[(steps * 7) % legal.length];
      expect(engine.dispatch(action)).toBe(true);
      const after = engine.getState();
      expect(after.board.includes(8)).toBe(true);
      expect(after.board.includes(-8)).toBe(true);
      // 指した側の玉に王手がかかった状態で手番を渡すことはない
      expect(isInCheck(after.board, s.turn as 1 | -1)).toBe(false);
      steps++;
    }
    expect(steps).toBeGreaterThan(50);
  });
});
