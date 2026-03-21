import { defineStore } from "pinia";

export const useRoomStore = defineStore("room", {
  state: () => ({
    rooms: [] as any[],
    loading: false,
    lastFetchedType: null as string | null,
  }),
  actions: {
    async fetchRooms(gameType: string) {
      this.loading = true;
      try {
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3000";
        const res = await fetch(`${API_BASE_URL}/rooms/${gameType}`);
        const data = await res.json();
        this.rooms = data.rooms;
        this.lastFetchedType = gameType;
      } catch (err) {
        console.error("Failed to fetch rooms:", err);
      } finally {
        this.loading = false;
      }
    },
    clearRooms() {
      this.rooms = [];
      this.lastFetchedType = null;
    },
  },
});
