<template>
  <router-view />
</template>

<script setup lang="ts">
// Logic moved to views and router
</script>

<style>
/* Global */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
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
  background: rgb(var(--v-theme-surface));
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 7px 20px;
  font-family: 'Inter', sans-serif;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface));
  position: relative;
  z-index: 1000;
}
.user-bar strong { color: rgb(var(--v-theme-primary)); }

.back-btn {
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.back-btn:hover { background: rgba(var(--v-theme-on-surface), 0.14); }

.logout-btn {
  background: rgba(var(--v-theme-error), 0.15);
  color: rgb(var(--v-theme-error));
  border: 1px solid rgba(var(--v-theme-error), 0.25);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.logout-btn:hover { background: rgba(var(--v-theme-error), 0.3); }
</style>
