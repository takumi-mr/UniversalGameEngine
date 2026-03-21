# Game Rules Implementation Guide

`UniversalGameEngine` において、拡張性が高くメンテナンスしやすいゲームルール（Ruleset）を実装するためのベストプラクティスとガイドラインです。

---

## 🛠 ベストプラクティス

### 1. Action Dispatcher Pattern (脱・巨大 switch)

`reduce` 関数内で巨大な `switch` 文を書くのではなく、アクションタイプごとにハンドラー関数を分離します。

```ts
const ACTION_MAP = {
  MOVE: handleMove,
  ATTACK: handleAttack,
};
```

### 2. Phase-Based Logic

ゲームの進行状態（例：`AUCTION`, `MAIN_GAME`, `ROUND_END`）ごとに Reducer やバリデーションを分割することで、複雑な状態遷移を整理できます。

### 3. Atomic State Mutators

状態の深い階層を更新する処理をユーティリティ化し、バグの混入を防ぎます。

---

## 🔒 秘匿情報の管理 (Confidential Information)

対戦ゲームにおいて「自分だけに見える手札」や「山札の内容」などの秘匿情報を扱う場合、`Secret<T>` 型と `createSecret` ユーティリティを使用します。

### `createSecret` の使い方

エンジンは `Secret` 型を見つけると、`visibleTo` に指定されたプレイヤー以外に対して自動的にデータをマスク（デフォルトでは `"?"` に置換）します。

```ts
import { createSecret } from "../GameRules";

// 初期状態の定義例
const state = {
  // プレイヤー1にだけ見える秘密
  handP1: createSecret(["CardA", "CardB"], ["player1"]),

  // 全員に見せたくない山札（空の配列を指定すれば、誰にも見えない）
  deck: createSecret(deckCards, []),

  // マスク時の値を指定する場合（例：枚数だけ見せたい）
  handP2: createSecret(["CardC"], ["player2"], ["?"]),
};
```

**メリット**:

- `maskState` を手動で書く必要がなくなります。
- データの定義箇所に閲覧権限が記述されるため、仕様の把握が容易です。

### 動的な公開範囲の変更 (Peek / Reveal)

ゲーム中に「相手の手札を覗く（Peek）」や「全員にカードを公開する（Reveal）」といった処理を行う場合、`visibleTo` 配列を更新するだけで実現できます。

```ts
reduce: (state, action) => {
  switch (action.type) {
    case "PEEK_HAND":
      // 自分の手札に加え、ターゲットプレイヤーの手札の公開範囲に自分を追加する
      const targetId = action.targetPlayerId;
      return {
        ...state,
        hands: {
          ...state.hands,
          [targetId]: {
            ...state.hands[targetId],
            visibleTo: [...state.hands[targetId].visibleTo, action.playerId],
          },
        },
      };

    case "REVEAL_ALL":
      // 全員に公開するには '*' を追加する
      return {
        ...state,
        hands: {
          ...state.hands,
          player1: { ...state.hands["player1"], visibleTo: ["*"] },
        },
      };
  }
};
```

---

## 📝 モジュール化されたルール実装例

```ts
import { BaseGameState, BaseGameAction, GameRuleset, createSecret, Secret } from "../GameRules";

// --- Types ---
export interface MyState extends BaseGameState {
  phase: "PRE" | "MAIN";
  // 秘匿情報として定義
  hands: Record<string, Secret<string[]>>;
}

export type MyAction =
  | { type: "DRAW"; playerId: string }
  | { type: "PLAY"; playerId: string; card: string };

// --- Ruleset Implementation ---

export const MyModularRuleset: GameRuleset<MyState, MyAction> = {
  getInitialState: (options) => ({
    status: "WAITING",
    version: 0,
    phase: "PRE",
    hands: {
      player1: createSecret([], ["player1"]),
      player2: createSecret([], ["player2"]),
    },
  }),

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;
    return true;
  },

  reduce: (state, action) => {
    switch (action.type) {
      case "DRAW":
        // ... ドローロジック ...
        return state;
      default:
        return state;
    }
  },

  checkWinCondition: (state) => ({ isFinished: false }),
  getLegalActions: (state, playerId) => [],
};
```
