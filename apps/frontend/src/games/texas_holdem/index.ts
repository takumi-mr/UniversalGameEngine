import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "texas_holdem",
  category: "Card Games",
  component: () => import("@/components/game/TexasHoldem.vue"),
});
