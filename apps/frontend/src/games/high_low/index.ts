import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "high_low",
  category: "Card Games",
  component: () => import("@/components/game/HighLow.vue"),
});
