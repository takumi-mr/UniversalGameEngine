import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "wordle",
  category: "Puzzles",
  component: () => import("@/components/game/Wordle.vue"),
});
