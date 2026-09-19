import type { BaseGameAction, BaseGameState } from "@engine/shared/GameRules";

/** ReplayViewer の表示ステップが変わったときの通知（効果音など、スロットの外で状態の変化を追いたい親向け） */
export interface ReplayStepEvent {
  step: number;
  prevStep: number;
  state: BaseGameState;
  /** このステップへ進めたアクション（step 0 なら null） */
  action: BaseGameAction | null;
}
