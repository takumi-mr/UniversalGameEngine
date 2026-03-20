import { defineStore } from 'pinia';

export const useUIStore = defineStore('ui', {
  state: () => ({
    theme: localStorage.getItem('user-theme') || 'light',
    locale: localStorage.getItem('user-locale') || 'ja',
  }),
  actions: {
    setTheme(theme: string) {
      this.theme = theme;
      localStorage.setItem('user-theme', theme);
    },
    setLocale(locale: string) {
      this.locale = locale;
      localStorage.setItem('user-locale', locale);
    },
  },
});
