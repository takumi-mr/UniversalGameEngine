import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "minesweeper",
  category: "Puzzles",
  component: () => import("@/components/game/Minesweeper.vue"),
});
