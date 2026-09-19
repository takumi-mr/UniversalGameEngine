import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "mancala",
  category: "Board Games",
  component: () => import("@/components/game/Mancala.vue"),
});
