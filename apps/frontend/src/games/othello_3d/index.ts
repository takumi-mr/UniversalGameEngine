import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "othello_3d",
  category: "Board Games",
  component: () => import("@/components/game/Othello3D.vue"),
  sound: () => import("@/games/othello_3d/sound"),
});
