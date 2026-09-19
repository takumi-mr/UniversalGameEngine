import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "hanafuda",
  category: "Card Games",
  component: () => import("@/components/game/Hanafuda.vue"),
});
