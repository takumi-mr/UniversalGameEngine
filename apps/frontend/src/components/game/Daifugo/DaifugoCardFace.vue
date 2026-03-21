<template>
  <div
    class="card-inner"
    :class="{ 'is-red': isRed, 'is-black': isBlack, 'is-joker': isJoker, 'is-back': isBack }"
  >
    <template v-if="isBack">
      <div class="card-back-pattern" />
    </template>
    <template v-else-if="isJoker">
      <div class="joker-text">
        JOKER
      </div>
      <div class="center-suit">
        🤡
      </div>
    </template>
    <template v-else>
      <div class="top-left">
        <div class="rank">
          {{ displayRank }}
        </div>
        <div class="suit">
          {{ suitSymbol }}
        </div>
      </div>
      <div class="center-suit">
        {{ suitSymbol }}
      </div>
      <div class="bottom-right">
        <div class="rank">
          {{ displayRank }}
        </div>
        <div class="suit">
          {{ suitSymbol }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ cardStr: string }>();

const isBack = computed(() => props.cardStr === '?');
const isJoker = computed(() => props.cardStr === 'JR');

const rankChar = computed(() => isBack.value || isJoker.value ? '' : props.cardStr.charAt(0));
const suitChar = computed(() => isBack.value || isJoker.value ? '' : props.cardStr.charAt(1));

const displayRank = computed(() => rankChar.value === 'T' ? '10' : rankChar.value);

const suitSymbol = computed(() => {
  if (suitChar.value === 'S') return '♠';
  if (suitChar.value === 'H') return '♥';
  if (suitChar.value === 'D') return '♦';
  if (suitChar.value === 'C') return '♣';
  return '';
});

const isRed = computed(() => suitChar.value === 'H' || suitChar.value === 'D');
const isBlack = computed(() => suitChar.value === 'S' || suitChar.value === 'C');
</script>

<style scoped>
.card-inner {
  width: 70px;
  height: 100px;
  background: white;
  border-radius: 6px;
  position: relative;
  box-sizing: border-box;
  padding: 4px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  user-select: none;
}

.is-red { color: #e11d48; }
.is-black { color: #1a1a1a; }
.is-joker { color: #9333ea; display: flex; flex-direction: column; align-items: center; justify-content: center;}

.top-left, .bottom-right {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
}
.top-left { top: 4px; left: 4px; }
.bottom-right { bottom: 4px; right: 4px; transform: rotate(180deg); }

.rank { font-size: 1.1rem; font-weight: bold; font-family: 'Arial', sans-serif; }
.suit { font-size: 0.9rem; }

.center-suit {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 2rem;
  opacity: 0.8;
}

.joker-text { font-size: 0.8rem; font-weight: bold; letter-spacing: 1px; transform: rotate(-90deg); position: absolute; left: -10px;}

/* カードの裏面デザイン */
.is-back {
  background: #1e3a8a;
  border: 4px solid white;
}
.card-back-pattern {
  width: 100%;
  height: 100%;
  background-image: repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.2) 5px, rgba(255,255,255,0.2) 10px);
}
</style>