import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "shogi_3d",
  category: "Board Games",
  component: () => import("@/components/game/Shogi3D.vue"),
});
