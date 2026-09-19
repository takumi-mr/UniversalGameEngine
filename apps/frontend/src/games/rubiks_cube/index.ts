import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "rubiks_cube",
  category: "Puzzles",
  component: () => import("@/components/game/RubiksCube.vue"),
});
