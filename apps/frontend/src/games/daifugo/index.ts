import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "daifugo",
  category: "Card Games",
  component: () => import("@/components/game/Daifugo/Daifugo.vue"),
});
