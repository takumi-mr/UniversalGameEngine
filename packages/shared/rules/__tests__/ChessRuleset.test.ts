// packages/shared/rules/__tests__/ChessRuleset.test.ts
//
// 盤の座標: index = y * 8 + x。x=0 が a ファイル、y=0 が黒の初期段（8 段目）、y=7 が白の初期段（1 段目）。
// 駒の値: 1 P 2 N 3 B 4 R 5 Q 6 K。正が白、負が黒。
import { expect, test, describe } from "bun:test";
import {
  ChessRuleset,
  PIECES,
  isInCheck,
  isInsufficientMaterial,
  positionKey,
  REPETITION_LIMIT,
  type ChessState,
  type ChessAction,
} from "@engine/shared/rules/ChessRuleset";
import { UniversalEngine } from "@engine/shared/UniversalEngine";

/** "e4" のような代数表記をインデックスに */
const sq = (name: string) => {
  const x = name.charCodeAt(0) - "a".charCodeAt(0);
  const y = 8 - Number(name[1]);
  return y * 8 + x;
};
const W = "white";
const B = "black";

function position(
  pieces: Record<string, number>,
  opts: Partial<Pick<ChessState, "turn" | "castling" | "enPassant" | "halfMoves">> = {},
): ChessState {
  const state = ChessRuleset.getInitialState();
  state.board = new Array(64).fill(0);
  for (const [name, v] of Object.entries(pieces)) state.board[sq(name)] = v;
  state.turn = opts.turn ?? 1;
  state.castling = opts.castling ?? { wK: false, wQ: false, bK: false, bQ: false };
  state.enPassant = opts.enPassant ?? null;
  state.halfMoves = opts.halfMoves ?? 0;
  state.status = "PLAYING";
  state.players = { 1: W, "-1": B };
  state.activePlayers = [state.turn === 1 ? W : B];
  state.positionHistory = [positionKey(state)];
  return state;
}

const mv = (from: string, to: string, playerId = W, promotion?: number): ChessAction => ({
  type: "MOVE",
  from: sq(from),
  to: sq(to),
  playerId,
  ...(promotion !== undefined ? { promotion } : {}),
});

const targets = (state: ChessState, from: string, playerId = W) =>
  [
    ...new Set(
      ChessRuleset.getLegalActions(state, playerId)
        .filter((a) => a.from === sq(from))
        .map((a) => a.to!),
    ),
  ].sort((a, b) => a - b);
const squares = (...names: string[]) => names.map(sq).sort((a, b) => a - b);

function startedEngine(seed = "chess") {
  const engine = new UniversalEngine<ChessState, ChessAction>(ChessRuleset, {
    clientSeed: seed,
    serverSeed: seed,
  });
  engine.dispatch({ type: "JOIN", playerId: W } as any);
  engine.dispatch({ type: "JOIN", playerId: B } as any);
  engine.dispatch({ type: "START", playerId: W } as any);
  return engine;
}

