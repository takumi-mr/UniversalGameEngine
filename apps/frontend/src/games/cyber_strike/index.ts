import { defineGameUI } from "@/games/types";

export default defineGameUI({
  type: "cyber_strike",
  category: "Special",
  component: () => import("@/components/game/CyberStrike.vue"),
  // リアルタイム制（サーバー時計との同期前提）なのでリプレイ再生には向かない
  replay: false,
});
