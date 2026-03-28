import type { IAITensorAdapter } from "../IAITensorAdapter";
import type { OthelloState, OthelloAction, PlayerColor } from "../../rules/OthelloRuleset";
import { OthelloRuleset } from "../../rules/OthelloRuleset";

export class OthelloTensorAdapter implements IAITensorAdapter<OthelloState, OthelloAction> {
  // 1. 盤面を128次元のテンソルに変換
  encodeState(state: OthelloState, playerId: string): number[] {
    const tensor = new Array(128).fill(0.0);
    const size = state.size || 8;

    // playerIdから、自分が黒(1)か白(-1)かを判定する
    let myColor: PlayerColor | null = null;
    if (state.players[1] === playerId) myColor = 1;
    else if (state.players[-1] === playerId) myColor = -1;

    // まだ席に座っていない（観戦者など）場合は、仮に黒目線で出力する
    if (myColor === null) myColor = 1;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cell = state.board[y][x];
        const idx = y * size + x;

        if (cell === myColor) {
          tensor[idx] = 1.0; // 自分の石
        } else if (cell !== 0 && cell === myColor * -1) {
          tensor[64 + idx] = 1.0; // 相手の石
        }
      }
    }

    return tensor;
  }

  // 2. 合法手をインデックス番号(0~63、パスは64)の配列に変換
  encodeLegalActions(state: OthelloState, playerId: string): number[] {
    // Rulesetの関数を使って、現在のプレイヤーの全合法手を取得
    const actions = OthelloRuleset.getLegalActions(state, playerId);

    // 合法手がない（パスの）場合
    if (actions.length === 0) {
      // 実際にはRuleset側でパス処理が自動で行われますが、
      // AI側のGym環境に「手番がない」ことを伝えるために 64(パス) を返します
      return [64];
    }

    // 存在する合法手のアクションを、1次元のインデックスに変換
    return actions.map((action) => action.y * (state.size || 8) + action.x);
  }

  // 3. AIが出したインデックスを OthelloAction に復元
  decodeAction(state: OthelloState, actionId: number, playerId: string): OthelloAction {
    const size = state.size || 8;

    let myColor: PlayerColor = 1;
    if (state.players[1] === playerId) myColor = 1;
    else if (state.players[-1] === playerId) myColor = -1;

    // パスの場合（本来は送られてきませんが、念のためダミーアクションを返します）
    if (actionId === 64) {
      return {
        type: "PLACE_PIECE",
        color: myColor,
        x: -1, // ルールセットで弾かれる無効な座標
        y: -1,
        playerId: playerId,
      };
    }

    const x = actionId % size;
    const y = Math.floor(actionId / size);

    return {
      type: "PLACE_PIECE",
      color: myColor,
      x: x,
      y: y,
      playerId: playerId,
    };
  }
}