describe("ChessRuleset: 初期配置と駒の動き", () => {
  test("初期配置と白の 20 手", () => {
    const engine = startedEngine();
    const s = engine.getState();
    expect(s.board.slice(0, 8)).toEqual([-4, -2, -3, -5, -6, -3, -2, -4]);
    expect(s.board.slice(56)).toEqual([4, 2, 3, 5, 6, 3, 2, 4]);
    expect(s.board[sq("e1")]).toBe(PIECES.K);
    expect(s.board[sq("d1")]).toBe(PIECES.Q);
    expect(s.castling).toEqual({ wK: true, wQ: true, bK: true, bQ: true });
    expect(engine.getLegalActions(W).length).toBe(20);
    expect(engine.getLegalActions(B)).toEqual([]);
  });

  test("ナイト・ビショップ・ルーク・クイーン・キングの利き（味方に遮られ、敵は取れる）", () => {
    const state = position({
      e4: PIECES.N,
      e1: PIECES.K,
      e8: -PIECES.K,
      d6: PIECES.P,
      f6: -PIECES.P,
    });
    expect(targets(state, "e4")).toEqual(squares("c3", "c5", "d2", "f2", "g3", "g5", "f6"));

    const bishop = position({
      c1: PIECES.B,
      e1: PIECES.K,
      e8: -PIECES.K,
      e3: PIECES.P,
      a3: -PIECES.P,
    });
    expect(targets(bishop, "c1")).toEqual(squares("b2", "a3", "d2"));

    const rook = position({ a1: PIECES.R, e1: PIECES.K, e8: -PIECES.K, a5: -PIECES.P });
    expect(targets(rook, "a1")).toEqual(squares("a2", "a3", "a4", "a5", "b1", "c1", "d1"));

    const queen = position({ d4: PIECES.Q, h1: PIECES.K, h8: -PIECES.K });
    expect(targets(queen, "d4").length).toBe(27);

    const king = position({ e4: PIECES.K, e8: -PIECES.K, e6: -PIECES.R });
    // e ファイルは黒ルークの利き（e5, e3 は不可）。d/f ファイルは可
    expect(targets(king, "e4")).toEqual(squares("d3", "d4", "d5", "f3", "f4", "f5"));
  });

  test("ポーン: 前進・初手 2 歩・遮られたら進めない・斜めだけ取れる", () => {
    const state = position({
      e2: PIECES.P,
      d2: PIECES.P,
      d3: -PIECES.P,
      c2: PIECES.P,
      c4: -PIECES.P,
      b2: PIECES.P,
      a3: -PIECES.P,
      c3: -PIECES.N,
      e1: PIECES.K,
      e8: -PIECES.K,
    });
    expect(targets(state, "e2")).toEqual(squares("e3", "e4", "d3")); // d3 の黒ポーンも取れる
    expect(targets(state, "d2")).toEqual(squares("c3")); // 目の前に駒、斜めの c3 は取れる
    expect(targets(state, "c2")).toEqual(squares("d3")); // c3 は味方でなく敵ナイトだが前進では取れない
    expect(targets(state, "b2")).toEqual(squares("b3", "b4", "a3", "c3"));
  });

  test("黒のポーンは下へ進む", () => {
    const state = position({ e7: -PIECES.P, e1: PIECES.K, e8: -PIECES.K }, { turn: -1 });
    expect(targets(state, "e7", B)).toEqual(squares("e6", "e5"));
  });

  test("手番でない側・相手の駒・座標なしは不正", () => {
    const engine = startedEngine();
    const s = engine.getState();
    expect(ChessRuleset.isValidAction(s, mv("e2", "e4", B))).toBe(false);
    expect(ChessRuleset.isValidAction(s, mv("e7", "e5", W))).toBe(false);
    expect(ChessRuleset.isValidAction(s, { type: "MOVE", playerId: W })).toBe(false);
    expect(engine.dispatch(mv("e2", "e4"))).toBe(true);
    expect(engine.getState().activePlayers).toEqual([B]);
    expect(engine.getState().fullMoves).toBe(1);
    expect(engine.dispatch(mv("e7", "e5", B))).toBe(true);
    expect(engine.getState().fullMoves).toBe(2);
  });
});

describe("ChessRuleset: アンパッサン", () => {
  test("2 歩進んだ直後だけ取れ、取られたポーンが消える", () => {
    const state = position(
      { e5: PIECES.P, d7: -PIECES.P, f7: -PIECES.P, e1: PIECES.K, e8: -PIECES.K },
      { turn: -1 },
    );
    const afterDouble = ChessRuleset.reduce(state, mv("d7", "d5", B));
    expect(afterDouble.enPassant).toBe(sq("d6"));
    expect(targets(afterDouble, "e5")).toEqual(squares("e6", "d6"));

    const captured = ChessRuleset.reduce(afterDouble, mv("e5", "d6"));
    expect(captured.board[sq("d6")]).toBe(PIECES.P);
    expect(captured.board[sq("d5")]).toBe(0); // 取られた
    expect(captured.enPassant).toBeNull();
    expect(captured.halfMoves).toBe(0);

    // 一手待つと権利が消える
    const waited = ChessRuleset.reduce(afterDouble, mv("e1", "d1"));
    const black = ChessRuleset.reduce(waited, mv("f7", "f6", B));
    expect(black.enPassant).toBeNull();
    expect(targets(black, "e5")).toEqual(squares("e6", "f6"));
  });
});

