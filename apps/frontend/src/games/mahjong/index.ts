import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "mahjong",
  category: "Board Games",
  component: () => import("@/components/game/Mahjong.vue"),
});
