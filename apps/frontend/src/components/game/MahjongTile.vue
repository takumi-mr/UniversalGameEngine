<template>
  <div 
    class="mahjong-tile" 
    :class="{ 
      'is-hidden': hidden, 
      'is-horizontal': horizontal,
      'is-clickable': clickable
    }"
    :title="tile"
  >
    <div class="tile-inner">
      <div class="tile-face front">
        <span v-if="!hidden" class="tile-char" :class="colorClass">
          {{ tileChar }}
        </span>
      </div>
      <div class="tile-face back"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  tile: string;       // e.g., '1m', '9s', '1z', '?'
  hidden?: boolean;
  horizontal?: boolean;
  clickable?: boolean;
  size?: 'normal' | 'small';
}>();

// Unicode Mahjong Tiles: U+1F000 to U+1F02B
const TILE_MAP: Record<string, string> = {
  // Characters (Wan-zu)
  '1m': '🀇', '2m': '🀈', '3m': '🀉', '4m': '🀊', '5m': '🀋', '6m': '🀌', '7m': '🀍', '8m': '🀎', '9m': '🀏',
  // Dots (Pin-zu)
  '1p': '🀙', '2p': '🀚', '3p': '🀛', '4p': '🀜', '5p': '🀝', '6p': '🀞', '7p': '🀟', '8p': '🀠', '9p': '🀡',
  // Bamboo (Sou-zu)
  '1s': '🀐', '2s': '🀑', '3s': '🀒', '4s': '🀓', '5s': '🀔', '6s': '🀕', '7s': '🀖', '8s': '🀗', '9s': '🀘',
  // Honors (Ji-hai)
  '1z': '🀀', '2z': '🀁', '3z': '🀂', '4z': '🀃', // Ton, Nan, Sha, Pei
  '5z': '🀆', '6z': '🀅', '7z': '🀄',             // Haku, Hatsu, Chun
};

const tileChar = computed(() => {
  if (props.tile === '?') return '';
  return TILE_MAP[props.tile] || props.tile;
});

const colorClass = computed(() => {
  if (props.tile.endsWith('m')) return 'color-man';
  if (props.tile.endsWith('p')) return 'color-pin';
  if (props.tile.endsWith('s')) return 'color-sou';
  if (props.tile === '6z') return 'color-hatsu'; // Green Dragon
  if (props.tile === '7z') return 'color-chun';  // Red Dragon
  return '';
});

</script>

<style scoped>
.mahjong-tile {
  width: 48px;
  height: 64px;
  perspective: 600px;
  display: inline-block;
  margin: 2px;
  cursor: default;
  user-select: none;
}

.mahjong-tile.is-horizontal {
  width: 64px;
  height: 48px;
  transform: rotate(-90deg);
  margin: 10px -6px; /* Adjust for rotation */
}

/* Small size variant */
.mahjong-tile[size="small"] {
  width: 32px;
  height: 44px;
}
.mahjong-tile[size="small"].is-horizontal {
  width: 44px;
  height: 32px;
}

.mahjong-tile.is-clickable {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.mahjong-tile.is-clickable:hover {
  transform: translateY(-8px);
}

.tile-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.6s;
  transform-style: preserve-3d;
}

.mahjong-tile.is-hidden .tile-inner {
  transform: rotateY(180deg);
}

.tile-face {
  position: absolute;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  border-radius: 4px;
  border: 1px solid #ccc;
  box-shadow: 2px 2px 5px rgba(0,0,0,0.2);
}

.front {
  background-color: #fcfaf0; /* Cream color */
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 4px solid #ddd;
}

.back {
  background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%); /* Green back */
  transform: rotateY(180deg);
  border: 4px solid #fff;
}

.tile-char {
  font-size: 3rem;
  line-height: 1;
  font-family: serif; /* Better for Unicode tiles */
  text-shadow: 0.5px 0.5px 1px rgba(0,0,0,0.2);
}

/* Colors based on traditional Mahjong sets */
.color-man { color: #d32f2f; }   /* Red */
.color-pin { color: #1976d2; }   /* Blue */
.color-sou { color: #388e3c; }   /* Green */
.color-hatsu { color: #2e7d32; } /* Green Dragon */
.color-chun { color: #c62828; }  /* Red Dragon */

/* Adjust font sizes */
.is-horizontal .tile-char { font-size: 2.5rem; }
[size="small"] .tile-char { font-size: 2rem; }
[size="small"].is-horizontal .tile-char { font-size: 1.8rem; }
</style>
