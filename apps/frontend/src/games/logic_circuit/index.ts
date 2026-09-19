import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "logic_circuit",
  category: "Special",
  component: () => import("@/components/game/LogicLab.vue"),
});
