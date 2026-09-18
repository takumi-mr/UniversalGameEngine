import { expect, test, describe } from "bun:test";
import { RubiksRuleset } from "@engine/shared/rules/RubicCubeRuleset";
import type { RubiksState, FaceName, Color } from "@engine/shared/rules/RubicCubeRuleset";

// --- 幾何モデル ---
// 各面を「外側から見た」ときに row 0 が上、col 0 が左になる展開図の規約。
//   U: 上から見て上側が B、D: 下から見て上側が F
//   F/B/L/R: 上側が U
// 座標系: U=+y, D=-y, F=+z, B=-z, R=+x, L=-x
const FACES: FaceName[] = ["U", "D", "F", "B", "L", "R"];

type Vec = [number, number, number];

const FACE_NORMAL: Record<FaceName, Vec> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
};

// (face, row, col) -> ステッカーの中心座標（±1.5 の面上）
function stickerPos(face: FaceName, r: number, c: number): Vec {
  switch (face) {
    case "U":
      return [-1 + c, 1.5, -1 + r];
    case "D":
      return [-1 + c, -1.5, 1 - r];
    case "F":
      return [-1 + c, 1 - r, 1.5];
    case "B":
      return [1 - c, 1 - r, -1.5];
    case "R":
      return [1.5, 1 - r, 1 - c];
    case "L":
      return [-1.5, 1 - r, -1 + c];
  }
}

// 面を外側から見て時計回りに 90° 回す回転（法線 n の周りに -90°）
function rotateCW(n: Vec, v: Vec): Vec {
  const [x, y, z] = v;
  if (n[1] === 1) return [-z, y, x]; // U
  if (n[1] === -1) return [z, y, -x]; // D
  if (n[2] === 1) return [y, -x, z]; // F
  if (n[2] === -1) return [-y, x, z]; // B
  if (n[0] === 1) return [x, z, -y]; // R
  return [x, -z, y]; // L
}

function key(v: Vec): string {
  return v.map((x) => Math.round(x * 2) / 2).join(",");
}

// 全ステッカーに一意のラベルを付けた状態
function labeledState(): RubiksState {
  const state = RubiksRuleset.getInitialState();
  for (const f of FACES) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        state.faces[f][r][c] = `${f}${r}${c}` as Color;
      }
    }
  }
  return state;
}

// 幾何的に正しい回転結果を計算する
function expectedAfterRotate(state: RubiksState, face: FaceName, direction: 1 | -1) {
  const n = FACE_NORMAL[face];
  const inLayer = (p: Vec) => p[0] * n[0] + p[1] * n[1] + p[2] * n[2] >= 0.5;

  // 位置 -> 現在のラベル
  const byPos = new Map<string, string>();
  for (const f of FACES) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let p = stickerPos(f, r, c);
        if (inLayer(p)) {
          const times = direction === 1 ? 1 : 3;
          for (let i = 0; i < times; i++) p = rotateCW(n, p);
        }
        byPos.set(key(p), state.faces[f][r][c]);
      }
    }
  }

  const result = {} as Record<FaceName, Color[][]>;
  for (const f of FACES) {
    result[f] = Array.from({ length: 3 }, (_, r) =>
      Array.from({ length: 3 }, (_, c) => byPos.get(key(stickerPos(f, r, c))) as Color),
    );
  }
  return result;
}

describe("RubiksRuleset", () => {
  test("getInitialState is solved", () => {
    const state = RubiksRuleset.getInitialState();
    expect(RubiksRuleset.checkWinCondition(state).isFinished).toBe(false);
    for (const f of FACES) {
      expect(state.faces[f].flat().every((c) => c === state.faces[f][0][0])).toBe(true);
    }
  });

  for (const face of FACES) {
    for (const direction of [1, -1] as const) {
      test(`ROTATE ${face} ${direction === 1 ? "CW" : "CCW"} matches 3D geometry`, () => {
        const state = labeledState();
        const next = RubiksRuleset.reduce(state, { type: "ROTATE", face, direction });
        expect(next.faces).toEqual(expectedAfterRotate(state, face, direction));
      });
    }
  }

  test("CW followed by CCW restores the state", () => {
    for (const face of FACES) {
      const state = labeledState();
      const a = RubiksRuleset.reduce(state, { type: "ROTATE", face, direction: 1 });
      const b = RubiksRuleset.reduce(a, { type: "ROTATE", face, direction: -1 });
      expect(b.faces).toEqual(state.faces);
    }
  });

  test("(R U R' U') x6 is identity", () => {
    let state = labeledState();
    const start = structuredClone(state.faces);
    for (let i = 0; i < 6; i++) {
      state = RubiksRuleset.reduce(state, { type: "ROTATE", face: "R", direction: 1 });
      state = RubiksRuleset.reduce(state, { type: "ROTATE", face: "U", direction: 1 });
      state = RubiksRuleset.reduce(state, { type: "ROTATE", face: "R", direction: -1 });
      state = RubiksRuleset.reduce(state, { type: "ROTATE", face: "U", direction: -1 });
    }
    expect(state.faces).toEqual(start);
  });

  test("solving after a scramble finishes the game", () => {
    const moves: { face: FaceName; direction: 1 | -1 }[] = [
      { face: "F", direction: 1 },
      { face: "U", direction: -1 },
      { face: "L", direction: 1 },
      { face: "D", direction: 1 },
      { face: "B", direction: -1 },
    ];
    let state = RubiksRuleset.getInitialState();
    for (const m of moves) state = RubiksRuleset.reduce(state, { type: "ROTATE", ...m });
    expect(RubiksRuleset.checkWinCondition(state).isFinished).toBe(false);
    for (const m of [...moves].reverse()) {
      state = RubiksRuleset.reduce(state, {
        type: "ROTATE",
        face: m.face,
        direction: m.direction === 1 ? -1 : 1,
      });
    }
    expect(RubiksRuleset.checkWinCondition(state).isFinished).toBe(true);
  });
});
