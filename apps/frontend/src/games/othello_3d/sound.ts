import type { GameState, MoveAction } from "@engine/shared/rules/Othello3DRuleset";
import { createOthelloSoundProfile } from "@/sound/profiles/createOthelloSoundProfile";

// 3D オセロも 2D と同じ音源を使う
export default createOthelloSoundProfile<GameState, MoveAction>({
  placeActionType: "MOVE",
  baseUrl: "/sounds/othello",
});
