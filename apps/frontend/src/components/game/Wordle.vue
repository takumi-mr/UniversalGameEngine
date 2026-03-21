<template>
  <div class="wordle-game">
    <div class="grid">
      <div
        v-for="(_, rowIndex) in 6"
        :key="rowIndex"
        class="row"
      >
        <div 
          v-for="(__, colIndex) in 5" 
          :key="colIndex" 
          class="tile"
          :class="getTileClass(rowIndex, colIndex)"
        >
          {{ getTileLetter(rowIndex, colIndex) }}
        </div>
      </div>
    </div>

    <div class="keyboard">
      <div
        v-for="(row, rowIndex) in keyboardRows"
        :key="rowIndex"
        class="keyboard-row"
      >
        <button 
          v-for="key in row" 
          :key="key" 
          class="key"
          :class="getKeyClass(key)"
          @click="onKeyClick(key)"
        >
          {{ key === 'BACKSPACE' ? '⌫' : key }}
        </button>
      </div>
    </div>

    <div
      v-if="state.status === 'FINISHED'"
      class="result-overlay"
    >
      <div class="result-content">
        <h2>{{ state.message }}</h2>
        <v-btn
          color="primary"
          @click="$emit('action', { type: 'START', playerId: myPlayerId })"
        >
          {{ $t('games.wordle.play_again') }}
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import type { WordleState, WordleAction } from '@engine/shared/rules/WordleRuleset';

const props = defineProps<{
  state: WordleState;
  myPlayerId: string;
}>();

const emit = defineEmits<{
  (e: 'action', action: WordleAction): void;
}>();

const currentGuess = ref('');
const keyboardRows = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACKSPACE']
];

const getTileLetter = (row: number, col: number) => {
  if (row < props.state.guesses.length) {
    return props.state.guesses[row][col];
  }
  if (row === props.state.guesses.length) {
    return currentGuess.value[col] || '';
  }
  return '';
};

const getTileClass = (row: number, col: number) => {
  if (row >= props.state.guesses.length) return '';

  const guess = props.state.guesses[row];
  const letter = guess[col];
  const secret = props.state.secretWord;

  if (letter === secret[col]) return 'correct';
  if (secret.includes(letter)) return 'present';
  return 'absent';
};

const getKeyClass = (key: string) => {
  if (key === 'ENTER' || key === 'BACKSPACE') return 'wide';
  
  let status = '';
  for (const guess of props.state.guesses) {
    for (let i = 0; i < guess.length; i++) {
      if (guess[i] === key) {
        if (guess[i] === props.state.secretWord[i]) {
          return 'correct';
        }
        if (props.state.secretWord.includes(key)) {
          status = 'present';
        } else if (status !== 'present') {
          status = 'absent';
        }
      }
    }
  }
  return status;
};

const onKeyClick = (key: string) => {
  if (props.state.status !== 'PLAYING') return;

  if (key === 'ENTER') {
    if (currentGuess.value.length === 5) {
      emit('action', { type: 'GUESS', word: currentGuess.value, playerId: props.myPlayerId });
      currentGuess.value = '';
    }
  } else if (key === 'BACKSPACE') {
    currentGuess.value = currentGuess.value.slice(0, -1);
  } else if (currentGuess.value.length < 5) {
    currentGuess.value += key;
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  const key = e.key.toUpperCase();
  if (key === 'ENTER') {
    onKeyClick('ENTER');
  } else if (key === 'BACKSPACE') {
    onKeyClick('BACKSPACE');
  } else if (/^[A-Z]$/.test(key)) {
    onKeyClick(key);
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<style scoped>
.wordle-game {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 30px;
  user-select: none;
}

.grid {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.row {
  display: flex;
  gap: 5px;
}

.tile {
  width: 50px;
  height: 50px;
  border: 2px solid rgba(var(--v-border-color), 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  text-transform: uppercase;
  transition: all 0.3s ease;
}

.tile.filled {
  border-color: rgba(var(--v-border-color), 0.8);
}

.tile.correct {
  background-color: #6aaa64;
  border-color: #6aaa64;
  color: white;
}

.tile.present {
  background-color: #c9b458;
  border-color: #c9b458;
  color: white;
}

.tile.absent {
  background-color: #787c7e;
  border-color: #787c7e;
  color: white;
}

.keyboard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 500px;
}

.keyboard-row {
  display: flex;
  justify-content: center;
  gap: 6px;
}

.key {
  height: 50px;
  min-width: 30px;
  padding: 0 10px;
  border-radius: 4px;
  background-color: rgba(var(--v-theme-surface), 0.8);
  border: none;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  color: rgb(var(--v-theme-on-surface));
}

.key:hover {
  opacity: 0.8;
}

.key.wide {
  min-width: 50px;
}

.key.correct { background-color: #6aaa64; color: white; }
.key.present { background-color: #c9b458; color: white; }
.key.absent { background-color: #787c7e; color: white; }

.result-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.result-content {
  background: rgb(var(--v-theme-surface));
  padding: 30px;
  border-radius: 16px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.result-content h2 {
  margin-bottom: 20px;
}
</style>
