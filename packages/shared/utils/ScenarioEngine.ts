// packages/shared/utils/ScenarioEngine.ts

export type ScenarioNode =
  | { type: "text"; speaker?: string; text: string; next?: string }
  | {
      type: "choice";
      text?: string;
      choices: { text: string; next: string; actions?: ScenarioAction[] }[];
    }
  | { type: "condition"; if: string; then: string; else: string }
  | { type: "end"; message?: string };

export type ScenarioAction =
  | { type: "set"; flag: string; value: any }
  | { type: "add"; flag: string; value: number };

/**
 * ノベルゲームのシナリオ進行を管理するユーティリティ
 */
export class ScenarioEngine {
  constructor(private scenario: Record<string, ScenarioNode>) {}

  /**
   * 現在のノードとアクションに基づいて次のノードとフラグの状態を計算する
   */
  public step(
    currentNodeId: string,
    actionValue: string | null,
    flags: Record<string, any>,
  ): {
    nextNodeId: string;
    nextFlags: Record<string, any>;
    isFinished: boolean;
  } {
    const node = this.scenario[currentNodeId];
    if (!node || node.type === "end") {
      return { nextNodeId: currentNodeId, nextFlags: flags, isFinished: true };
    }

    let nextId = currentNodeId;
    const nextFlags = { ...flags };

    if (node.type === "text") {
      nextId = node.next || "end";
    } else if (node.type === "choice" && actionValue) {
      const choice = node.choices.find((c) => c.text === actionValue);
      if (choice) {
        nextId = choice.next;
        if (choice.actions) {
          for (const a of choice.actions) {
            this.applyAction(nextFlags, a);
          }
        }
      }
    } else if (node.type === "condition") {
      // 簡易的な条件評価 (JavaScriptの式として評価)
      // セキュリティ上の懸念がある場合は、サンドボックス化された評価器を使用することを推奨
      const result = this.evaluateCondition(node.if, nextFlags);
      nextId = result ? node.then : node.else;
      // 条件ノードは通過点なので、再帰的に次の非条件ノードへ進む
      return this.step(nextId, null, nextFlags);
    }

    // 次のノードが条件ノードの場合も自動で進める
    const nextNode = this.scenario[nextId];
    if (nextNode && nextNode.type === "condition") {
      return this.step(nextId, null, nextFlags);
    }

    return {
      nextNodeId: nextId,
      nextFlags,
      isFinished: nextId === "end" || this.scenario[nextId]?.type === "end",
    };
  }

  private applyAction(flags: Record<string, any>, action: ScenarioAction) {
    switch (action.type) {
      case "set":
        flags[action.flag] = action.value;
        break;
      case "add":
        flags[action.flag] = (flags[action.flag] || 0) + action.value;
        break;
    }
  }

  private evaluateCondition(condition: string, flags: Record<string, any>): boolean {
    try {
      // フラグをスコープに入れて評価
      // keyが英数字のみであることを前提とした簡易的な実装
      const fn = new Function(...Object.keys(flags), `return ${condition}`);
      return !!fn(...Object.values(flags));
    } catch (e) {
      console.error("Condition evaluation error:", e, condition);
      return false;
    }
  }

  public getNode(id: string): ScenarioNode | undefined {
    return this.scenario[id];
  }
}
