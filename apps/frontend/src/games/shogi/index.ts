import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "shogi",
  category: "Board Games",
  component: () => import("@/components/game/Shogi.vue"),
});