describe("ChessRuleset: キャスリング", () => {
  const base = { e1: PIECES.K, h1: PIECES.R, a1: PIECES.R, e8: -PIECES.K };
  const rights = { wK: true, wQ: true, bK: false, bQ: false };

  test("両サイドにキャスリングでき、ルークも動く", () => {
    const state = position(base, { castling: rights });
    expect(targets(state, "e1")).toEqual(squares("d1", "d2", "e2", "f1", "f2", "c1", "g1"));
    const k = ChessRuleset.reduce(state, mv("e1", "g1"));
    expect(k.board[sq("g1")]).toBe(PIECES.K);
    expect(k.board[sq("f1")]).toBe(PIECES.R);
    expect(k.board[sq("h1")]).toBe(0);
    expect(k.castling.wK).toBe(false);
    expect(k.castling.wQ).toBe(false);
    const q = ChessRuleset.reduce(state, mv("e1", "c1"));
    expect(q.board[sq("c1")]).toBe(PIECES.K);
    expect(q.board[sq("d1")]).toBe(PIECES.R);
    expect(q.board[sq("a1")]).toBe(0);
  });

  test("間に駒がある・通過マスや現在地が攻撃されている・権利がない ときはできない", () => {
    expect(targets(position({ ...base, f1: PIECES.B }, { castling: rights }), "e1")).not.toContain(
      sq("g1"),
    );
    expect(targets(position({ ...base, b1: PIECES.N }, { castling: rights }), "e1")).not.toContain(
      sq("c1"),
    );
    // f1 が黒ルークに攻撃されている → キングサイド不可。b1 が攻撃されていてもクイーンサイドは可
    const attackedF = position({ ...base, f8: -PIECES.R }, { castling: rights });
    expect(targets(attackedF, "e1")).not.toContain(sq("g1"));
    const attackedB = position({ ...base, b8: -PIECES.R }, { castling: rights });
    expect(targets(attackedB, "e1")).toContain(sq("c1"));
    // チェック中は不可
    const inCheck = position({ ...base, e7: -PIECES.R }, { castling: rights });
    expect(targets(inCheck, "e1")).not.toContain(sq("g1"));
    expect(targets(inCheck, "e1")).not.toContain(sq("c1"));
    // 権利なし
    expect(targets(position(base), "e1")).toEqual(squares("d1", "d2", "e2", "f1", "f2"));
  });

  test("キングやルークが動く／ルークが取られると権利を失う", () => {
    const state = position({ ...base, h8: -PIECES.R }, { castling: rights });
    expect(ChessRuleset.reduce(state, mv("h1", "h2")).castling).toEqual({ ...rights, wK: false });
    expect(ChessRuleset.reduce(state, mv("a1", "a2")).castling).toEqual({ ...rights, wQ: false });
    expect(ChessRuleset.reduce(state, mv("e1", "e2")).castling).toEqual({
      ...rights,
      wK: false,
      wQ: false,
    });
    const black = { ...state, turn: -1 as const };
    expect(ChessRuleset.reduce(black, mv("h8", "h1", B)).castling.wK).toBe(false);
  });
});

describe("ChessRuleset: プロモーション", () => {
  test("最終段に到達するポーンは昇格先の指定が必須で、N/B/R/Q だけ選べる", () => {
    const state = position({ b7: PIECES.P, e1: PIECES.K, e8: -PIECES.K, a8: -PIECES.R });
    expect(ChessRuleset.isValidAction(state, mv("b7", "b8"))).toBe(false);
    expect(ChessRuleset.isValidAction(state, mv("b7", "b8", W, PIECES.K))).toBe(false);
    expect(ChessRuleset.isValidAction(state, mv("b7", "b8", W, PIECES.P))).toBe(false);
    expect(ChessRuleset.isValidAction(state, mv("b7", "b8", W, PIECES.Q))).toBe(true);
    expect(ChessRuleset.isValidAction(state, mv("b7", "a8", W, PIECES.N))).toBe(true); // 取りながら昇格
    const promos = ChessRuleset.getLegalActions(state, W).filter((a) => a.from === sq("b7"));
    expect(promos.length).toBe(8); // b8 / a8 × 4 種
    expect(new Set(promos.map((a) => a.promotion))).toEqual(new Set([2, 3, 4, 5]));
    const next = ChessRuleset.reduce(state, mv("b7", "a8", W, PIECES.N));
    expect(next.board[sq("a8")]).toBe(PIECES.N);
    expect(next.board[sq("b7")]).toBe(0);
  });

  test("黒の昇格は 1 段目", () => {
    const state = position({ g2: -PIECES.P, e1: PIECES.K, e8: -PIECES.K }, { turn: -1 });
    const next = ChessRuleset.reduce(state, mv("g2", "g1", B, PIECES.Q));
    expect(next.board[sq("g1")]).toBe(-PIECES.Q);
  });
});

