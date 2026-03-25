import { createRouter, createWebHistory } from "vue-router";
import LoginView from "../views/LoginView.vue";
import SelectionView from "../views/SelectionView.vue";
import RoomListView from "../views/RoomListView.vue";
import GameView from "../views/GameView.vue";
import ReplayView from "../views/ReplayView.vue";

const routes = [
  {
    path: "/",
    redirect: "/selection",
  },
  {
    path: "/login",
    name: "Login",
    component: LoginView,
  },
  {
    path: "/selection",
    name: "Selection",
    component: SelectionView,
  },
  {
    path: "/rooms/:gameType",
    name: "RoomList",
    component: RoomListView,
  },
  {
    path: "/game/:gameType/:roomId",
    name: "Game",
    component: GameView,
  },
  {
    path: "/replay/:gameType/:recordId?",
    name: "ReplayPage",
    component: ReplayView,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Guard for authentication
router.beforeEach((to, _from, next) => {
  const isAuthenticated = !!localStorage.getItem("game_token");
  if (to.name !== "Login" && !isAuthenticated) {
    next({ name: "Login" });
  } else if (to.name === "Login" && isAuthenticated) {
    next({ name: "Selection" });
  } else {
    next();
  }
});

export default router;
