import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "tower_of_hanoi",
  category: "Puzzles",
  component: () => import("@/components/game/TowerOfHanoi.vue"),
});