describe("ChessRuleset: チェック・メイト・ステイルメイト", () => {
  test("チェック中は回避する手しか指せず、ピンされた駒は動かせない", () => {
    // 黒ルークが e ファイルから白キングにチェック。白は d2 のナイトで合駒 or キング退避
    const state = position({
      e1: PIECES.K,
      e8: -PIECES.K,
      e7: -PIECES.R,
      c3: PIECES.N,
      a2: PIECES.P,
      b1: PIECES.B,
    });
    expect(isInCheck(state.board, 1)).toBe(true);
    expect(ChessRuleset.isValidAction(state, mv("a2", "a3"))).toBe(false);
    expect(ChessRuleset.isValidAction(state, mv("c3", "e2"))).toBe(true); // 合駒
    expect(ChessRuleset.isValidAction(state, mv("e1", "e2"))).toBe(false); // ルークの筋
    expect(ChessRuleset.isValidAction(state, mv("e1", "d1"))).toBe(true);
    for (const a of ChessRuleset.getLegalActions(state, W)) {
      expect(isInCheck(ChessRuleset.reduce(state, a).board, 1)).toBe(false);
    }

    const pinned = position({ e1: PIECES.K, e8: -PIECES.K, e7: -PIECES.R, e3: PIECES.B });
    expect(ChessRuleset.isValidAction(pinned, mv("e3", "d4"))).toBe(false);
    expect(ChessRuleset.isValidAction(pinned, mv("e3", "d2"))).toBe(false);
  });

  test("フールズメイト: 1.f3 e5 2.g4 Qh4# でチェックメイト", () => {
    const engine = startedEngine();
    for (const a of [mv("f2", "f3"), mv("e7", "e5", B), mv("g2", "g4"), mv("d8", "h4", B)]) {
      expect(engine.dispatch(a)).toBe(true);
    }
    const s = engine.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.message).toContain("Checkmate");
    expect(ChessRuleset.checkWinCondition(s).winnerIds).toEqual([B]);
    expect(engine.getLegalActions(W)).toEqual([]);
  });

  test("ステイルメイトは引き分け", () => {
    const state = position({ h8: -PIECES.K, f7: PIECES.K, g6: PIECES.Q }, { turn: -1 });
    expect(isInCheck(state.board, -1)).toBe(false);
    expect(ChessRuleset.getLegalActions(state, B)).toEqual([]);
    const result = ChessRuleset.checkWinCondition(state);
    expect(result.isFinished).toBe(true);
    expect(result.winnerIds).toEqual([]);
    expect(result.message).toContain("Stalemate");
  });
});

