import { defineStore } from 'pinia';

export const useGameStore = defineStore('game', {
  state: () => ({
    currentGameType: null as string | null,
    currentRoomId: null as string | null,
    isPlaying: false,
  }),
  actions: {
    setGame(gameType: string, roomId: string) {
      this.currentGameType = gameType;
      this.currentRoomId = roomId;
      this.isPlaying = true;
    },
    clearGame() {
      this.currentGameType = null;
      this.currentRoomId = null;
      this.isPlaying = false;
    },
  },
});
