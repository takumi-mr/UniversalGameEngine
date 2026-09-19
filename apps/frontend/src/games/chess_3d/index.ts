import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "chess_3d",
  category: "Board Games",
  component: () => import("@/components/game/Chess3D.vue"),
});
