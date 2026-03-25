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

---

## ⚖️ ルールの完全決定論的制約 (Strict Determinism)

`UniversalGameEngine` では、リプレイ機能、クライアントでの予測フェーズ、AIシミュレーション（MCTSなど）を正しく動作させるために、**ゲームルールは完全決定論的（Strictly Deterministic）であること**が不可欠な条件となります。

同じ初期シード（構成）と、同じアクション履歴を与えられた場合、エンジンは**常に100%同じ状態（ハッシュ）**を再現できなければなりません。

### 🚨 禁止事項 (Prohibited Actions)

`getInitialState` や `reduce` をはじめとするルールセット内の純粋関数において、以下の使用は**厳禁**です。これらを使用すると、実行環境やタイミングによって異なる状態が生成され、リプレイ同期や不正検知のためのハッシュ検証が崩壊します。

- `Math.random()` の使用
- `Date.now()` や `new Date()` など、現在時刻に依存するロジック
- `Math.random()`等に依存したランダムなID生成（UUID等）
- 外部API通信、DBアクセス、ファイルアクセスなどの副作用（Side Effects）
- （JavaScript特有）`Set` や `Map` のイテレーション順序に強く依存したロジックの実装

### 🎲 乱数の正しい扱い方 (RNG Injection)

カードのシャッフルやダイスロールなど、ゲームにランダム性が必要な場合は、引数として渡される `rng: IGameRNG` インターフェースを必ず使用してください。

```ts
reduce: (state, action, rng) => {
  if (action.type === "ROLL_DICE") {
    // ❌ 悪い例（リプレイ時に再現できなくなる）
    // const dice = Math.floor(Math.random() * 6) + 1;

    // ⭕ 良い例（注入された決定論的RNGを使う）
    // エンジンが内部でSeedに基づくProvablyFairRNGを渡します
    const dice = rng ? rng.nextInt(1, 6) : 1;

    return { ...state, diceResult: dice };
  }
  return state;
};
```

※ゲームの進行中、エンジンはクライアントシード・サーバーシードから初期化された `ProvablyFairRNG` インスタンスを `reduce` 関数に注入し、一貫した乱数シーケンスを提供します。

### 🧪 決定論的テスト (Testing Determinism)

実装したルールセットがこの完全決定論の要件を満たしているか確認するために専用の `assertDeterministic` テストユーティリティが用意されています。

このユーティリティは、同じシードを設定した2つの独立したエンジンインスタンスを立ち上げ、並行して合法手（Legal Actions）を自動で処理しながら、毎ステップで以下の項目が「完全に一致するか」を極限までテストします。

1. **State:** 完全等価性
2. **Hash:** 状態ハッシュの一致
3. **Masked State:** 観測者ごとの秘匿情報マスク結果の一致
4. **Legal Actions:** プレイ可能な手のリストの一致
5. **Pure Reduce:** RNGインスタンスを分離した状態での `reduce` 関数の純粋性確保

**テストの組み込み例:**

```ts
import { assertDeterministic } from "../../testing/assertDeterministic";

test("My Ruleset is strictly deterministic", () => {
  assertDeterministic({
    rules: myRuleset,
    options: {
      clientSeed: "fixed-seed-A",
      serverSeed: "fixed-seed-B",
    },
    playerIds: ["player-1", "player-2"],
    maxSteps: 50, // 最大50手まで自動計算して検証
  });
});
```

> [!IMPORTANT]
> **マージ条件**
> `gameRegistry` に登録されるすべての公式ゲームルールは、`__tests__/determinism.test.ts` において自動的にこの決定論テストの対象となります。
> **この決定論テストを通過しないゲームルール（非決定論的な挙動を含むコード）は、リポジトリへのマージが許可されません。**
> 独自のルールを実装し、PRを作成する前には、必ずこのテストを完全にクリアできることを確認してください。
