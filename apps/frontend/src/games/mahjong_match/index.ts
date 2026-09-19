import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "mahjong_match",
  category: "Board Games",
  component: () => import("@/components/game/MahjongMatch.vue"),
});