describe("ChessRuleset: 引き分け規定と投了", () => {
  test("50 手ルール（ポーンの移動と捕獲でリセット）", () => {
    const state = position(
      { e1: PIECES.K, e8: -PIECES.K, a1: PIECES.R, a8: -PIECES.R, h2: PIECES.P },
      { halfMoves: 99 },
    );
    const rookMove = ChessRuleset.reduce(state, mv("a1", "b1"));
    expect(rookMove.halfMoves).toBe(100);
    expect(ChessRuleset.checkWinCondition(rookMove)).toMatchObject({
      isFinished: true,
      winnerIds: [],
    });
    const pawnMove = ChessRuleset.reduce(state, mv("h2", "h3"));
    expect(pawnMove.halfMoves).toBe(0);
    expect(ChessRuleset.checkWinCondition(pawnMove).isFinished).toBe(false);
  });

  test("三回同形は引き分け（ナイトの往復で初期局面が 3 回）", () => {
    const engine = startedEngine();
    const cycle = [mv("g1", "f3"), mv("g8", "f6", B), mv("f3", "g1"), mv("f6", "g8", B)];
    for (const a of cycle) expect(engine.dispatch(a)).toBe(true);
    expect(engine.getState().status).toBe("PLAYING"); // 2 回目
    for (const a of cycle) expect(engine.dispatch(a)).toBe(true);
    const s = engine.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.message).toContain("repetition");
    expect(s.positionHistory!.filter((k) => k === positionKey(s)).length).toBe(REPETITION_LIMIT);
  });

  test("キャスリング権やアンパッサンが違えば別の局面", () => {
    const a = position(
      { e1: PIECES.K, h1: PIECES.R, e8: -PIECES.K },
      { castling: { wK: true, wQ: false, bK: false, bQ: false } },
    );
    const b = position({ e1: PIECES.K, h1: PIECES.R, e8: -PIECES.K });
    expect(positionKey(a)).not.toBe(positionKey(b));
    expect(positionKey({ ...b, enPassant: sq("d6") })).not.toBe(positionKey(b));
    expect(positionKey({ ...b, turn: -1 })).not.toBe(positionKey(b));
  });

  test("メイトできない駒構成は引き分け", () => {
    expect(isInsufficientMaterial(position({ e1: PIECES.K, e8: -PIECES.K }).board)).toBe(true);
    expect(
      isInsufficientMaterial(position({ e1: PIECES.K, e8: -PIECES.K, c1: PIECES.B }).board),
    ).toBe(true);
    expect(
      isInsufficientMaterial(position({ e1: PIECES.K, e8: -PIECES.K, b1: -PIECES.N }).board),
    ).toBe(true);
    // 同色マスのビショップ同士（c1 と f8 はどちらも黒マス）
    expect(
      isInsufficientMaterial(
        position({ e1: PIECES.K, e8: -PIECES.K, c1: PIECES.B, f8: -PIECES.B }).board,
      ),
    ).toBe(true);
    // 異色マスのビショップ / ルーク / ポーン / ナイト 2 枚 は続行
    expect(
      isInsufficientMaterial(
        position({ e1: PIECES.K, e8: -PIECES.K, c1: PIECES.B, c8: -PIECES.B }).board,
      ),
    ).toBe(false);
    expect(
      isInsufficientMaterial(position({ e1: PIECES.K, e8: -PIECES.K, a1: PIECES.R }).board),
    ).toBe(false);
    expect(
      isInsufficientMaterial(position({ e1: PIECES.K, e8: -PIECES.K, a2: PIECES.P }).board),
    ).toBe(false);
    expect(
      isInsufficientMaterial(
        position({ e1: PIECES.K, e8: -PIECES.K, b1: PIECES.N, g1: PIECES.N }).board,
      ),
    ).toBe(false);

    const state = position({ e1: PIECES.K, e8: -PIECES.K, c1: PIECES.B });
    const result = ChessRuleset.checkWinCondition(state);
    expect(result).toMatchObject({ isFinished: true, winnerIds: [] });
    expect(result.message).toContain("insufficient material");
  });

  test("投了は相手の勝ち（手番でなくても可、部外者は不可）", () => {
    const engine = startedEngine();
    expect(engine.dispatch({ type: "RESIGN", playerId: "someone" })).toBe(false);
    expect(engine.dispatch({ type: "RESIGN", playerId: B })).toBe(true);
    const s = engine.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.resignedBy).toBe(-1);
    expect(ChessRuleset.checkWinCondition(s).winnerIds).toEqual([W]);
  });
});

describe("ChessRuleset: 対局", () => {
  test("合法手だけで進めてもキングが取られず、自玉にチェックを残す手は出ない", () => {
    const engine = startedEngine("walk");
    let steps = 0;
    while (engine.getState().status === "PLAYING" && steps < 150) {
      const s = engine.getState();
      const pid = s.activePlayers![0];
      const legal = engine.getLegalActions(pid);
      expect(legal.length).toBeGreaterThan(0);
      for (const a of legal) expect(ChessRuleset.isValidAction(s, a)).toBe(true);
      const capture = legal.find((a) => s.board[a.to!] !== 0);
      const action = capture ?? legal[(steps * 5) % legal.length];
      expect(engine.dispatch(action)).toBe(true);
      const after = engine.getState();
      expect(after.board.includes(PIECES.K)).toBe(true);
      expect(after.board.includes(-PIECES.K)).toBe(true);
      expect(isInCheck(after.board, s.turn)).toBe(false);
      steps++;
    }
    expect(steps).toBeGreaterThan(20);
  });
});
