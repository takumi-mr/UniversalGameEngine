import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "sudoku",
  category: "Puzzles",
  component: () => import("@/components/game/Sudoku.vue"),
});
