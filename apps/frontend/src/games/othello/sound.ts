import type { OthelloState, OthelloAction } from "@engine/shared/rules/OthelloRuleset";
import { createOthelloSoundProfile } from "@/sound/profiles/createOthelloSoundProfile";

export default createOthelloSoundProfile<OthelloState, OthelloAction>({
  placeActionType: "PLACE_PIECE",
  baseUrl: "/sounds/othello",
});
