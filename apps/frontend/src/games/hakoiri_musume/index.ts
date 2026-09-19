import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "hakoiri_musume",
  category: "Puzzles",
  component: () => import("@/components/game/HakoiriMusume.vue"),
});
