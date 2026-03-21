import { defineStore } from "pinia";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    username: localStorage.getItem("game_username") || null,
    token: localStorage.getItem("game_token") || null,
  }),
  getters: {
    isLoggedIn: (state) => !!state.token && !!state.username,
  },
  actions: {
    async login(username: string) {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3000";
      const res = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      this.username = data.userId;
      this.token = data.token;
      localStorage.setItem("game_username", this.username!);
      localStorage.setItem("game_token", this.token!);
    },
    logout() {
      this.username = null;
      this.token = null;
      localStorage.removeItem("game_username");
      localStorage.removeItem("game_token");
    },
  },
});
