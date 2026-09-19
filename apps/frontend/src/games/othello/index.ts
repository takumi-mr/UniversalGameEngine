import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "othello",
  category: "Board Games",
  component: () => import("@/components/game/Othello.vue"),
});
