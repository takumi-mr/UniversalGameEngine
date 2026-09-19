import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "logic_lab",
  category: "Puzzles",
  component: () => import("@/components/game/LogicLab.vue"),
});
