import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "go",
  category: "Board Games",
  component: () => import("@/components/game/Go.vue"),
});
