import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "chess",
  category: "Board Games",
  component: () => import("@/components/game/Chess.vue"),
});
