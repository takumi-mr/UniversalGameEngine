<template>
  <router-view />
</template>

<script setup lang="ts">
// Logic moved to views and router
</script>

<style>
/* Global */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0f172a; }
#app { width: 100%; height: 100%; }
</style>

<style scoped>
.app-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* Children fill remaining height */
.app-wrapper > *:not(.user-bar) {
  flex: 1;
  min-height: 0;
}

/* === Top Bar === */
.user-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 7px 20px;
  font-family: 'Inter', sans-serif;
  font-size: 0.82rem;
  color: #94a3b8;
  position: relative;
  z-index: 1000;
}
.user-bar strong { color: #e2e8f0; }

.back-btn {
  background: rgba(255,255,255,0.07);
  color: #94a3b8;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.back-btn:hover { background: rgba(255,255,255,0.14); color: #e2e8f0; }

.logout-btn {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.logout-btn:hover { background: rgba(239, 68, 68, 0.3); }
</style>
