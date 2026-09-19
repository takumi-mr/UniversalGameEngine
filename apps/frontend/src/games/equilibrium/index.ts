import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "equilibrium",
  category: "Special",
  component: () => import("@/components/game/Equilibrium.vue"),
});
