<template>
  <div class="selector-bg">
    <div class="selector-container">
      <div class="header">
        <div class="logo">🎮 Universal Game Engine</div>
        <div class="subtitle">プレイするゲームを選んでください</div>
      </div>

      <div class="game-grid">
        <button
          v-for="game in games"
          :key="game.type"
          class="game-card"
          :class="{ selected: selectedType === game.type }"
          @click="selectedType = game.type"
        >
          <div class="card-emoji">{{ game.emoji }}</div>
          <div class="card-name">{{ game.name }}</div>
          <div class="card-desc">{{ game.description }}</div>
          <div class="card-meta">
            <span class="player-count">
              👤 {{ game.minPlayers === game.maxPlayers ? game.minPlayers : `${game.minPlayers}–${game.maxPlayers}` }}人
            </span>
          </div>
        </button>
      </div>

      <div v-if="selectedType" class="start-area">
        <button class="btn-start" @click="$emit('select', selectedType)">
          🚀 Game Start
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

// GameRegistryのgetAllDefinitions()と同じ型
interface GameInfo {
  type: string;
  name: string;
  description: string;
  emoji: string;
  minPlayers: number;
  maxPlayers: number;
}

defineProps<{ games: GameInfo[] }>();
defineEmits<{ (e: 'select', type: string): void }>();

const selectedType = ref<string | null>(null);
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');

.selector-bg {
  width: 100%;
  height: 100%;
  background: radial-gradient(ellipse at 60% 40%, #1e293b 0%, #0f172a 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  font-family: 'Inter', sans-serif;
}

.selector-container {
  max-width: 960px;
  width: 100%;
  padding: 48px 32px;
}

.header {
  text-align: center;
  margin-bottom: 40px;
}
.logo {
  font-size: 2.4rem;
  font-weight: 800;
  color: #f1f5f9;
  letter-spacing: -0.5px;
  margin-bottom: 8px;
}
.subtitle {
  color: #64748b;
  font-size: 1rem;
}

/* === Grid === */
.game-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.game-card {
  background: rgba(30, 41, 59, 0.8);
  border: 2px solid rgba(255,255,255,0.07);
  border-radius: 18px;
  padding: 28px 20px 22px;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  color: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.game-card:hover {
  border-color: rgba(99, 102, 241, 0.5);
  background: rgba(99, 102, 241, 0.1);
  transform: translateY(-3px);
  box-shadow: 0 8px 30px rgba(99, 102, 241, 0.2);
}
.game-card.selected {
  border-color: #6366f1;
  background: rgba(99, 102, 241, 0.2);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.35), 0 10px 40px rgba(99, 102, 241, 0.3);
  transform: translateY(-4px);
}

.card-emoji {
  font-size: 2.8rem;
  line-height: 1;
  margin-bottom: 4px;
}
.card-name {
  font-size: 1rem;
  font-weight: 700;
  color: #f1f5f9;
}
.card-desc {
  font-size: 0.78rem;
  color: #94a3b8;
  line-height: 1.4;
}
.card-meta {
  margin-top: 4px;
}
.player-count {
  font-size: 0.72rem;
  background: rgba(255,255,255,0.07);
  color: #64748b;
  padding: 3px 10px;
  border-radius: 50px;
}

/* === Start Button === */
.start-area {
  display: flex;
  justify-content: center;
}
.btn-start {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: white;
  border: none;
  border-radius: 14px;
  padding: 16px 60px;
  font-size: 1.1rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 6px 30px rgba(99, 102, 241, 0.4);
  letter-spacing: 0.4px;
}
.btn-start:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 40px rgba(99, 102, 241, 0.6);
  background: linear-gradient(135deg, #818cf8 0%, #a78bfa 100%);
}
.btn-start:active {
  transform: translateY(0);
}
</style>
