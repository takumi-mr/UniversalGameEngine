import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "uno",
  category: "Card Games",
  component: () => import("@/components/game/Uno.vue"),
});
