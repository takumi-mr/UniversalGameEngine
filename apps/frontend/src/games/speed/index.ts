import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "speed",
  category: "Card Games",
  component: () => import("@/components/game/Speed.vue"),
});
