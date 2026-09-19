import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "tictactoe",
  category: "Board Games",
  component: () => import("@/components/game/TicTacToe.vue"),
});
